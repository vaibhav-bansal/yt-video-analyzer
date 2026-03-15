import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, MAX_CREDIBILITY_TOKENS } from "./config.js";
import { withRetry } from "./retry.js";
import { SINGLE_CLAIM_SYSTEM_PROMPT } from "./prompts.js";
import type {
  CredibilityReport,
  ExtractedClaim,
  VerificationStatus,
  VerifiedClaim,
  VideoMetadata,
} from "./types.js";
import type { Logger } from "./logger.js";

const MAX_WEB_SEARCHES_PER_CLAIM = 3;
const MAX_WEB_FETCHES_PER_CLAIM = 3;
const MAX_PAUSE_TURN_CONTINUATIONS = 3;
const CLAIM_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_RETRIES = 3;
const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
const WEB_FETCH_TOOL_TYPE = "web_fetch_20260209";

export const assessCredibility = async (
  claims: ExtractedClaim[],
  metadata: VideoMetadata,
  anthropicApiKey: string,
  log: Logger,
  onClaimVerified?: (index: number, claim: VerifiedClaim) => void
): Promise<CredibilityReport> => {
  const client = new Anthropic({ apiKey: anthropicApiKey });

  log.info(`Credibility assessment: ${claims.length} claims, parallel verification (max ${MAX_WEB_SEARCHES_PER_CLAIM} searches + ${MAX_WEB_FETCHES_PER_CLAIM} fetch per claim)`);

  // Fan out: one API call per claim, all in parallel, each with a timeout + retries
  const results = await Promise.allSettled(
    claims.map(async (claim, i) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
        try {
          const result = await withTimeout(
            verifySingleClaim(client, claim, metadata, i, log),
            CLAIM_TIMEOUT_MS,
            `Claim ${i + 1} timed out after ${CLAIM_TIMEOUT_MS / 1000}s`
          );
          onClaimVerified?.(i, result.claim);
          return result;
        } catch (err) {
          lastError = err;
          if (attempt < MAX_TIMEOUT_RETRIES) {
            log.info(`Claim ${i + 1}: attempt ${attempt}/${MAX_TIMEOUT_RETRIES} failed, retrying...`);
          }
        }
      }
      // All retries exhausted -- emit timeout status
      const timeoutClaim: VerifiedClaim = {
        ...claim,
        status: "timeout",
        evidence: "Verification timed out after multiple attempts.",
      };
      onClaimVerified?.(i, timeoutClaim);
      throw lastError;
    })
  );

  const verifiedClaims: VerifiedClaim[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      verifiedClaims.push(result.value.claim);
      totalInputTokens += result.value.inputTokens;
      totalOutputTokens += result.value.outputTokens;
    } else {
      log.error(`Claim ${i + 1} verification failed: ${result.reason}`);
      verifiedClaims.push({
        ...claims[i],
        status: "timeout",
        evidence: "Verification timed out after multiple attempts.",
      });
    }
  }

  log.info(`Credibility tokens -- input: ${totalInputTokens}, output: ${totalOutputTokens}`);

  const summary = buildSummary(verifiedClaims);

  return { verifiedClaims, summary };
};

export const retrySingleClaim = async (
  claim: ExtractedClaim,
  metadata: VideoMetadata,
  anthropicApiKey: string,
  log: Logger
): Promise<VerifiedClaim> => {
  const client = new Anthropic({ apiKey: anthropicApiKey });
  const result = await withTimeout(
    verifySingleClaim(client, claim, metadata, 0, log),
    CLAIM_TIMEOUT_MS,
    `Claim retry timed out after ${CLAIM_TIMEOUT_MS / 1000}s`
  );
  return result.claim;
};

const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

interface SingleClaimResult {
  claim: VerifiedClaim;
  inputTokens: number;
  outputTokens: number;
}

const verifySingleClaim = async (
  client: Anthropic,
  claim: ExtractedClaim,
  metadata: VideoMetadata,
  index: number,
  log: Logger
): Promise<SingleClaimResult> => {
  return withRetry(async () => {
    return verifySingleClaimInner(client, claim, metadata, index, log);
  }, `Claim ${index + 1} verification`);
};

const verifySingleClaimInner = async (
  client: Anthropic,
  claim: ExtractedClaim,
  metadata: VideoMetadata,
  index: number,
  log: Logger
): Promise<SingleClaimResult> => {
  const speaker = claim.speaker ? ` (speaker: ${claim.speaker})` : "";
  const userPrompt = `Verify this claim from the YouTube video "${metadata.title}" by ${metadata.channelName}:

"${claim.claim}"${speaker}
Type: ${claim.type}
Context: ${claim.context}
Timestamp: ${claim.timestamp}

Search the web to verify this claim. Return your assessment as JSON.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let response: Anthropic.Message;
  let pauseTurnCount = 0;

  while (true) {
    const stream = client.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: MAX_CREDIBILITY_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SINGLE_CLAIM_SYSTEM_PROMPT,
      tools: [
        {
          type: WEB_SEARCH_TOOL_TYPE,
          name: "web_search",
          max_uses: MAX_WEB_SEARCHES_PER_CLAIM,
        } as unknown as Anthropic.Tool,
        {
          type: WEB_FETCH_TOOL_TYPE,
          name: "web_fetch",
          max_uses: MAX_WEB_FETCHES_PER_CLAIM,
        } as unknown as Anthropic.Tool,
      ],
      messages,
    } as unknown as Anthropic.MessageCreateParamsStreaming);

    response = await stream.finalMessage();

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    if (response.stop_reason === "pause_turn") {
      pauseTurnCount++;
      if (pauseTurnCount >= MAX_PAUSE_TURN_CONTINUATIONS) {
        log.info(`Claim ${index + 1}: pause_turn limit reached (${MAX_PAUSE_TURN_CONTINUATIONS}), stopping`);
        break;
      }
      log.info(`Claim ${index + 1}: pause_turn (${pauseTurnCount}/${MAX_PAUSE_TURN_CONTINUATIONS}) -- continuing`);
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: "Continue." });
      continue;
    }

    break;
  }

  log.info(`Claim ${index + 1} verified: input=${totalInputTokens}, output=${totalOutputTokens}`);

  const text = extractText(response!);
  const parsed = parseSingleClaimResponse(text, claim);
  return { claim: parsed, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
};

const extractText = (response: Anthropic.Message): string => {
  const textBlocks = response.content.filter((b) => b.type === "text");
  if (textBlocks.length === 0) {
    const blockTypes = response.content.map((b) => b.type).join(", ");
    const stopReason = response.stop_reason;
    throw new Error(
      `Claude returned no text content. ` +
        `Response contained: [${blockTypes}], stop_reason: ${stopReason}. ` +
        `This likely means max_tokens was exhausted by thinking.`
    );
  }

  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const block = textBlocks[i];
    if (block.type !== "text") continue;
    const text = block.text.trim();
    if (text.startsWith("{") || text.includes("```json")) {
      return text;
    }
  }

  const last = textBlocks[textBlocks.length - 1];
  if (last.type === "text") return last.text;
  throw new Error("Could not extract JSON from response text blocks");
};

const parseSingleClaimResponse = (
  text: string,
  originalClaim: ExtractedClaim
): VerifiedClaim => {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const validStatuses: VerificationStatus[] = [
    "confirmed",
    "contradicted",
    "partially_true",
    "unverifiable",
    "not_checked",
  ];

  try {
    const parsed = JSON.parse(jsonStr);

    return {
      claim: parsed.claim || originalClaim.claim,
      timestamp: parsed.timestamp || originalClaim.timestamp,
      type: originalClaim.type,
      context: parsed.context || originalClaim.context,
      speaker: parsed.speaker || originalClaim.speaker,
      status: validStatuses.includes(parsed.status) ? parsed.status : "unverifiable",
      evidence: parsed.evidence || "No evidence provided.",
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse claim response: ${message}`);
  }
};

const buildSummary = (claims: VerifiedClaim[]): string => {
  const confirmed = claims.filter((c) => c.status === "confirmed").length;
  const contradicted = claims.filter((c) => c.status === "contradicted").length;
  const partial = claims.filter((c) => c.status === "partially_true").length;
  const unverifiable = claims.filter((c) => c.status === "unverifiable").length;
  const total = claims.length;

  if (total === 0) return "No factual claims required verification.";

  if (contradicted === 0 && partial === 0) {
    return `All ${confirmed} verified factual claims were confirmed. ${unverifiable > 0 ? `${unverifiable} could not be verified.` : ""}`.trim();
  }

  if (contradicted > 0) {
    return `Of ${total} factual claims, ${contradicted} were contradicted by evidence. Viewers should approach this content with caution.`;
  }

  return `Of ${total} factual claims, ${confirmed} confirmed, ${partial} partially true, ${unverifiable} unverifiable.`;
};

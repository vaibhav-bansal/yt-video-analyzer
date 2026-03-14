import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, MAX_CREDIBILITY_TOKENS } from "./config.js";
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
const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
const WEB_FETCH_TOOL_TYPE = "web_fetch_20260209";

const SINGLE_CLAIM_SYSTEM_PROMPT = `You are a fact-checking analyst. You will receive a single factual claim from a YouTube video. Verify it using web search.

Rules:
- Use at most 2 web searches. If inconclusive after 2 searches, mark as "unverifiable".
- Use web fetch only if a search result references a specific document you need to read in detail.
- Prefer search result snippets over full page fetches.

Return a JSON object:

{
  "claim": "The exact claim text",
  "timestamp": "M:SS",
  "type": "the claim type",
  "context": "original context",
  "speaker": "speaker if known",
  "status": "confirmed | contradicted | partially_true | unverifiable",
  "evidence": "Brief explanation citing the search evidence"
}

Status guidelines:
- "confirmed": The evidence broadly supports the core point being made. This is the correct status whenever the substance of the claim holds up, even if minor details differ.
- "contradicted": The evidence clearly contradicts the CORE claim, not a peripheral detail.
- "partially_true": ONLY when the claim contains substantively incorrect elements that materially change its meaning -- not just imprecise phrasing or minor simplifications.
- "unverifiable": Could not find sufficient evidence after searching.
- Cite the source when possible (e.g., "According to the EIA...").

CRITICAL -- Do NOT downgrade a claim for any of the following. These are all "confirmed":
- Informal or hyperbolic language: "very frequently", "the biggest", "always" -- if the data directionally supports it, confirm.
- Rounded numbers: "about 20 million" when the real number is 19.3 million. Rounding is normal in spoken content.
- Reasonable simplifications of institutions: "UN report" when it was an IAEA report (a UN agency), "the government" for a specific department. If the attribution chain is correct, confirm.
- Correct qualifiers being used: "up to X", "nearly Y", "roughly Z", "one of the largest" -- these are hedges that make the claim MORE accurate, not less. Do not penalize them.
- Dated accuracy: If a claim was accurate at the time the video was published, confirm it. Do not contradict it with newer data unless the video presents it as current.
- Composite claims where the core point is correct: If a claim has multiple parts and the main substantive point is confirmed, do not downgrade to "partially_true" over a minor secondary detail.
- Reporting someone's stated position: "X said Y", "X claimed Y" -- verify whether X actually said/did Y. The claim is about what was said or done, not whether the underlying position is correct.

Return ONLY valid JSON.`;

export const assessCredibility = async (
  claims: ExtractedClaim[],
  metadata: VideoMetadata,
  anthropicApiKey: string,
  log: Logger
): Promise<CredibilityReport> => {
  const client = new Anthropic({ apiKey: anthropicApiKey });

  log.info(`Credibility assessment: ${claims.length} claims, parallel verification (max ${MAX_WEB_SEARCHES_PER_CLAIM} searches + ${MAX_WEB_FETCHES_PER_CLAIM} fetch per claim)`);

  // Fan out: one API call per claim, all in parallel
  const results = await Promise.allSettled(
    claims.map((claim, i) => verifySingleClaim(client, claim, metadata, i, log))
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
        status: "unverifiable",
        evidence: "Verification failed due to an error.",
      });
    }
  }

  log.info(`Credibility tokens -- input: ${totalInputTokens}, output: ${totalOutputTokens}`);

  const summary = buildSummary(verifiedClaims);

  return { verifiedClaims, summary };
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
      log.info(`Claim ${index + 1}: pause_turn -- continuing`);
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

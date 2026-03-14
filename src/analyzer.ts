import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, MAX_CONTENT_TOKENS, MAX_CLAIMS_TOKENS } from "./config.js";
import type { ExtractedClaim, SegmentSummary, VideoMetadata } from "./types.js";

export interface ContentAnalysis {
  synopsis: string;
  segments: SegmentSummary[];
  keyTakeaways: string[];
}

export interface ClaimExtractionResult {
  claims: ExtractedClaim[];
}

const CONTENT_SYSTEM_PROMPT = `You are a video content analyst. Analyze the transcript and return a JSON object:

{
  "synopsis": "2-3 sentence overview of what the video covers and what the viewer will learn.",
  "segments": [
    {
      "timestamp": "M:SS",
      "endTimestamp": "M:SS",
      "title": "Short title",
      "summary": "2-3 sentence summary",
      "startSeconds": 0
    }
  ],
  "keyTakeaways": ["Key point 1", "Key point 2"]
}

Guidelines:
- SYNOPSIS: 2-3 sentences to help someone decide whether to watch
- SEGMENTS: Logical topic boundaries, not fixed intervals. Include start/end timestamps, title, summary. startSeconds = numeric seconds.
- SPEAKERS: When multiple speakers are detectable, attribute statements using names if introduced (e.g., "According to Dr. Ramanujan, ...") or roles ("the host", "the guest"). Single-speaker videos need no attribution.
- KEY TAKEAWAYS: Short videos (< 15 min): 5-7. Medium (15-45 min): 7-10. Long (> 45 min): 10-15. Each should be a standalone insight.

Return ONLY valid JSON.`;

const CLAIMS_SYSTEM_PROMPT = `You are a claims analyst. Extract notable claims from the transcript and return a JSON object:

{
  "claims": [
    {
      "claim": "The exact or near-exact statement made",
      "timestamp": "M:SS",
      "type": "sourced_fact | unsourced_fact | opinion_as_fact | anecdotal_generalization | certain_prediction | generally_accepted_knowledge",
      "context": "Brief context about why this claim was flagged",
      "speaker": "Name or role if identifiable"
    }
  ]
}

Guidelines:
- Be SELECTIVE. Only extract claims that could mislead if wrong: statistics, attributed research, cause-effect assertions, comparative claims.
- Skip trivial or low-stakes statements.
- Short video (< 15 min): max 5-8 claims. Medium (15-45 min): max 8-12 claims. Long (> 45 min): max 12-20 claims.
- If the video contains more claims than these limits, prioritize the ones with the highest potential for harm or misinformation -- claims that could change decisions, spread false information, or mislead on important topics.
- Classify each:
  - sourced_fact: cites a specific study, report, organization, or data point
  - unsourced_fact: stated as truth with no source (e.g., "Studies show..." without naming which)
  - opinion_as_fact: a genuinely controversial or debatable position where reasonable experts in the field would disagree. NOT to be used for: reporting someone's stated reason or position ("Trump withdrew citing X" is a factual claim about what someone did, not an opinion), historical consensus ("the coup damaged trust" is documented history, not opinion), or practical advice backed by professional consensus.
  - anecdotal_generalization: a single personal story explicitly generalized as universal truth, where the generalization is NOT backed by broader evidence. If the underlying point is widely supported by research or professional consensus, it is generally_accepted_knowledge.
  - certain_prediction: future outcome stated with unwarranted certainty
  - generally_accepted_knowledge: advice, guidance, or observations that most professionals in the relevant field would endorse, even if the speaker uses casual, absolute, or hyperbolic language. Also includes well-documented historical consensus and widely accepted cause-effect relationships. Judge the SUBSTANCE, not the phrasing.
- CLASSIFICATION RULES:
  - "X said/claimed/argued Y" or "X did Y because Z" -> This is a factual claim about what someone said or did. Classify as sourced_fact or unsourced_fact and verify whether X actually said/did it. Do NOT classify as opinion_as_fact.
  - Historical events with interpretive framing ("the coup destroyed trust", "the war destabilized the region") -> If this is the documented historical consensus, classify as generally_accepted_knowledge. Only classify as opinion_as_fact if historians genuinely debate the interpretation.
  - When deciding between opinion_as_fact and generally_accepted_knowledge, ask: "Would most credentialed professionals in this field agree?" If yes, it is generally_accepted_knowledge.
- Include speaker name/role when identifiable.

Return ONLY valid JSON.`;

export const analyzeContent = async (
  transcript: string,
  metadata: VideoMetadata,
  apiKey: string
): Promise<ContentAnalysis> => {
  const client = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(transcript, metadata);

  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_CONTENT_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: CONTENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  } as unknown as Anthropic.MessageCreateParamsStreaming);

  const response = await stream.finalMessage();
  const text = extractText(response);
  return parseResponse<ContentAnalysis>(text, ["synopsis", "segments", "keyTakeaways"]);
};

export const extractClaims = async (
  transcript: string,
  metadata: VideoMetadata,
  apiKey: string
): Promise<ClaimExtractionResult> => {
  const client = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(transcript, metadata);

  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_CLAIMS_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: CLAIMS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  } as unknown as Anthropic.MessageCreateParamsStreaming);

  const response = await stream.finalMessage();
  const text = extractText(response);
  return parseResponse<ClaimExtractionResult>(text, ["claims"]);
};

const buildUserPrompt = (transcript: string, metadata: VideoMetadata): string => {
  return `Video Title: ${metadata.title}
Channel: ${metadata.channelName}
Duration: ${metadata.duration}

Transcript:
${transcript}`;
};

const extractText = (response: Anthropic.Message): string => {
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    const blockTypes = response.content.map((b) => b.type).join(", ");
    const stopReason = response.stop_reason;
    throw new Error(
      `Claude returned no text content. ` +
        `Response contained: [${blockTypes}], stop_reason: ${stopReason}. ` +
        `This likely means max_tokens was exhausted by thinking.`
    );
  }
  return block.text;
};

const parseResponse = <T>(text: string, requiredFields: string[]): T => {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    for (const field of requiredFields) {
      if (parsed[field] === undefined) {
        throw new Error(`Missing required field: '${field}'`);
      }
    }

    return parsed as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse response: ${message}`);
  }
};

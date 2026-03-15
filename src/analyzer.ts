import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, MAX_CONTENT_TOKENS, MAX_CLAIMS_TOKENS } from "./config.js";
import { withRetry } from "./retry.js";
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
  - SEGMENT SUMMARIES: Write each summary as a direct explanation of the topic, NOT a description of what the video covers. Teach the reader the concept, fact, or story — as if they are reading a mini-explanation. Use simple analogies from the video when they help. Mix third-person and second-person naturally for clarity.
    BAD: "Explains derivatives as financial instruments that derive their value from an underlying asset."
    GOOD: "Derivatives are financial instruments that derive their value from an underlying asset, such as stocks. Think of it like dairy products — their value comes from milk prices."
- SPEAKERS: When multiple speakers are detectable, attribute statements using names if introduced (e.g., "According to Dr. Ramanujan, ...") or roles ("the host", "the guest"). Single-speaker videos need no attribution.
- KEY TAKEAWAYS: Short videos (< 15 min): 5-7. Medium (15-45 min): 7-10. Long (> 45 min): 10-15. Each should be a standalone insight.
- IGNORE sponsored segments, ad reads, and product promotions entirely. Do not summarize them or include them as segments.

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

WHAT IS A CLAIM:
A claim is a statement that asserts something to be true or false, and that could be verified, challenged, or debated. Do NOT extract: descriptions, instructions, personal preferences, narrative framing, or rhetorical questions.

CORE PRINCIPLE:
Always classify based on the EPISTEMIC STRENGTH of the claim — how well-supported or verifiable the underlying assertion is — NOT the linguistic pattern or strength of the language used. "Far more X than Y" is not automatically an opinion. "X will definitely happen" is not automatically an unwarranted prediction. Evaluate the substance first, then classify.

SELECTION GUIDELINES:
- Be SELECTIVE. Only extract claims that could mislead if wrong: statistics, attributed research, cause-effect assertions, comparative claims.
- Skip trivial or low-stakes statements.
- Short video (< 15 min): max 5-8 claims. Medium (15-45 min): max 8-12 claims. Long (> 45 min): max 12-20 claims.
- If the video contains more claims than these limits, prioritize the ones with the highest potential for harm or misinformation -- claims that could change decisions, spread false information, or mislead on important topics.

CLAIM TYPES:
- sourced_fact: Cites a specific study, report, organization, or data point. The source is named or identifiable.
- unsourced_fact: Stated as truth with no specific source provided (e.g., "Studies show..." without naming which study).
- opinion_as_fact: A genuinely controversial or debatable position where reasonable, credentialed experts in the field actively disagree. The key test: is there a real, ongoing debate among experts? If not, it is NOT opinion_as_fact. Do NOT use for: reporting someone's stated reason or position, historical consensus, practical advice backed by professional consensus, or comparisons that are structurally verifiable.
- anecdotal_generalization: A single personal story explicitly generalized as universal truth, where the generalization is NOT backed by broader evidence. If the underlying point is widely supported by research or professional consensus, classify as generally_accepted_knowledge instead.
- certain_prediction: A future outcome stated with certainty that is NOT supported by scientific consensus or strong evidence. If the prediction is well-supported by established science or evidence (e.g., climate projections, well-established economic models), classify as generally_accepted_knowledge instead.
- generally_accepted_knowledge: Advice, guidance, or observations that most professionals in the relevant field would endorse, even if stated with casual, absolute, or hyperbolic language. Also includes: well-documented historical consensus, widely accepted cause-effect relationships, and comparisons that are logically or structurally verifiable (e.g., "global warming can cause huge negative ramifications for the human society if not stopped", "APIs & MCPs with fixed input and output schemas are more deterministic than natural language prompts" follows from how the systems work, not from opinion).

CLASSIFICATION RULES:
- "X said/claimed/argued Y" or "X did Y because Z" -> Factual claim about what someone said or did. Classify as sourced_fact or unsourced_fact. Do NOT classify as opinion_as_fact.
- Historical events with interpretive framing ("the coup destroyed trust") -> If documented historical consensus, classify as generally_accepted_knowledge. Only use opinion_as_fact if historians genuinely debate the interpretation.
- Structurally verifiable comparisons ("X architecture is more Y than Z") -> If the comparison follows logically from how the systems work, classify as generally_accepted_knowledge. Only use opinion_as_fact if the comparison requires subjective judgment with no clear structural basis.
- Predictions backed by scientific consensus or strong evidence -> Classify as generally_accepted_knowledge, not certain_prediction.
- When torn between opinion_as_fact and generally_accepted_knowledge, ask: "Would most credentialed professionals in this field agree?" If yes, it is generally_accepted_knowledge.
- Include speaker name/role when identifiable.
- IGNORE sponsored segments, ad reads, and product promotions entirely. Do not extract claims from them.

Return ONLY valid JSON.`;

export const analyzeContent = async (
  transcript: string,
  metadata: VideoMetadata,
  apiKey: string,
  transcriptLanguage?: "en" | "hi"
): Promise<ContentAnalysis> => {
  return withRetry(async () => {
    const client = new Anthropic({ apiKey });
    const userPrompt = buildUserPrompt(transcript, metadata, transcriptLanguage);

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
  }, "Content analysis");
};

export const extractClaims = async (
  transcript: string,
  metadata: VideoMetadata,
  apiKey: string,
  transcriptLanguage?: "en" | "hi"
): Promise<ClaimExtractionResult> => {
  return withRetry(async () => {
    const client = new Anthropic({ apiKey });
    const userPrompt = buildUserPrompt(transcript, metadata, transcriptLanguage);

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
  }, "Claim extraction");
};

const buildUserPrompt = (
  transcript: string,
  metadata: VideoMetadata,
  transcriptLanguage?: "en" | "hi"
): string => {
  const parts = [
    `Video Title: ${metadata.title}`,
    `Channel: ${metadata.channelName}`,
    `Duration: ${metadata.duration}`,
    `Published: ${metadata.publishedAt}`,
  ];

  if (transcriptLanguage === "hi") {
    parts.push(
      "",
      "NOTE: This transcript is in Hindi. Analyze it and provide ALL output in English."
    );
  }

  if (metadata.description) {
    parts.push("", "Video Description:", metadata.description);
  }

  parts.push("", "Transcript:", transcript);

  return parts.join("\n");
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

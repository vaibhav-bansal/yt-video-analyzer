import Anthropic from "@anthropic-ai/sdk";
import { parse as parsePartial, STR, ARR, OBJ, NUM } from "partial-json";
import { CLAUDE_MODEL, MAX_CONTENT_TOKENS, MAX_CLAIMS_TOKENS } from "./config.js";
import { withRetry } from "./retry.js";
import { CONTENT_SYSTEM_PROMPT, CLAIMS_SYSTEM_PROMPT } from "./prompts.js";
import type { ExtractedClaim, SegmentSummary, VideoMetadata } from "./types.js";

export interface ContentAnalysis {
  synopsis: string;
  keyTakeaways: string[];
  segments: SegmentSummary[];
}

export interface ClaimExtractionResult {
  claims: ExtractedClaim[];
}

export interface ContentStreamCallbacks {
  onSynopsisDelta?: (delta: string) => void;
  onTakeawayDelta?: (index: number, delta: string) => void;
  onTakeawayComplete?: (index: number) => void;
  onSegmentHeader?: (index: number, header: { timestamp: string; endTimestamp: string; title: string; startSeconds: number }) => void;
  onSegmentDelta?: (index: number, delta: string) => void;
  onSegmentComplete?: (index: number) => void;
}

export const analyzeContent = async (
  transcript: string,
  metadata: VideoMetadata,
  apiKey: string,
  transcriptLanguage?: "en" | "hi",
  callbacks?: ContentStreamCallbacks
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

    if (callbacks) {
      let accumulatedJson = "";
      let lastSynopsisLen = 0;
      let lastTakeawayIdx = -1;
      let lastTakeawayLen = 0;
      let lastSegmentIdx = -1;
      let lastSegmentSummaryLen = 0;
      const segmentHeadersSent = new Set<number>();

      stream.on("text", () => {
        // Rebuild accumulated JSON from all text blocks so far
        const snapshot = stream.currentMessage;
        if (!snapshot) return;
        accumulatedJson = "";
        for (const block of snapshot.content) {
          if (block.type === "text") {
            accumulatedJson += block.text;
          }
        }

        // Strip markdown fences if present
        let jsonStr = accumulatedJson;
        const fenceStart = jsonStr.indexOf("```");
        if (fenceStart !== -1) {
          const afterFence = jsonStr.indexOf("\n", fenceStart);
          if (afterFence !== -1) {
            jsonStr = jsonStr.slice(afterFence + 1);
            const fenceEnd = jsonStr.lastIndexOf("```");
            if (fenceEnd !== -1) {
              jsonStr = jsonStr.slice(0, fenceEnd);
            }
          }
        }

        try {
          const parsed = parsePartial(jsonStr, STR | ARR | OBJ | NUM);

          // Synopsis delta
          if (parsed.synopsis && typeof parsed.synopsis === "string") {
            if (parsed.synopsis.length > lastSynopsisLen) {
              callbacks.onSynopsisDelta?.(parsed.synopsis.slice(lastSynopsisLen));
              lastSynopsisLen = parsed.synopsis.length;
            }
          }

          // Takeaway streaming
          if (Array.isArray(parsed.keyTakeaways)) {
            const takeaways: string[] = parsed.keyTakeaways;
            // All takeaways are complete once segments key appears
            const allComplete = parsed.segments !== undefined;
            const safeCount = allComplete ? takeaways.length : Math.max(0, takeaways.length - 1);

            // Flush completed takeaways we haven't finished emitting
            for (let i = 0; i <= Math.min(safeCount - 1, takeaways.length - 1); i++) {
              if (i > lastTakeawayIdx) {
                // New completed takeaway — emit full text as delta + complete
                callbacks.onTakeawayDelta?.(i, takeaways[i]);
                callbacks.onTakeawayComplete?.(i);
                lastTakeawayIdx = i;
                lastTakeawayLen = 0;
              } else if (i === lastTakeawayIdx && i < safeCount) {
                // Already emitting this one — nothing to do, it's complete
              }
            }

            // Stream the current (potentially partial) takeaway
            const currentIdx = allComplete ? -1 : takeaways.length - 1;
            if (currentIdx > lastTakeawayIdx) {
              // Brand new partial takeaway
              const text = takeaways[currentIdx];
              if (text.length > 0) {
                callbacks.onTakeawayDelta?.(currentIdx, text);
                lastTakeawayIdx = currentIdx;
                lastTakeawayLen = text.length;
              }
            } else if (currentIdx >= 0 && currentIdx === lastTakeawayIdx) {
              // Continuing partial takeaway
              const text = takeaways[currentIdx];
              if (text.length > lastTakeawayLen) {
                callbacks.onTakeawayDelta?.(currentIdx, text.slice(lastTakeawayLen));
                lastTakeawayLen = text.length;
              }
            }
          }

          // Segment streaming
          if (Array.isArray(parsed.segments)) {
            const segments: Record<string, unknown>[] = parsed.segments;

            for (let i = 0; i < segments.length; i++) {
              const seg = segments[i];

              // Emit header once we have all header fields
              if (
                !segmentHeadersSent.has(i) &&
                seg.timestamp && seg.endTimestamp && seg.title &&
                seg.startSeconds !== undefined
              ) {
                callbacks.onSegmentHeader?.(i, {
                  timestamp: seg.timestamp as string,
                  endTimestamp: seg.endTimestamp as string,
                  title: seg.title as string,
                  startSeconds: seg.startSeconds as number,
                });
                segmentHeadersSent.has(i) || segmentHeadersSent.add(i);
              }

              // Complete previous segment when a new one starts
              if (i > lastSegmentIdx + 1) {
                // We skipped segments — flush them
                for (let j = lastSegmentIdx + 1; j < i; j++) {
                  callbacks.onSegmentComplete?.(j);
                }
                lastSegmentIdx = i - 1;
                lastSegmentSummaryLen = 0;
              }

              // Stream summary delta for the current segment
              if (i >= segments.length - 1 || i > lastSegmentIdx) {
                const summary = (seg.summary as string) || "";
                if (i > lastSegmentIdx) {
                  // New segment — complete the previous one if any
                  if (lastSegmentIdx >= 0) {
                    callbacks.onSegmentComplete?.(lastSegmentIdx);
                  }
                  lastSegmentIdx = i;
                  lastSegmentSummaryLen = 0;
                }
                if (summary.length > lastSegmentSummaryLen) {
                  callbacks.onSegmentDelta?.(i, summary.slice(lastSegmentSummaryLen));
                  lastSegmentSummaryLen = summary.length;
                }
              }
            }
          }
        } catch {
          // partial-json parse failed — skip this token, try again on the next one
        }
      });

      const response = await stream.finalMessage();
      const text = extractText(response);
      const result = parseResponse<ContentAnalysis>(text, ["synopsis", "keyTakeaways", "segments"]);

      // Flush any remaining content not yet emitted
      if (result.synopsis.length > lastSynopsisLen) {
        callbacks.onSynopsisDelta?.(result.synopsis.slice(lastSynopsisLen));
      }
      for (let i = lastTakeawayIdx + 1; i < result.keyTakeaways.length; i++) {
        callbacks.onTakeawayDelta?.(i, result.keyTakeaways[i]);
        callbacks.onTakeawayComplete?.(i);
      }
      // Complete the last partial takeaway if it wasn't completed
      if (lastTakeawayIdx >= 0 && lastTakeawayIdx < result.keyTakeaways.length) {
        const remaining = result.keyTakeaways[lastTakeawayIdx].slice(lastTakeawayLen);
        if (remaining.length > 0) {
          callbacks.onTakeawayDelta?.(lastTakeawayIdx, remaining);
        }
        callbacks.onTakeawayComplete?.(lastTakeawayIdx);
      }
      for (let i = Math.max(0, lastSegmentIdx); i < result.segments.length; i++) {
        if (!segmentHeadersSent.has(i)) {
          callbacks.onSegmentHeader?.(i, {
            timestamp: result.segments[i].timestamp,
            endTimestamp: result.segments[i].endTimestamp,
            title: result.segments[i].title,
            startSeconds: result.segments[i].startSeconds,
          });
        }
        const remaining = result.segments[i].summary.slice(
          i === lastSegmentIdx ? lastSegmentSummaryLen : 0
        );
        if (remaining.length > 0) {
          callbacks.onSegmentDelta?.(i, remaining);
        }
        callbacks.onSegmentComplete?.(i);
      }

      return result;
    }

    // Non-streaming path (CLI)
    const response = await stream.finalMessage();
    const text = extractText(response);
    return parseResponse<ContentAnalysis>(text, ["synopsis", "keyTakeaways", "segments"]);
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

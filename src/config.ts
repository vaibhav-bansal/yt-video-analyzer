import "dotenv/config";
import type { Config } from "./types.js";

export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const MAX_TRANSCRIPT_CHARS = 600_000;
export const MAX_CONTENT_TOKENS = 8_000;
export const MAX_CLAIMS_TOKENS = 4_000;
export const MAX_CREDIBILITY_TOKENS = 8_000;

export const loadConfig = (): Config => {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;

  const missing: string[] = [];
  if (!anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
  if (!youtubeApiKey) missing.push("YOUTUBE_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Set them in your environment or create a .env file.\n" +
        "See .env.example for the required format."
    );
  }

  return {
    anthropicApiKey: anthropicApiKey!,
    youtubeApiKey: youtubeApiKey!,
  };
};

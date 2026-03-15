import { readFileSync } from "fs";
import { resolve } from "path";

const promptsDir = resolve(process.cwd(), "prompts");

const loadPrompt = (filename: string): string => {
  const raw = readFileSync(resolve(promptsDir, filename), "utf-8");
  const endOfFrontmatter = raw.indexOf("---", raw.indexOf("---") + 3);
  return raw.slice(endOfFrontmatter + 3).trim();
};

export const CONTENT_SYSTEM_PROMPT = loadPrompt("content-analysis.md");
export const CLAIMS_SYSTEM_PROMPT = loadPrompt("claims-extraction.md");
export const SINGLE_CLAIM_SYSTEM_PROMPT = loadPrompt("fact-checking.md");

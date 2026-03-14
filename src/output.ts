import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatIST } from "./logger.js";
import type {
  AnalysisResult,
  CredibilityReport,
  VerifiedClaim,
  VideoMetadata,
} from "./types.js";

const ANALYSIS_DIR = join(process.cwd(), "analysis");

export const saveAnalysis = (
  analysis: AnalysisResult,
  credibility: CredibilityReport,
  metadata: VideoMetadata
): string => {
  mkdirSync(ANALYSIS_DIR, { recursive: true });

  const timestamp = formatIST(new Date());
  const safeTitle = metadata.title
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const fileName = `${timestamp}_${safeTitle}.md`;
  const filePath = join(ANALYSIS_DIR, fileName);

  const content = buildMarkdown(analysis, credibility, metadata);
  writeFileSync(filePath, content, "utf-8");

  return filePath;
};

const buildMarkdown = (
  analysis: AnalysisResult,
  credibility: CredibilityReport,
  metadata: VideoMetadata
): string => {
  const lines: string[] = [];

  // Header
  lines.push(`# ${metadata.title}`);
  lines.push("");
  lines.push(`- **Channel:** ${metadata.channelName}`);
  lines.push(`- **Duration:** ${metadata.duration}`);
  lines.push(`- **URL:** ${metadata.url}`);
  lines.push(`- **Analyzed:** ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "medium" })} IST`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Synopsis
  lines.push("## Synopsis");
  lines.push("");
  lines.push(analysis.synopsis);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Key Takeaways
  lines.push("## Key Takeaways");
  lines.push("");
  analysis.keyTakeaways.forEach((t, i) => {
    lines.push(`${i + 1}. ${t}`);
  });
  lines.push("");
  lines.push("---");
  lines.push("");

  // Segment Summaries
  lines.push("## Segment Summaries");
  lines.push("");
  for (const seg of analysis.segments) {
    const link = `https://youtu.be/${metadata.videoId}?t=${Math.floor(seg.startSeconds)}`;
    lines.push(`### [${seg.timestamp} - ${seg.endTimestamp}] ${seg.title}`);
    lines.push(`> ${link}`);
    lines.push("");
    lines.push(seg.summary);
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // Credibility Report
  lines.push("## Credibility Report");
  lines.push("");

  const groups: Record<string, VerifiedClaim[]> = {
    confirmed: [],
    contradicted: [],
    partially_true: [],
    unverifiable: [],
    not_checked: [],
  };

  for (const claim of credibility.verifiedClaims) {
    const bucket = groups[claim.status] || groups.not_checked;
    bucket.push(claim);
  }

  // Status breakdown table
  const statusEntries: [string, number][] = [];
  if (groups.confirmed.length > 0)
    statusEntries.push(["Confirmed", groups.confirmed.length]);
  if (groups.contradicted.length > 0)
    statusEntries.push(["Contradicted", groups.contradicted.length]);
  if (groups.partially_true.length > 0)
    statusEntries.push(["Partially True", groups.partially_true.length]);
  if (groups.unverifiable.length > 0)
    statusEntries.push(["Unverifiable", groups.unverifiable.length]);
  if (groups.not_checked.length > 0)
    statusEntries.push(["Flagged", groups.not_checked.length]);

  if (statusEntries.length > 0) {
    lines.push(`| Status | Count |`);
    lines.push(`|--------|-------|`);
    for (const [status, count] of statusEntries) {
      lines.push(`| ${status} | ${count} |`);
    }
    lines.push("");
  }

  if (credibility.summary) {
    lines.push(`*${credibility.summary}*`);
    lines.push("");
  }

  const labels: Record<string, string> = {
    confirmed: "Confirmed",
    contradicted: "Contradicted",
    partially_true: "Partially True",
    unverifiable: "Unverifiable",
    not_checked: "Flagged (Not Fact-Checked)",
  };

  for (const [status, claims] of Object.entries(groups)) {
    if (claims.length === 0) continue;
    lines.push(`### ${labels[status]}`);
    lines.push("");
    for (const claim of claims) {
      const speaker = claim.speaker ? ` (${claim.speaker})` : "";
      lines.push(`- **[${claim.timestamp}]**${speaker} "${claim.claim}"`);
      lines.push(`  - Type: ${formatClaimType(claim.type)}`);
      if (claim.evidence) {
        lines.push(`  - ${claim.evidence}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
};

const formatClaimType = (type: string): string => {
  const labels: Record<string, string> = {
    sourced_fact: "Sourced Fact",
    unsourced_fact: "Unsourced Fact",
    opinion_as_fact: "Opinion as Fact",
    anecdotal_generalization: "Anecdotal Generalization",
    certain_prediction: "Certain Prediction",
    generally_accepted_knowledge: "Generally Accepted Knowledge",
  };
  return labels[type] || type;
};

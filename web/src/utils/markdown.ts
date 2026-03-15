import type {
  MetadataEvent,
  ExtractedClaim,
  VerifiedClaim,
  SegmentSummary,
} from "@shared/types";

interface AnalysisData {
  metadata: MetadataEvent;
  synopsis: string | null;
  segments: SegmentSummary[] | null;
  keyTakeaways: string[] | null;
  claims: ExtractedClaim[] | null;
  verifiedClaims: Record<number, VerifiedClaim>;
  summary: string | null;
}

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

const formatPublishedDate = (dateStr: string): string => {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" });
};

export const buildAnalysisMarkdown = (data: AnalysisData): string => {
  const { metadata, synopsis, segments, keyTakeaways, claims, verifiedClaims, summary } = data;
  const lines: string[] = [];

  // Header
  lines.push(`# ${metadata.title}`);
  lines.push("");
  lines.push(`- **Channel:** ${metadata.channelName}`);
  lines.push(`- **Duration:** ${metadata.duration}`);
  lines.push(`- **Published:** ${formatPublishedDate(metadata.publishedAt)}`);
  lines.push(`- **URL:** ${metadata.url}`);
  lines.push(`- **Analyzed:** ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "medium" })} IST`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Synopsis
  if (synopsis) {
    lines.push("## Synopsis");
    lines.push("");
    lines.push(synopsis);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Key Takeaways
  if (keyTakeaways && keyTakeaways.length > 0) {
    lines.push("## Key Takeaways");
    lines.push("");
    keyTakeaways.forEach((t, i) => {
      lines.push(`${i + 1}. ${t}`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Segment Summaries
  if (segments && segments.length > 0) {
    lines.push("## Segment Summaries");
    lines.push("");
    for (const seg of segments) {
      const link = `https://youtu.be/${metadata.videoId}?t=${Math.floor(seg.startSeconds)}`;
      lines.push(`### [${seg.timestamp} - ${seg.endTimestamp}] ${seg.title}`);
      lines.push(`> ${link}`);
      lines.push("");
      lines.push(seg.summary);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // Credibility Report
  if (claims && claims.length > 0) {
    lines.push("## Credibility Report");
    lines.push("");

    const verifiedList = Object.values(verifiedClaims);

    const groups: Record<string, VerifiedClaim[]> = {
      confirmed: [],
      contradicted: [],
      partially_true: [],
      unverifiable: [],
      not_checked: [],
    };

    for (const claim of verifiedList) {
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
      lines.push("| Status | Count |");
      lines.push("|--------|-------|");
      for (const [status, count] of statusEntries) {
        lines.push(`| ${status} | ${count} |`);
      }
      lines.push("");
    }

    if (summary) {
      lines.push(`*${summary}*`);
      lines.push("");
    }

    const labels: Record<string, string> = {
      confirmed: "Confirmed",
      contradicted: "Contradicted",
      partially_true: "Partially True",
      unverifiable: "Unverifiable",
      not_checked: "Flagged (Not Fact-Checked)",
    };

    for (const [status, groupClaims] of Object.entries(groups)) {
      if (groupClaims.length === 0) continue;
      lines.push(`### ${labels[status]}`);
      lines.push("");
      for (const claim of groupClaims) {
        const speaker = claim.speaker ? ` (${claim.speaker})` : "";
        lines.push(`- **[${claim.timestamp}]**${speaker} "${claim.claim}"`);
        lines.push(`  - Type: ${formatClaimType(claim.type)}`);
        if (claim.evidence) {
          lines.push(`  - ${claim.evidence}`);
        }
        lines.push("");
      }
    }

    // References
    const allSources = verifiedList
      .flatMap((c) => c.sources || [])
      .filter((s) => s.url && s.title);

    const uniqueSources = [...new Map(allSources.map((s) => [s.url, s])).values()];

    if (uniqueSources.length > 0) {
      lines.push("---");
      lines.push("");
      lines.push("## References");
      lines.push("");
      uniqueSources.forEach((source, i) => {
        lines.push(`${i + 1}. [${source.title}](${source.url})`);
      });
      lines.push("");
    }
  }

  return lines.join("\n");
};

export const downloadMarkdown = (data: AnalysisData): void => {
  const markdown = buildAnalysisMarkdown(data);
  const safeTitle = data.metadata.title
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const fileName = `${safeTitle}-analysis.md`;

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

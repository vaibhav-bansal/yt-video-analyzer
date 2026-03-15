import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { extractVideoId, getTranscript } from "./transcript.js";
import { analyzeContent, extractClaims } from "./analyzer.js";
import type { ContentAnalysis, ClaimExtractionResult } from "./analyzer.js";
import { assessCredibility } from "./credibility.js";
import { createLogger } from "./logger.js";
import { saveAnalysis, saveAnalysisJson } from "./output.js";
import type { CredibilityReport, ExtractedClaim, VerifiedClaim } from "./types.js";

const main = async (): Promise<void> => {
  const input = process.argv[2];

  if (!input) {
    console.error(
      chalk.red("Usage: npx tsx src/index.ts <youtube-url>\n") +
        'Example: npx tsx src/index.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ"'
    );
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const videoId = extractVideoId(input);
  const log = createLogger(videoId);
  log.info(`Starting analysis for video: ${input}`);
  log.info(`Extracted video ID: ${videoId}`);

  // Step 1: Fetch transcript + metadata
  const transcriptSpinner = ora("Fetching transcript and video metadata...").start();
  log.step("Fetch transcript and metadata");
  let transcript;
  try {
    transcript = await getTranscript(videoId, config.youtubeApiKey);
    const langLabel = transcript.transcriptLanguage === "hi" ? ", language: hi" : "";
    transcriptSpinner.succeed(
      `Fetched transcript (${transcript.segments.length} segments${langLabel})`
    );
    log.stepDone("Fetch transcript and metadata", `${transcript.segments.length} segments, video: "${transcript.metadata.title}"`);
    log.info(`Video title: ${transcript.metadata.title}`);
    log.info(`Channel: ${transcript.metadata.channelName}`);
    log.info(`Duration: ${transcript.metadata.duration}`);
    log.info(`Transcript length: ${transcript.formattedTranscript.length} characters`);
  } catch (err) {
    transcriptSpinner.fail("Failed to fetch transcript");
    log.stepFail("Fetch transcript and metadata", (err as Error).message);
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Step 2: Run content analysis and claim extraction in parallel (decoupled)
  const analysisSpinner = ora("Analyzing video content...").start();
  log.step("Parallel analysis: content + claims");

  const contentPromise = analyzeContent(
    transcript.formattedTranscript,
    transcript.metadata,
    config.anthropicApiKey,
    transcript.transcriptLanguage
  ).then((result) => {
    log.stepDone("Content analysis", `${result.segments.length} segments, ${result.keyTakeaways.length} takeaways`);
    return result;
  }).catch((err) => {
    log.stepFail("Content analysis", (err as Error).message);
    return null;
  });

  const claimsPromise = extractClaims(
    transcript.formattedTranscript,
    transcript.metadata,
    config.anthropicApiKey,
    transcript.transcriptLanguage
  ).then((result) => {
    log.stepDone("Claim extraction", `${result.claims.length} claims`);
    log.info(`Claim breakdown: ${formatClaimBreakdown(result.claims)}`);
    return result;
  }).catch((err) => {
    log.stepFail("Claim extraction", (err as Error).message);
    return null;
  });

  // Wait for claims first -- they unlock the credibility step
  const claimsResult = await claimsPromise;

  let reportableClaims: ExtractedClaim[] = [];
  let credibility: CredibilityReport = {
    verifiedClaims: [],
    summary: "No claims were extracted.",
  };

  if (claimsResult) {
    analysisSpinner.text = "Claims extracted, verifying credibility...";

    // Filter out generally_accepted_knowledge -- not worth reporting
    reportableClaims = claimsResult.claims.filter(
      (c) => c.type !== "generally_accepted_knowledge"
    );
    const droppedCount = claimsResult.claims.length - reportableClaims.length;
    if (droppedCount > 0) {
      log.info(`Filtered out ${droppedCount} generally_accepted_knowledge claims`);
    }

    // Separate factual claims for verification vs non-factual for passthrough
    const factualClaims = reportableClaims.filter(
      (c) => c.type === "sourced_fact" || c.type === "unsourced_fact"
    );
    const nonFactualClaims = reportableClaims.filter(
      (c) => c.type !== "sourced_fact" && c.type !== "unsourced_fact"
    );

    log.info(`Factual claims for verification: ${factualClaims.length}, non-factual (flagged): ${nonFactualClaims.length}`);

    // Start credibility (runs in parallel with content which may still be going)
    if (factualClaims.length > 0) {
      try {
        credibility = await assessCredibility(
          factualClaims,
          transcript.metadata,
          config.anthropicApiKey,
          log
        );
      } catch (err) {
        log.stepFail("Credibility assessment", (err as Error).message);
        credibility = {
          verifiedClaims: factualClaims.map((c) => ({
            ...c,
            status: "unverifiable" as const,
            evidence: "Credibility assessment failed.",
          })),
          summary: "Credibility assessment encountered an error.",
        };
      }
    } else {
      credibility = {
        verifiedClaims: [],
        summary: "No factual claims required verification.",
      };
    }

    // Merge non-factual claims back as "not_checked"
    const nonFactualVerified: VerifiedClaim[] = nonFactualClaims.map((c) => ({
      ...c,
      status: "not_checked" as const,
      evidence: `Flagged as ${formatClaimType(c.type)} -- not subject to fact-checking.`,
    }));
    credibility.verifiedClaims = [
      ...credibility.verifiedClaims,
      ...nonFactualVerified,
    ];
  }

  // Wait for content analysis (may already be done)
  const content = await contentPromise;

  if (!content && !claimsResult) {
    analysisSpinner.fail("Both content analysis and claim extraction failed");
    log.stepFail("Parallel analysis", "Both steps failed");
    console.error(chalk.red("Both content analysis and claim extraction failed. Check logs for details."));
    process.exit(1);
  }

  const segmentCount = content?.segments.length ?? 0;
  const claimCount = credibility.verifiedClaims.length;
  analysisSpinner.succeed(
    `Analysis complete (${segmentCount} segments, ${claimCount} claims${!content ? " -- content analysis failed, partial report" : ""}${!claimsResult ? " -- claim extraction failed, partial report" : ""})`
  );
  log.stepDone("Parallel analysis", `${segmentCount} segments, ${claimCount} claims assessed`);

  const analysis = {
    synopsis: content?.synopsis || "Content analysis failed -- synopsis unavailable.",
    segments: content?.segments || [],
    keyTakeaways: content?.keyTakeaways || [],
    claims: reportableClaims,
  };

  // Save with fallback chain: Markdown -> JSON -> stdout
  try {
    const analysisPath = saveAnalysis(analysis, credibility, transcript.metadata);
    log.info(`Analysis saved to: ${analysisPath}`);
    console.log(chalk.green(`\nAnalysis saved to: ${analysisPath}`));
  } catch (mdErr) {
    log.error(`Markdown save failed: ${(mdErr as Error).message}`);
    console.error(chalk.yellow("Markdown save failed, trying JSON fallback..."));
    try {
      const jsonPath = saveAnalysisJson(analysis, credibility, transcript.metadata);
      log.info(`JSON fallback saved to: ${jsonPath}`);
      console.log(chalk.yellow(`Analysis saved as JSON: ${jsonPath}`));
    } catch (jsonErr) {
      log.error(`JSON save also failed: ${(jsonErr as Error).message}`);
      console.error(chalk.yellow("JSON save also failed, printing to stdout..."));
      console.log(JSON.stringify({ analysis, credibility, metadata: transcript.metadata }, null, 2));
    }
  }

  log.info("Analysis complete");
  console.log(chalk.gray(`Log saved to: ${log.filePath}`));
};

const formatClaimBreakdown = (
  claims: { type: string }[]
): string => {
  const counts: Record<string, number> = {};
  for (const c of claims) {
    counts[c.type] = (counts[c.type] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => `${type}=${count}`)
    .join(", ");
};

const formatClaimType = (type: string): string => {
  const labels: Record<string, string> = {
    sourced_fact: "Sourced Fact",
    unsourced_fact: "Unsourced Fact",
    opinion_as_fact: "Opinion as Fact",
    anecdotal_generalization: "Anecdotal Generalization",
    certain_prediction: "Certain Prediction",
  };
  return labels[type] || type;
};

main().catch((err) => {
  console.error(chalk.red(`Unexpected error: ${(err as Error).message}`));
  process.exit(1);
});

import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { extractVideoId, getTranscript } from "./transcript.js";
import { analyzeContent, extractClaims } from "./analyzer.js";
import type { ContentAnalysis, ClaimExtractionResult } from "./analyzer.js";
import { assessCredibility } from "./credibility.js";
import { createLogger } from "./logger.js";
import { saveAnalysis } from "./output.js";
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
    transcriptSpinner.succeed(
      `Fetched transcript (${transcript.segments.length} segments)`
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

  // Step 2: Run content analysis and claim extraction in parallel
  // Use racing pattern: credibility starts as soon as claims are ready
  const analysisSpinner = ora("Analyzing video content...").start();
  log.step("Parallel analysis: content + claims");

  const contentPromise = analyzeContent(
    transcript.formattedTranscript,
    transcript.metadata,
    config.anthropicApiKey
  );

  const claimsPromise = extractClaims(
    transcript.formattedTranscript,
    transcript.metadata,
    config.anthropicApiKey
  );

  let content: ContentAnalysis;
  let claimsResult: ClaimExtractionResult;
  let credibility: CredibilityReport;
  let reportableClaims: ExtractedClaim[];

  try {
    // Wait for claims first -- they unlock the credibility step
    claimsResult = await claimsPromise;
    log.stepDone("Claim extraction", `${claimsResult.claims.length} claims`);
    log.info(`Claim breakdown: ${formatClaimBreakdown(claimsResult.claims)}`);

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

    // Start credibility in parallel with content analysis (which may still be running)
    const credibilityPromise = factualClaims.length > 0
      ? assessCredibility(
          factualClaims,
          transcript.metadata,
          config.anthropicApiKey,
          log
        )
      : Promise.resolve({
          verifiedClaims: [],
          summary: "No factual claims required verification.",
        } as CredibilityReport);

    // Await both content analysis and credibility in parallel
    const [contentResult, credibilityResult] = await Promise.all([
      contentPromise.then((result) => {
        log.stepDone("Content analysis", `${result.segments.length} segments, ${result.keyTakeaways.length} takeaways`);
        return result;
      }),
      credibilityPromise,
    ]);

    content = contentResult;
    credibility = credibilityResult;

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

    analysisSpinner.succeed(
      `Analysis complete (${content.segments.length} segments, ${claimsResult.claims.length} claims, ${credibility.verifiedClaims.length} verified)`
    );
    log.stepDone("Parallel analysis", `${content.segments.length} segments, ${content.keyTakeaways.length} takeaways, ${credibility.verifiedClaims.length} claims assessed`);
  } catch (err) {
    analysisSpinner.fail("Analysis failed");
    log.stepFail("Parallel analysis", (err as Error).message);
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const analysis = {
    synopsis: content.synopsis,
    segments: content.segments,
    keyTakeaways: content.keyTakeaways,
    claims: reportableClaims,
  };

  const analysisPath = saveAnalysis(analysis, credibility, transcript.metadata);
  log.info(`Analysis saved to: ${analysisPath}`);
  log.info("Analysis complete");
  console.log(chalk.green(`\nAnalysis saved to: ${analysisPath}`));
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

import type { Request, Response } from "express";
import { extractVideoId, getTranscript } from "../src/transcript.js";
import { analyzeContent, extractClaims } from "../src/analyzer.js";
import { assessCredibility } from "../src/credibility.js";
import { createLogger } from "../src/logger.js";
import { saveAnalysis } from "../src/output.js";
import type { ExtractedClaim, VerifiedClaim } from "../src/types.js";
import type { Config } from "../src/types.js";
import { sendSSE, setSSEHeaders } from "./events.js";

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

export const handleAnalyze = (config: Config) => {
  return async (req: Request, res: Response): Promise<void> => {
    const url = req.query.url as string;

    if (!url) {
      res.status(400).json({ error: "Missing 'url' query parameter" });
      return;
    }

    let videoId: string;
    try {
      videoId = extractVideoId(url);
    } catch {
      res.status(400).json({ error: "Invalid YouTube URL" });
      return;
    }

    setSSEHeaders(res);

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    const log = createLogger(videoId);
    log.info(`[Web] Starting analysis for: ${url}`);

    try {
      // Step 1: Fetch transcript + metadata
      const transcript = await getTranscript(videoId, config.youtubeApiKey);

      if (clientDisconnected) return;

      sendSSE(res, "metadata", {
        videoId: transcript.metadata.videoId,
        title: transcript.metadata.title,
        channelName: transcript.metadata.channelName,
        duration: transcript.metadata.duration,
        publishedAt: transcript.metadata.publishedAt,
        url: transcript.metadata.url,
        transcriptLanguage: transcript.transcriptLanguage,
      });

      // Step 2: Run content analysis and claim extraction in parallel
      const contentPromise = analyzeContent(
        transcript.formattedTranscript,
        transcript.metadata,
        config.anthropicApiKey,
        transcript.transcriptLanguage
      );

      const claimsPromise = extractClaims(
        transcript.formattedTranscript,
        transcript.metadata,
        config.anthropicApiKey,
        transcript.transcriptLanguage
      );

      // Wait for claims first (unlocks credibility)
      const claimsResult = await claimsPromise;

      if (clientDisconnected) return;

      // Filter out generally_accepted_knowledge
      const reportableClaims = claimsResult.claims.filter(
        (c) => c.type !== "generally_accepted_knowledge"
      );

      sendSSE(res, "claims", { claims: reportableClaims });

      // Separate factual vs non-factual
      const factualClaims = reportableClaims.filter(
        (c) => c.type === "sourced_fact" || c.type === "unsourced_fact"
      );
      const nonFactualClaims = reportableClaims.filter(
        (c) => c.type !== "sourced_fact" && c.type !== "unsourced_fact"
      );

      // Emit non-factual claims as not_checked immediately
      for (let i = 0; i < reportableClaims.length; i++) {
        const claim = reportableClaims[i];
        if (claim.type !== "sourced_fact" && claim.type !== "unsourced_fact") {
          if (clientDisconnected) return;
          sendSSE(res, "claimVerified", {
            index: i,
            verifiedClaim: {
              ...claim,
              status: "not_checked",
              evidence: `Flagged as ${formatClaimType(claim.type)} -- not subject to fact-checking.`,
            },
          });
        }
      }

      // Build index mapping: factualClaims index -> reportableClaims index
      const factualIndexMap = new Map<number, number>();
      let factualIdx = 0;
      for (let i = 0; i < reportableClaims.length; i++) {
        const c = reportableClaims[i];
        if (c.type === "sourced_fact" || c.type === "unsourced_fact") {
          factualIndexMap.set(factualIdx, i);
          factualIdx++;
        }
      }

      // Start credibility with per-claim streaming callback
      const credibilityPromise = factualClaims.length > 0
        ? assessCredibility(
            factualClaims,
            transcript.metadata,
            config.anthropicApiKey,
            log,
            (factualIndex: number, verifiedClaim: VerifiedClaim) => {
              if (clientDisconnected) return;
              const reportableIndex = factualIndexMap.get(factualIndex);
              if (reportableIndex !== undefined) {
                sendSSE(res, "claimVerified", {
                  index: reportableIndex,
                  verifiedClaim,
                });
              }
            }
          )
        : Promise.resolve({
            verifiedClaims: [] as VerifiedClaim[],
            summary: "No factual claims required verification.",
          });

      // Wait for both content analysis and credibility
      const [contentResult, credibilityResult] = await Promise.all([
        contentPromise,
        credibilityPromise,
      ]);

      if (clientDisconnected) return;

      sendSSE(res, "content", {
        synopsis: contentResult.synopsis,
        segments: contentResult.segments,
        keyTakeaways: contentResult.keyTakeaways,
      });

      // Save analysis markdown file (same as CLI)
      const nonFactualVerified: VerifiedClaim[] = nonFactualClaims.map((c) => ({
        ...c,
        status: "not_checked" as const,
        evidence: `Flagged as ${formatClaimType(c.type)} -- not subject to fact-checking.`,
      }));
      const analysis = {
        synopsis: contentResult.synopsis,
        segments: contentResult.segments,
        keyTakeaways: contentResult.keyTakeaways,
        claims: reportableClaims,
      };
      const credibility = {
        verifiedClaims: [...credibilityResult.verifiedClaims, ...nonFactualVerified],
        summary: credibilityResult.summary,
      };
      const filePath = saveAnalysis(analysis, credibility, transcript.metadata);
      log.info(`[Web] Analysis saved to: ${filePath}`);

      sendSSE(res, "complete", {
        summary: credibilityResult.summary,
      });

      res.end();
      log.info("[Web] Analysis complete, stream closed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[Web] Analysis failed: ${message}`);

      if (!clientDisconnected) {
        sendSSE(res, "error", {
          stage: "analysis",
          message,
        });
        res.end();
      }
    }
  };
};

import type { Request, Response } from "express";
import { retrySingleClaim } from "../src/credibility.js";
import { createLogger } from "../src/logger.js";
import type { Config } from "../src/types.js";
import type { ExtractedClaim } from "../shared/types.js";

interface RetryClaimBody {
  claim: ExtractedClaim;
  metadata: { title: string; channelName: string };
}

export const handleRetryClaim = (config: Config) => {
  return async (req: Request, res: Response): Promise<void> => {
    const { claim, metadata } = req.body as RetryClaimBody;

    if (!claim || !metadata) {
      res.status(400).json({ error: "Missing 'claim' or 'metadata' in request body" });
      return;
    }

    const log = createLogger("retry");

    try {
      log.info(`[Retry] Retrying claim: "${claim.claim}"`);
      const verified = await retrySingleClaim(
        claim,
        { ...metadata, videoId: "", description: "", duration: "", publishedAt: "", url: "" },
        config.anthropicApiKey,
        log
      );
      res.json(verified);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[Retry] Failed: ${message}`);
      res.status(504).json({
        ...claim,
        status: "timeout",
        evidence: "Verification timed out. Please try again.",
      });
    }
  };
};

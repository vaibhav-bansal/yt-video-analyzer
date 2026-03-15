import type {
  MetadataEvent,
  ExtractedClaim,
  VerifiedClaim,
  SegmentSummary,
} from "@shared/types";
import { downloadMarkdown } from "../utils/markdown";

interface VideoMetaProps {
  metadata: MetadataEvent;
  synopsis?: string | null;
  segments?: SegmentSummary[] | null;
  keyTakeaways?: string[] | null;
  claims?: ExtractedClaim[] | null;
  verifiedClaims?: Record<number, VerifiedClaim>;
  summary?: string | null;
  analysisComplete?: boolean;
}

export const VideoMeta = ({
  metadata,
  synopsis,
  segments,
  keyTakeaways,
  claims,
  verifiedClaims,
  summary,
  analysisComplete,
}: VideoMetaProps) => {
  const handleDownload = () => {
    downloadMarkdown({
      metadata,
      synopsis: synopsis ?? null,
      segments: segments ?? null,
      keyTakeaways: keyTakeaways ?? null,
      claims: claims ?? null,
      verifiedClaims: verifiedClaims ?? {},
      summary: summary ?? null,
    });
  };

  return (
    <div className="video-meta fade-in">
      <div className="video-meta-info">
        <h2>{metadata.title}</h2>
        <div className="meta-details">
          <span>{metadata.channelName}</span>
          <span className="separator">|</span>
          <span>{metadata.duration}</span>
          <span className="separator">|</span>
          <span>{metadata.publishedAt}</span>
        </div>
        <a
          href={metadata.url}
          target="_blank"
          rel="noopener noreferrer"
          className="video-link"
        >
          Watch on YouTube
        </a>
      </div>
      <button
        className="download-btn"
        onClick={handleDownload}
        disabled={!analysisComplete}
      >
        Download Analysis
      </button>
    </div>
  );
};

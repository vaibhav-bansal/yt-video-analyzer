import type { ExtractedClaim, VerifiedClaim } from "@shared/types";

interface ClaimCardProps {
  claim: ExtractedClaim;
  verified?: VerifiedClaim;
  onRetry?: () => void;
  retrying?: boolean;
}

const statusLabels: Record<string, string> = {
  confirmed: "Confirmed",
  contradicted: "Contradicted",
  partially_true: "Partially True",
  unverifiable: "Unverifiable",
  not_checked: "Not Checked",
  timeout: "Timed Out",
};

const claimTypeLabels: Record<string, string> = {
  sourced_fact: "Sourced Fact",
  unsourced_fact: "Unsourced Fact",
  opinion_as_fact: "Opinion as Fact",
  anecdotal_generalization: "Anecdotal Generalization",
  certain_prediction: "Certain Prediction",
};

export const ClaimCard = ({ claim, verified, onRetry, retrying }: ClaimCardProps) => {
  const status = verified?.status ?? "pending";
  const isTimeout = status === "timeout";
  const statusLabel = status === "pending"
    ? "Verifying..."
    : statusLabels[status] ?? status;

  return (
    <div className={`claim-card claim-${status}`}>
      <div className="claim-header">
        <span className="claim-timestamp">{claim.timestamp}</span>
        {isTimeout ? (
          <button
            className="claim-retry-btn"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? "Retrying..." : "Retry"}
          </button>
        ) : (
          <span className={`claim-badge badge-${status}`}>{statusLabel}</span>
        )}
      </div>
      <p className="claim-text">"{claim.claim}"</p>
      <div className="claim-meta">
        <span className="claim-type">{claimTypeLabels[claim.type] ?? claim.type}</span>
        {claim.speaker && <span className="claim-speaker">- {claim.speaker}</span>}
      </div>
      {verified?.evidence && !isTimeout && (
        <p className="claim-evidence">{verified.evidence}</p>
      )}
      {verified?.sources && verified.sources.length > 0 && (
        <div className="claim-sources">
          {verified.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title || s.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

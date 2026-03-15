import type { ExtractedClaim, VerifiedClaim } from "@shared/types";
import { ClaimCard } from "./ClaimCard";

interface ClaimsTrackerProps {
  claims: ExtractedClaim[];
  verifiedClaims: Record<number, VerifiedClaim>;
  onRetryClaim?: (index: number) => void;
  retryingClaims?: Record<number, boolean>;
}

export const ClaimsTracker = ({
  claims,
  verifiedClaims,
  onRetryClaim,
  retryingClaims,
}: ClaimsTrackerProps) => {
  const totalClaims = claims.length;
  const verifiedCount = Object.keys(verifiedClaims).length;

  return (
    <section className="section fade-in">
      <h3>
        Claims
        <span className="claims-counter">
          {verifiedCount}/{totalClaims} verified
        </span>
      </h3>
      <div className="claims-list">
        {claims.map((claim, i) => (
          <ClaimCard
            key={i}
            claim={claim}
            verified={verifiedClaims[i]}
            onRetry={() => onRetryClaim?.(i)}
            retrying={retryingClaims?.[i]}
          />
        ))}
      </div>
    </section>
  );
};

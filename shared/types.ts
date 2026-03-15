// Self-contained shared types for both server and web frontend.
// Duplicates relevant interfaces from src/types.ts to avoid cross-project import issues.

export type ClaimType =
  | "sourced_fact"
  | "unsourced_fact"
  | "opinion_as_fact"
  | "anecdotal_generalization"
  | "certain_prediction"
  | "generally_accepted_knowledge";

export type VerificationStatus =
  | "confirmed"
  | "contradicted"
  | "partially_true"
  | "unverifiable"
  | "not_checked"
  | "timeout";

export interface ClaimSource {
  url: string;
  title: string;
}

export interface SegmentSummary {
  timestamp: string;
  endTimestamp: string;
  title: string;
  summary: string;
  startSeconds: number;
}

export interface ExtractedClaim {
  claim: string;
  timestamp: string;
  type: ClaimType;
  context: string;
  speaker?: string;
}

export interface VerifiedClaim extends ExtractedClaim {
  status: VerificationStatus;
  evidence: string;
  sources?: ClaimSource[];
}

// SSE event payloads

export interface MetadataEvent {
  videoId: string;
  title: string;
  channelName: string;
  duration: string;
  publishedAt: string;
  url: string;
}

export interface ContentEvent {
  synopsis: string;
  segments: SegmentSummary[];
  keyTakeaways: string[];
}

export interface ClaimsEvent {
  claims: ExtractedClaim[];
}

export interface ClaimVerifiedEvent {
  index: number;
  verifiedClaim: VerifiedClaim;
}

export interface CompleteEvent {
  summary: string;
}

export interface ErrorEvent {
  stage: string;
  message: string;
}

export interface SSEEventMap {
  metadata: MetadataEvent;
  content: ContentEvent;
  claims: ClaimsEvent;
  claimVerified: ClaimVerifiedEvent;
  complete: CompleteEvent;
  error: ErrorEvent;
}

export type SSEEventType = keyof SSEEventMap;

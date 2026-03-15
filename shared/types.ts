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
  transcriptLanguage?: "en" | "hi";
}

export interface ContentEvent {
  synopsis: string;
  segments: SegmentSummary[];
  keyTakeaways: string[];
}

export interface SynopsisDeltaEvent {
  delta: string;
}

export interface TakeawayDeltaEvent {
  index: number;
  delta: string;
}

export interface TakeawayCompleteEvent {
  index: number;
}

export interface SegmentHeaderEvent {
  index: number;
  timestamp: string;
  endTimestamp: string;
  title: string;
  startSeconds: number;
}

export interface SegmentDeltaEvent {
  index: number;
  delta: string;
}

export interface SegmentCompleteEvent {
  index: number;
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
  synopsis_delta: SynopsisDeltaEvent;
  takeaway_delta: TakeawayDeltaEvent;
  takeaway_complete: TakeawayCompleteEvent;
  segment_header: SegmentHeaderEvent;
  segment_delta: SegmentDeltaEvent;
  segment_complete: SegmentCompleteEvent;
  claims: ClaimsEvent;
  claimVerified: ClaimVerifiedEvent;
  complete: CompleteEvent;
  error: ErrorEvent;
}

export type SSEEventType = keyof SSEEventMap;

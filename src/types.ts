export interface Config {
  anthropicApiKey: string;
  youtubeApiKey: string;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  description: string;
  channelName: string;
  duration: string;
  url: string;
}

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export interface TranscriptResult {
  metadata: VideoMetadata;
  segments: TranscriptSegment[];
  formattedTranscript: string;
}

export type ClaimType =
  | "sourced_fact"
  | "unsourced_fact"
  | "opinion_as_fact"
  | "anecdotal_generalization"
  | "certain_prediction"
  | "generally_accepted_knowledge";

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

export interface AnalysisResult {
  synopsis: string;
  segments: SegmentSummary[];
  keyTakeaways: string[];
  claims: ExtractedClaim[];
}

export type VerificationStatus =
  | "confirmed"
  | "contradicted"
  | "partially_true"
  | "unverifiable"
  | "not_checked";

export interface VerifiedClaim extends ExtractedClaim {
  status: VerificationStatus;
  evidence: string;
}

export interface CredibilityReport {
  verifiedClaims: VerifiedClaim[];
  summary: string;
}

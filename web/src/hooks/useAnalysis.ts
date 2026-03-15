import { useReducer, useCallback, useRef, useState } from "react";
import type {
  MetadataEvent,
  ContentEvent,
  SynopsisDeltaEvent,
  TakeawayDeltaEvent,
  TakeawayCompleteEvent,
  SegmentHeaderEvent,
  SegmentDeltaEvent,
  SegmentCompleteEvent,
  ClaimsEvent,
  ClaimVerifiedEvent,
  CompleteEvent,
  ErrorEvent,
  ExtractedClaim,
  VerifiedClaim,
  SegmentSummary,
} from "@shared/types";

export interface AnalysisState {
  status: "idle" | "loading" | "streaming" | "complete" | "error";
  metadata: MetadataEvent | null;
  synopsis: string | null;
  segments: SegmentSummary[] | null;
  keyTakeaways: string[] | null;
  contentComplete: boolean;
  claims: ExtractedClaim[] | null;
  verifiedClaims: Record<number, VerifiedClaim>;
  summary: string | null;
  error: string | null;
}

type Action =
  | { type: "START" }
  | { type: "METADATA"; payload: MetadataEvent }
  | { type: "SYNOPSIS_DELTA"; payload: SynopsisDeltaEvent }
  | { type: "TAKEAWAY_DELTA"; payload: TakeawayDeltaEvent }
  | { type: "TAKEAWAY_COMPLETE"; payload: TakeawayCompleteEvent }
  | { type: "SEGMENT_HEADER"; payload: SegmentHeaderEvent }
  | { type: "SEGMENT_DELTA"; payload: SegmentDeltaEvent }
  | { type: "SEGMENT_COMPLETE"; payload: SegmentCompleteEvent }
  | { type: "CONTENT"; payload: ContentEvent }
  | { type: "CLAIMS"; payload: ClaimsEvent }
  | { type: "CLAIM_VERIFIED"; payload: ClaimVerifiedEvent }
  | { type: "COMPLETE"; payload: CompleteEvent }
  | { type: "ERROR"; payload: ErrorEvent }
  | { type: "RESET" };

const initialState: AnalysisState = {
  status: "idle",
  metadata: null,
  synopsis: null,
  segments: null,
  keyTakeaways: null,
  contentComplete: false,
  claims: null,
  verifiedClaims: {},
  summary: null,
  error: null,
};

const reducer = (state: AnalysisState, action: Action): AnalysisState => {
  switch (action.type) {
    case "START":
      return { ...initialState, status: "loading" };
    case "METADATA":
      return { ...state, status: "streaming", metadata: action.payload };
    case "SYNOPSIS_DELTA":
      return {
        ...state,
        synopsis: (state.synopsis || "") + action.payload.delta,
      };
    case "TAKEAWAY_DELTA": {
      const takeaways = [...(state.keyTakeaways || [])];
      const idx = action.payload.index;
      if (idx >= takeaways.length) {
        takeaways.push(action.payload.delta);
      } else {
        takeaways[idx] = (takeaways[idx] || "") + action.payload.delta;
      }
      return { ...state, keyTakeaways: takeaways };
    }
    case "TAKEAWAY_COMPLETE":
      return state;
    case "SEGMENT_HEADER": {
      const segments = [...(state.segments || [])];
      const { index, ...header } = action.payload;
      segments[index] = { ...header, summary: "" };
      return { ...state, segments };
    }
    case "SEGMENT_DELTA": {
      const segments = [...(state.segments || [])];
      const seg = segments[action.payload.index];
      if (seg) {
        segments[action.payload.index] = {
          ...seg,
          summary: seg.summary + action.payload.delta,
        };
      }
      return { ...state, segments };
    }
    case "SEGMENT_COMPLETE":
      return state;
    case "CONTENT":
      return {
        ...state,
        contentComplete: true,
        synopsis: action.payload.synopsis,
        segments: action.payload.segments,
        keyTakeaways: action.payload.keyTakeaways,
      };
    case "CLAIMS":
      return { ...state, claims: action.payload.claims };
    case "CLAIM_VERIFIED":
      return {
        ...state,
        verifiedClaims: {
          ...state.verifiedClaims,
          [action.payload.index]: action.payload.verifiedClaim,
        },
      };
    case "COMPLETE":
      return { ...state, status: "complete", summary: action.payload.summary };
    case "ERROR":
      return { ...state, status: "error", error: action.payload.message };
    case "RESET":
      return initialState;
    default:
      return state;
  }
};

export const useAnalysis = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const eventSourceRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const startAnalysis = useCallback(
    (url: string) => {
      stop();
      dispatch({ type: "START" });

      const encodedUrl = encodeURIComponent(url);
      const es = new EventSource(`/api/analyze?url=${encodedUrl}`);
      eventSourceRef.current = es;

      es.addEventListener("metadata", (e) => {
        dispatch({ type: "METADATA", payload: JSON.parse(e.data) });
      });

      es.addEventListener("synopsis_delta", (e) => {
        dispatch({ type: "SYNOPSIS_DELTA", payload: JSON.parse(e.data) });
      });

      es.addEventListener("takeaway_delta", (e) => {
        dispatch({ type: "TAKEAWAY_DELTA", payload: JSON.parse(e.data) });
      });

      es.addEventListener("takeaway_complete", (e) => {
        dispatch({ type: "TAKEAWAY_COMPLETE", payload: JSON.parse(e.data) });
      });

      es.addEventListener("segment_header", (e) => {
        dispatch({ type: "SEGMENT_HEADER", payload: JSON.parse(e.data) });
      });

      es.addEventListener("segment_delta", (e) => {
        dispatch({ type: "SEGMENT_DELTA", payload: JSON.parse(e.data) });
      });

      es.addEventListener("segment_complete", (e) => {
        dispatch({ type: "SEGMENT_COMPLETE", payload: JSON.parse(e.data) });
      });

      es.addEventListener("content", (e) => {
        dispatch({ type: "CONTENT", payload: JSON.parse(e.data) });
      });

      es.addEventListener("claims", (e) => {
        dispatch({ type: "CLAIMS", payload: JSON.parse(e.data) });
      });

      es.addEventListener("claimVerified", (e) => {
        dispatch({ type: "CLAIM_VERIFIED", payload: JSON.parse(e.data) });
      });

      es.addEventListener("complete", (e) => {
        dispatch({ type: "COMPLETE", payload: JSON.parse(e.data) });
        es.close();
        eventSourceRef.current = null;
      });

      es.addEventListener("error", (e) => {
        if (e instanceof MessageEvent) {
          dispatch({ type: "ERROR", payload: JSON.parse(e.data) });
        } else {
          dispatch({
            type: "ERROR",
            payload: { stage: "connection", message: "Connection lost" },
          });
        }
        es.close();
        eventSourceRef.current = null;
      });
    },
    [stop]
  );

  const reset = useCallback(() => {
    stop();
    dispatch({ type: "RESET" });
  }, [stop]);

  const [retryingClaims, setRetryingClaims] = useState<Record<number, boolean>>({});

  const retryClaim = useCallback(async (index: number) => {
    const claim = state.claims?.[index];
    const metadata = state.metadata;
    if (!claim || !metadata) return;

    setRetryingClaims((prev) => ({ ...prev, [index]: true }));

    try {
      const res = await fetch("/api/retry-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim,
          metadata: { title: metadata.title, channelName: metadata.channelName },
        }),
      });
      const verified: VerifiedClaim = await res.json();
      dispatch({ type: "CLAIM_VERIFIED", payload: { index, verifiedClaim: verified } });
    } catch {
      dispatch({
        type: "CLAIM_VERIFIED",
        payload: {
          index,
          verifiedClaim: { ...claim, status: "timeout", evidence: "Retry failed." },
        },
      });
    } finally {
      setRetryingClaims((prev) => ({ ...prev, [index]: false }));
    }
  }, [state.claims, state.metadata]);

  return { state, startAnalysis, reset, retryClaim, retryingClaims };
};

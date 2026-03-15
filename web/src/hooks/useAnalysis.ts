import { useReducer, useCallback, useRef, useState } from "react";
import type {
  MetadataEvent,
  ContentEvent,
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
  claims: ExtractedClaim[] | null;
  verifiedClaims: Record<number, VerifiedClaim>;
  summary: string | null;
  error: string | null;
}

type Action =
  | { type: "START" }
  | { type: "METADATA"; payload: MetadataEvent }
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
    case "CONTENT":
      return {
        ...state,
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

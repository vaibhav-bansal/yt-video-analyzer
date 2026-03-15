interface LoadingStageProps {
  status: string;
  hasMetadata: boolean;
  hasClaims: boolean;
  hasContent: boolean;
  contentStreaming?: boolean;
}

export const LoadingStage = ({
  status,
  hasMetadata,
  hasClaims,
  hasContent,
  contentStreaming,
}: LoadingStageProps) => {
  if (status === "idle" || status === "complete") return null;

  if (status === "error") {
    return null;
  }

  let message = "Fetching video transcript...";

  if (hasMetadata && !hasClaims && !hasContent && !contentStreaming) {
    message = "Analyzing content and extracting claims...";
  } else if (hasMetadata && contentStreaming && !hasClaims) {
    message = "Streaming content analysis, extracting claims...";
  } else if (hasMetadata && contentStreaming && hasClaims) {
    message = "Streaming content analysis, verifying claims...";
  } else if (hasClaims && !hasContent) {
    message = "Verifying claims...";
  } else if (hasContent && !hasClaims) {
    message = "Extracting and verifying claims...";
  } else if (hasClaims && hasContent) {
    message = "Verifying remaining claims...";
  }

  return (
    <div className="loading-stage">
      <div className="spinner" />
      <span>{message}</span>
    </div>
  );
};

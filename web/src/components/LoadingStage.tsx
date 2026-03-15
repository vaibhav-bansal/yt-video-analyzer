interface LoadingStageProps {
  status: string;
  hasMetadata: boolean;
  hasClaims: boolean;
  hasContent: boolean;
}

export const LoadingStage = ({
  status,
  hasMetadata,
  hasClaims,
  hasContent,
}: LoadingStageProps) => {
  if (status === "idle" || status === "complete") return null;

  let message = "Fetching video transcript...";

  if (status === "error") {
    return null;
  }

  if (hasMetadata && !hasClaims && !hasContent) {
    message = "Analyzing content and extracting claims...";
  } else if (hasClaims && !hasContent) {
    message = "Verifying claims and analyzing content...";
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

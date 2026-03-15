import { useAnalysis } from "./hooks/useAnalysis";
import { UrlInput } from "./components/UrlInput";
import { VideoMeta } from "./components/VideoMeta";
import { Synopsis } from "./components/Synopsis";
import { KeyTakeaways } from "./components/KeyTakeaways";
import { Segments } from "./components/Segments";
import { ClaimsTracker } from "./components/ClaimsTracker";
import { LoadingStage } from "./components/LoadingStage";

export const App = () => {
  const { state, startAnalysis, reset, retryClaim, retryingClaims } = useAnalysis();
  const isActive = state.status === "loading" || state.status === "streaming";

  return (
    <div className="app">
      <header className="header">
        <h1>YouTube Video Analyzer</h1>
        <p className="subtitle">
          AI-powered summaries and credibility reports
        </p>
      </header>

      <main className="main">
        <UrlInput onSubmit={startAnalysis} disabled={isActive} />

        <LoadingStage
          status={state.status}
          hasMetadata={!!state.metadata}
          hasClaims={!!state.claims}
          hasContent={!!state.synopsis}
        />

        {state.error && (
          <div className="error-banner fade-in">
            <p>{state.error}</p>
            <button onClick={reset}>Try again</button>
          </div>
        )}

        {state.metadata && <VideoMeta metadata={state.metadata} />}

        <div className="content-grid">
          <div className="content-left">
            {state.synopsis && <Synopsis text={state.synopsis} />}
            {state.keyTakeaways && (
              <KeyTakeaways takeaways={state.keyTakeaways} />
            )}
            {state.segments && (
              <Segments
                segments={state.segments}
                videoUrl={state.metadata?.url}
              />
            )}
          </div>

          <div className="content-right">
            {state.summary && state.status === "complete" && (
              <section className="section credibility-summary fade-in">
                <h3>Credibility Summary</h3>
                <p>{state.summary}</p>
              </section>
            )}
            {state.claims && (
              <ClaimsTracker
                claims={state.claims}
                verifiedClaims={state.verifiedClaims}
                onRetryClaim={retryClaim}
                retryingClaims={retryingClaims}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

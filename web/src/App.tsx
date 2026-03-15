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
  const contentStreaming = !!state.synopsis && !state.contentComplete;

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
          hasContent={state.contentComplete}
          contentStreaming={contentStreaming}
        />

        {state.error && (
          <div className="error-banner fade-in">
            <p>{state.error}</p>
            <button onClick={reset}>Try again</button>
          </div>
        )}

        {state.metadata && (
          <VideoMeta
            metadata={state.metadata}
            synopsis={state.synopsis}
            segments={state.segments}
            keyTakeaways={state.keyTakeaways}
            claims={state.claims}
            verifiedClaims={state.verifiedClaims}
            summary={state.summary}
            analysisComplete={state.status === "complete"}
          />
        )}

        <div className="content-grid">
          <div className="content-left">
            {state.synopsis && (
              <Synopsis text={state.synopsis} streaming={contentStreaming} />
            )}
            {state.keyTakeaways && (
              <KeyTakeaways
                takeaways={state.keyTakeaways}
                streaming={contentStreaming}
              />
            )}
            {state.segments && (
              <Segments
                segments={state.segments}
                videoUrl={state.metadata?.url}
                streaming={contentStreaming}
              />
            )}
          </div>

          <div className="content-right">
            {state.summary && state.status === "complete" && (
              <section className="section credibility-summary fade-in">
                <h3>
                  Credibility Summary
                  <span className="credibility-tooltip-wrapper">
                    <span className="credibility-tooltip-icon">&#9432;</span>
                    <span className="credibility-tooltip-text">AI-searched against web sources. Not a substitute for independent verification.</span>
                  </span>
                </h3>
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

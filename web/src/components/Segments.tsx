import type { SegmentSummary } from "@shared/types";

interface SegmentsProps {
  segments: SegmentSummary[];
  videoUrl?: string;
  streaming?: boolean;
}

export const Segments = ({ segments, videoUrl, streaming }: SegmentsProps) => {
  const makeTimestampLink = (segment: SegmentSummary) => {
    if (!videoUrl) return null;
    return `${videoUrl}&t=${segment.startSeconds}`;
  };

  return (
    <section className="section fade-in">
      <h3>Segments</h3>
      <div className="segments-list">
        {segments.map((seg, i) => {
          const link = makeTimestampLink(seg);
          return (
            <div key={i} className="segment">
              <div className="segment-header">
                <span className="segment-time">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      {seg.timestamp} - {seg.endTimestamp}
                    </a>
                  ) : (
                    `${seg.timestamp} - ${seg.endTimestamp}`
                  )}
                </span>
                <span className="segment-title">{seg.title}</span>
              </div>
              <p className="segment-summary">
                {seg.summary}
                {streaming && i === segments.length - 1 && (
                  <span className="streaming-cursor" />
                )}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};

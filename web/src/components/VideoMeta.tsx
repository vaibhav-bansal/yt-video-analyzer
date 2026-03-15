import type { MetadataEvent } from "@shared/types";

interface VideoMetaProps {
  metadata: MetadataEvent;
}

export const VideoMeta = ({ metadata }: VideoMetaProps) => {
  return (
    <div className="video-meta fade-in">
      <h2>{metadata.title}</h2>
      <div className="meta-details">
        <span>{metadata.channelName}</span>
        <span className="separator">|</span>
        <span>{metadata.duration}</span>
        <span className="separator">|</span>
        <span>{metadata.publishedAt}</span>
      </div>
      <a
        href={metadata.url}
        target="_blank"
        rel="noopener noreferrer"
        className="video-link"
      >
        Watch on YouTube
      </a>
    </div>
  );
};

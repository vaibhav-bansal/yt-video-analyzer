import { google } from "googleapis";
import { YoutubeTranscript } from "youtube-transcript";
import { MAX_TRANSCRIPT_CHARS } from "./config.js";
import type { TranscriptResult, TranscriptSegment, VideoMetadata } from "./types.js";

const VIDEO_ID_REGEX =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})|^([a-zA-Z0-9_-]{11})$/;

export const extractVideoId = (input: string): string => {
  const match = input.match(VIDEO_ID_REGEX);
  const videoId = match?.[1] || match?.[2];
  if (!videoId) {
    throw new Error(
      `Could not extract video ID from: ${input}\nProvide a valid YouTube URL or 11-character video ID.`
    );
  }
  return videoId;
};

export const fetchVideoMetadata = async (
  videoId: string,
  apiKey: string
): Promise<VideoMetadata> => {
  const youtube = google.youtube({ version: "v3", auth: apiKey });

  const response = await youtube.videos.list({
    id: [videoId],
    part: ["snippet", "contentDetails"],
  });

  const video = response.data.items?.[0];
  if (!video) {
    throw new Error(`Video not found: ${videoId}. Check the URL and try again.`);
  }

  return {
    videoId,
    title: video.snippet?.title || "Unknown Title",
    description: video.snippet?.description || "",
    channelName: video.snippet?.channelTitle || "Unknown Channel",
    duration: formatDuration(video.contentDetails?.duration || ""),
    publishedAt: video.snippet?.publishedAt || "",
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
};

interface TranscriptFetchResult {
  segments: TranscriptSegment[];
  language: "en" | "hi";
}

const tryFetchTranscript = async (
  videoId: string,
  lang: string
): Promise<Array<{ offset: number; duration: number; text: string }> | null> => {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang });
    return raw && raw.length > 0 ? raw : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No transcripts are available in")) {
      return null;
    }
    throw err;
  }
};

export const fetchVideoTranscript = async (
  videoId: string
): Promise<TranscriptFetchResult> => {
  // Try English first, then Hindi
  const englishRaw = await tryFetchTranscript(videoId, "en");
  if (englishRaw) {
    return {
      segments: englishRaw.map((entry) => ({
        start: entry.offset / 1000,
        duration: entry.duration / 1000,
        text: entry.text.trim(),
      })),
      language: "en",
    };
  }

  const hindiRaw = await tryFetchTranscript(videoId, "hi");
  if (hindiRaw) {
    return {
      segments: hindiRaw.map((entry) => ({
        start: entry.offset / 1000,
        duration: entry.duration / 1000,
        text: entry.text.trim(),
      })),
      language: "hi",
    };
  }

  throw new Error(
    "Neither English nor Hindi transcripts are available for this video."
  );
};

export const formatTranscriptForLLM = (segments: TranscriptSegment[]): string => {
  const lines: string[] = [];
  let currentGroup: string[] = [];
  let groupStart = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (currentGroup.length === 0) {
      groupStart = seg.start;
    }
    currentGroup.push(seg.text);

    const isLast = i === segments.length - 1;
    const nextSeg = segments[i + 1];
    const gap = nextSeg ? nextSeg.start - (seg.start + seg.duration) : 0;
    const groupDuration = seg.start + seg.duration - groupStart;

    if (isLast || groupDuration >= 30 || gap > 5) {
      lines.push(`[${formatSeconds(groupStart)}] ${currentGroup.join(" ")}`);
      currentGroup = [];
    }
  }

  const formatted = lines.join("\n");

  if (formatted.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(
      `Transcript is too long (${formatted.length} characters). ` +
        `Maximum supported length is ${MAX_TRANSCRIPT_CHARS} characters.`
    );
  }

  return formatted;
};

export const getTranscript = async (
  videoId: string,
  apiKey: string
): Promise<TranscriptResult> => {
  const [metadata, { segments, language }] = await Promise.all([
    fetchVideoMetadata(videoId, apiKey),
    fetchVideoTranscript(videoId),
  ]);

  const formattedTranscript = formatTranscriptForLLM(segments);

  return { metadata, segments, formattedTranscript, transcriptLanguage: language };
};

const formatSeconds = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatDuration = (isoDuration: string): string => {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "Unknown";

  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3] || "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

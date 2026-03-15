declare module "#youtube-transcript" {
  interface TranscriptConfig {
    lang?: string;
    fetch?: typeof fetch;
  }

  interface TranscriptResponse {
    text: string;
    duration: number;
    offset: number;
    lang: string;
  }

  class YoutubeTranscript {
    static fetchTranscript(
      videoId: string,
      config?: TranscriptConfig
    ): Promise<TranscriptResponse[]>;
  }
}

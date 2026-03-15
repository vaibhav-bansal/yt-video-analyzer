import { useState } from "react";

interface UrlInputProps {
  onSubmit: (url: string) => void;
  disabled: boolean;
}

export const UrlInput = ({ onSubmit, disabled }: UrlInputProps) => {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <form className="url-input" onSubmit={handleSubmit}>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a YouTube URL..."
        disabled={disabled}
        required
      />
      <button type="submit" disabled={disabled || !url.trim()}>
        {disabled ? "Analyzing..." : "Analyze"}
      </button>
    </form>
  );
};

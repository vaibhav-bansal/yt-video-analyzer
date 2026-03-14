import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const LOGS_DIR = join(process.cwd(), "logs");

export const formatIST = (date: Date): string => {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(/[/,:\s]/g, "-").replace(/-+/g, "-");
};

export interface Logger {
  info: (message: string) => void;
  error: (message: string) => void;
  step: (step: string) => void;
  stepDone: (step: string, detail?: string) => void;
  stepFail: (step: string, error: string) => void;
  filePath: string;
}

export const createLogger = (videoId: string): Logger => {
  mkdirSync(LOGS_DIR, { recursive: true });

  const timestamp = formatIST(new Date());
  const fileName = `${timestamp}_${videoId}.log`;
  const filePath = join(LOGS_DIR, fileName);

  const write = (level: string, message: string): void => {
    const time = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const line = `[${time}] [${level}] ${message}\n`;
    appendFileSync(filePath, line);
  };

  return {
    filePath,
    info: (message) => write("INFO", message),
    error: (message) => write("ERROR", message),
    step: (step) => write("STEP", `Starting: ${step}`),
    stepDone: (step, detail) =>
      write("STEP", `Completed: ${step}${detail ? ` (${detail})` : ""}`),
    stepFail: (step, error) => write("STEP", `Failed: ${step} -- ${error}`),
  };
};

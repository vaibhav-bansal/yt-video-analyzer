const TRANSIENT_STATUS_CODES = [429, 529, 503, 502];
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1_000;

export const withRetry = async <T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransient = isTransientError(err);
      const isLastAttempt = attempt === MAX_RETRIES;

      if (!isTransient || isLastAttempt) {
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.error(`[retry] ${label} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error(`${label}: exhausted all retries`);
};

const isTransientError = (err: unknown): boolean => {
  if (err && typeof err === "object") {
    const status = (err as { status?: number }).status;
    if (status && TRANSIENT_STATUS_CODES.includes(status)) return true;

    const message = (err as { message?: string }).message || "";
    if (message.includes("ECONNRESET") || message.includes("ETIMEDOUT")) return true;
  }
  return false;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

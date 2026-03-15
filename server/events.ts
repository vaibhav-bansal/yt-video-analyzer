import type { Response } from "express";
import type { SSEEventMap, SSEEventType } from "../shared/types.js";

export const sendSSE = <T extends SSEEventType>(
  res: Response,
  event: T,
  data: SSEEventMap[T]
): void => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const setSSEHeaders = (res: Response): void => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
};

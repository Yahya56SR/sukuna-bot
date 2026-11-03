import pino from "pino";
import { activityLogStream } from "./metrics.js";

export type Logger = pino.Logger;

/** Default logger (used before the configured logger exists). */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Creates the bot logger and tees structured logs into the dashboard's
 * bounded activity feed. stdout remains the source of truth for hosting logs.
 */
export function createLogger(level: string): Logger {
  const streams: pino.StreamEntry[] = [
    { level: level as pino.Level, stream: process.stdout },
    { level: level as pino.Level, stream: activityLogStream },
  ];
  return pino({ level }, pino.multistream(streams));
}

export default logger;

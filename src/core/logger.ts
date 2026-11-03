import pino from "pino";

export type Logger = pino.Logger;

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

export function createLogger(level: string): Logger {
  return pino({ level });
}

export default logger;

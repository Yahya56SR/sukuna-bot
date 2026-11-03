import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const transport = isProduction
  ? undefined
  : {
      target: "pino-pretty",
      options: { colorize: true, singleLine: true },
    };

export type Logger = pino.Logger;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
  },
  transport ? pino.transport(transport) : undefined,
);

export function createLogger(level: string): Logger {
  return pino(
    { level },
    transport ? pino.transport(transport) : undefined,
  );
}

export default logger;

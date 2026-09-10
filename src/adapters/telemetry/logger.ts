import pino, { type Logger } from "pino";

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "botToken",
        "token",
        "accessToken",
        "refreshToken",
        "contextToken",
        "req.headers.authorization",
        "headers.Authorization",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "wechat-pi-agent" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

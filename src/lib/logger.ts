type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const level = (process.env.LOG_LEVEL || "info").toLowerCase();
  if (level in LOG_LEVELS) return level as LogLevel;
  return "info";
}

interface LogEntry {
  level: LogLevel;
  message: string;
  call_id?: string;
  business_id?: string;
  action?: string;
  duration_ms?: number;
  status?: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getConfiguredLevel()];
}

function write(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  const output = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  switch (entry.level) {
    case "error":
      console.error(JSON.stringify(output));
      break;
    case "warn":
      console.warn(JSON.stringify(output));
      break;
    default:
      console.log(JSON.stringify(output));
  }
}

export const logger = {
  debug(message: string, meta?: Omit<LogEntry, "level" | "message">) {
    write({ level: "debug", message, ...meta });
  },
  info(message: string, meta?: Omit<LogEntry, "level" | "message">) {
    write({ level: "info", message, ...meta });
  },
  warn(message: string, meta?: Omit<LogEntry, "level" | "message">) {
    write({ level: "warn", message, ...meta });
  },
  error(message: string, meta?: Omit<LogEntry, "level" | "message">) {
    write({ level: "error", message, ...meta });
  },
};

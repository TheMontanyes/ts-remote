/**
 * Log levels for controlling output verbosity.
 */
export enum LogLevel {
  /** No output */
  Silent = 0,
  /** Only errors */
  Error = 1,
  /** Errors and important information */
  Info = 2,
  /** Detailed debugging information */
  Debug = 3,
}

/**
 * Simple logger with configurable log levels.
 */
export class Logger {
  constructor(private level: LogLevel = LogLevel.Info) {}

  /**
   * Log informational message.
   */
  info(message: string, meta?: Record<string, unknown>): void {
    if (this.level >= LogLevel.Info) {
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
      console.log(`[ts-remote] ${message}${metaStr}`);
    }
  }

  /**
   * Log warning message.
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.level >= LogLevel.Info) {
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
      console.warn(`[ts-remote:warn] ${message}${metaStr}`);
    }
  }

  /**
   * Log detailed debug message.
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.level >= LogLevel.Debug) {
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
      console.debug(`[ts-remote:debug] ${message}${metaStr}`);
    }
  }

  /**
   * Log error message.
   */
  error(message: string, error?: Error): void {
    if (this.level >= LogLevel.Error) {
      console.error(`[ts-remote:error] ${message}`);
      if (error) {
        console.error(error);
      }
    }
  }

  /**
   * Start a timer with the given label.
   */
  time(label: string): void {
    if (this.level >= LogLevel.Info) {
      console.time(`[ts-remote] ${label}`);
    }
  }

  /**
   * End a timer with the given label.
   */
  timeEnd(label: string): void {
    if (this.level >= LogLevel.Info) {
      console.timeEnd(`[ts-remote] ${label}`);
    }
  }
}

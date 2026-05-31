// Tracing and logging instrumentation for diagnostic visibility
// Provides structured logging context for all backend operations

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, any>;
  [key: string]: any;
}

interface Logger {
  debug(message: string, context?: Record<string, any>): void;
  info(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  error(message: string, context?: Record<string, any>): void;
}

class TraceLogger implements Logger {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  private log(level: string, message: string, context?: Record<string, any>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      logger: this.name,
      ...context,
    };

    if (process.env.LOG_FORMAT === "json") {
      console.log(JSON.stringify(entry));
    } else {
      const contextStr = context ? ` ${JSON.stringify(context)}` : "";
      console.log(`[${entry.timestamp}] [${level}] [${this.name}] ${message}${contextStr}`);
    }
  }

  debug(message: string, context?: Record<string, any>) {
    if (process.env.LOG_LEVEL === "debug" || process.env.NODE_ENV === "development") {
      this.log("DEBUG", message, context);
    }
  }

  info(message: string, context?: Record<string, any>) {
    this.log("INFO", message, context);
  }

  warn(message: string, context?: Record<string, any>) {
    this.log("WARN", message, context);
  }

  error(message: string, context?: Record<string, any>) {
    this.log("ERROR", message, context);
  }
}

class TraceContext {
  private contextMap: Map<string, any> = new Map();

  active(): Record<string, any> {
    return Object.fromEntries(this.contextMap);
  }

  set(key: string, value: any) {
    this.contextMap.set(key, value);
  }

  get(key: string) {
    return this.contextMap.get(key);
  }

  clear() {
    this.contextMap.clear();
  }
}

class Trace {
  private loggers: Map<string, TraceLogger> = new Map();
  private readonly context: TraceContext = new TraceContext();

  getLogger(name: string): Logger {
    if (!this.loggers.has(name)) {
      this.loggers.set(name, new TraceLogger(name));
    }
    return this.loggers.get(name)!;
  }

  getContext(): TraceContext {
    return this.context;
  }
}

export const trace = new Trace();
export const context = trace.getContext();

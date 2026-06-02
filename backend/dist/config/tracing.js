"use strict";
// Tracing and logging instrumentation for diagnostic visibility
// Provides structured logging context for all backend operations
Object.defineProperty(exports, "__esModule", { value: true });
exports.context = exports.trace = void 0;
class TraceLogger {
    name;
    constructor(name) {
        this.name = name;
    }
    log(level, message, context) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            logger: this.name,
            ...context,
        };
        if (process.env.LOG_FORMAT === "json") {
            console.log(JSON.stringify(entry));
        }
        else {
            const contextStr = context ? ` ${JSON.stringify(context)}` : "";
            console.log(`[${entry.timestamp}] [${level}] [${this.name}] ${message}${contextStr}`);
        }
    }
    debug(message, context) {
        if (process.env.LOG_LEVEL === "debug" || process.env.NODE_ENV === "development") {
            this.log("DEBUG", message, context);
        }
    }
    info(message, context) {
        this.log("INFO", message, context);
    }
    warn(message, context) {
        this.log("WARN", message, context);
    }
    error(message, context) {
        this.log("ERROR", message, context);
    }
}
class TraceContext {
    contextMap = new Map();
    active() {
        return Object.fromEntries(this.contextMap);
    }
    set(key, value) {
        this.contextMap.set(key, value);
    }
    get(key) {
        return this.contextMap.get(key);
    }
    clear() {
        this.contextMap.clear();
    }
}
class Trace {
    loggers = new Map();
    context = new TraceContext();
    getLogger(name) {
        if (!this.loggers.has(name)) {
            this.loggers.set(name, new TraceLogger(name));
        }
        return this.loggers.get(name);
    }
    getContext() {
        return this.context;
    }
}
exports.trace = new Trace();
exports.context = exports.trace.getContext();

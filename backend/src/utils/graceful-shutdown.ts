import type { Server } from "node:http";

export type ShutdownLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

export interface GracefulShutdownOptions {
  logger: ShutdownLogger;
  timeoutMs: number;
  markShuttingDown?: () => void;
  closeServer?: () => Promise<void>;
  stopBackgroundTasks?: Array<() => void | Promise<void>>;
  drainDatabase?: (signal: NodeJS.Signals) => Promise<void>;
  exit?: (code: number) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: NodeJS.Signals
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Graceful shutdown timed out after ${timeoutMs}ms for ${signal}`));
    }, timeoutMs);
    timeout.unref();
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function closeHttpServer(server: Server | null | undefined): Promise<void> {
  if (!server) {
    return Promise.resolve();
  }

  const serverWithIdleClose = server as Server & {
    closeIdleConnections?: () => void;
  };

  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    serverWithIdleClose.closeIdleConnections?.();
  });
}

export function createGracefulShutdownHandler(options: GracefulShutdownOptions) {
  let shuttingDown = false;

  return async function gracefulShutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      options.logger.warn("Shutdown already in progress; ignoring duplicate signal", { signal });
      return;
    }

    shuttingDown = true;
    options.markShuttingDown?.();
    options.logger.info("Shutdown signal received; draining API resources", {
      signal,
      timeoutMs: options.timeoutMs,
    });

    try {
      await withTimeout(
        (async () => {
          await options.closeServer?.();

          for (const stopTask of options.stopBackgroundTasks ?? []) {
            await stopTask();
          }

          await options.drainDatabase?.(signal);
        })(),
        options.timeoutMs,
        signal
      );

      options.logger.info("Graceful shutdown completed", { signal });
      options.exit?.(0);
    } catch (error) {
      options.logger.error("Graceful shutdown failed", {
        signal,
        error: describeError(error),
      });
      options.exit?.(1);
    }
  };
}

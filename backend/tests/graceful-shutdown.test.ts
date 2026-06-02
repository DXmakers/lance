/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  closeHttpServer,
  createGracefulShutdownHandler,
  type ShutdownLogger,
} from "../src/utils/graceful-shutdown";

function testLogger(messages: string[]): ShutdownLogger {
  return {
    info: (message, context) => messages.push(`info:${message}:${context?.signal ?? ""}`),
    warn: (message, context) => messages.push(`warn:${message}:${context?.signal ?? ""}`),
    error: (message, context) => messages.push(`error:${message}:${context?.signal ?? ""}`),
  };
}

test("graceful shutdown closes the server, stops tasks, drains the database, and exits cleanly", async () => {
  const events: string[] = [];
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.end("ok");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const shutdown = createGracefulShutdownHandler({
    logger: testLogger(events),
    timeoutMs: 1_000,
    markShuttingDown: () => events.push("mark"),
    closeServer: async () => {
      events.push("close-server");
      await closeHttpServer(server);
    },
    stopBackgroundTasks: [
      () => {
        events.push("stop-background");
      },
    ],
    drainDatabase: async (signal) => {
      events.push(`drain-db:${signal}`);
    },
    exit: (code) => events.push(`exit:${code}`),
  });

  await shutdown("SIGINT");

  assert.deepEqual(events, [
    "mark",
    "info:Shutdown signal received; draining API resources:SIGINT",
    "close-server",
    "stop-background",
    "drain-db:SIGINT",
    "info:Graceful shutdown completed:SIGINT",
    "exit:0",
  ]);
  assert.equal(server.listening, false);
});

test("graceful shutdown exits with failure when cleanup exceeds timeout", async () => {
  const events: string[] = [];
  const shutdown = createGracefulShutdownHandler({
    logger: testLogger(events),
    timeoutMs: 5,
    closeServer: () => new Promise<void>(() => undefined),
    exit: (code) => events.push(`exit:${code}`),
  });

  await shutdown("SIGTERM");

  assert.ok(events.includes("error:Graceful shutdown failed:SIGTERM"));
  assert.ok(events.includes("exit:1"));
});

test("duplicate shutdown signals are ignored while cleanup is running", async () => {
  const events: string[] = [];
  let releaseDrain!: () => void;
  const drainReleased = new Promise<void>((resolve) => {
    releaseDrain = resolve;
  });

  const shutdown = createGracefulShutdownHandler({
    logger: testLogger(events),
    timeoutMs: 1_000,
    drainDatabase: async () => {
      events.push("drain-started");
      await drainReleased;
    },
    exit: (code) => events.push(`exit:${code}`),
  });

  const firstShutdown = shutdown("SIGINT");
  await shutdown("SIGTERM");
  releaseDrain();
  await firstShutdown;

  assert.ok(events.includes("warn:Shutdown already in progress; ignoring duplicate signal:SIGTERM"));
  assert.equal(events.filter((event) => event === "exit:0").length, 1);
});

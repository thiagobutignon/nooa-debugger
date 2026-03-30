import { createConnection } from "node:net";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJsonFile } from "../kernel/storage/fs";
import type { SessionBridgeHint } from "../kernel/types";
import type {
  BridgeBreakpointResult,
  BridgeEvaluationResult,
  BridgePauseResult,
  BridgeReadyFile,
  BridgeRequest,
  BridgeResponse,
  BridgeStatusResult,
} from "./types";

function bridgeError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function bridgeReadyPath(root: string, sessionId: string): string {
  return join(root, ".nooa-debugger", "runtime", `${sessionId}.bridge-ready.json`);
}

async function waitForBridgeReady(path: string, timeoutMs = 3_000): Promise<BridgeReadyFile> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const ready = await readJsonFile<BridgeReadyFile>(path);
    if (ready) {
      if (ready.error) {
        throw bridgeError("bridge.start_failed", ready.error);
      }
      return ready;
    }

    if (Date.now() >= deadline) {
      throw bridgeError("bridge.start_failed", `Timed out waiting for debug bridge ready file: ${path}`);
    }

    await Bun.sleep(25);
  }
}

async function sendBridgeRequest<T>(
  transport: SessionBridgeHint,
  request: Omit<BridgeRequest, "token">,
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const socket = createConnection(
      {
        host: transport.host,
        port: transport.port,
      },
      () => {
        const payload: BridgeRequest = {
          token: transport.token,
          ...request,
        } as BridgeRequest;
        socket.write(`${JSON.stringify(payload)}\n`);
      },
    );

    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;

    function settleError(error: Error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    }

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0 || settled) {
        return;
      }

      settled = true;
      socket.end();

      let response: BridgeResponse<T>;
      try {
        response = JSON.parse(buffer.slice(0, newlineIndex)) as BridgeResponse<T>;
      } catch {
        rejectPromise(bridgeError("bridge.invalid_response", "Debug bridge returned invalid JSON"));
        return;
      }

      if (!response.ok) {
        rejectPromise(bridgeError(response.error.code, response.error.message));
        return;
      }

      resolvePromise(response.data);
    });

    socket.on("error", (error) => {
      settleError(
        bridgeError(
          "bridge.unreachable",
          error instanceof Error ? error.message : "Failed to reach debug bridge",
        ),
      );
    });

    socket.on("end", () => {
      if (!settled) {
        settleError(bridgeError("bridge.unreachable", "Debug bridge closed the connection"));
      }
    });
  });
}

export async function startSessionBridge(options: {
  adapter: "bun" | "node";
  root: string;
  sessionId: string;
  wsUrl: string;
  targetPid?: number;
}): Promise<SessionBridgeHint> {
  const readyPath = bridgeReadyPath(options.root, options.sessionId);
  await rm(readyPath, { force: true }).catch(() => {});

  const entryPath = resolve(import.meta.dir, "entry.ts");
  const child = Bun.spawn(
    [
      "bun",
      "run",
      entryPath,
      "--adapter",
      options.adapter,
      "--root",
      options.root,
      "--session-id",
      options.sessionId,
      "--ws-url",
      options.wsUrl,
      "--target-pid",
      String(options.targetPid ?? 0),
      "--ready-path",
      readyPath,
    ],
    {
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  try {
    const ready = await Promise.race([
      waitForBridgeReady(readyPath),
      child.exited.then((code) => {
        throw bridgeError(
          "bridge.start_failed",
          `Debug bridge exited before becoming ready (exit ${code})`,
        );
      }),
    ]);

    child.unref();

    return {
      host: ready.host,
      port: ready.port,
      token: ready.token,
      bridge_pid: ready.bridge_pid,
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

export function createBridgeClient(transport: SessionBridgeHint) {
  return {
    ping() {
      return sendBridgeRequest<void>(transport, { action: "ping" });
    },

    status() {
      return sendBridgeRequest<BridgeStatusResult>(transport, { action: "status" });
    },

    releaseWaitingForDebugger() {
      return sendBridgeRequest<void>(transport, { action: "release_waiting_for_debugger" });
    },

    pause(timeoutMs = 2_000) {
      return sendBridgeRequest<BridgePauseResult>(transport, {
        action: "pause",
        timeout_ms: timeoutMs,
      }).then((result) => {
        if (result.state !== "paused") {
          throw bridgeError("bridge.pause_failed", "Debug bridge did not produce a paused snapshot");
        }
        return result.snapshot;
      });
    },

    continueUntilPaused(timeoutMs = 2_000) {
      return sendBridgeRequest<BridgePauseResult>(transport, {
        action: "resume_and_wait",
        timeout_ms: timeoutMs,
      }).then((result) => {
        if (result.state !== "paused") {
          throw bridgeError("bridge.pause_timeout", "Timed out waiting for the next pause");
        }
        return result.snapshot;
      });
    },

    snapshotPaused(timeoutMs = 2_000) {
      return sendBridgeRequest<BridgePauseResult>(transport, {
        action: "wait_for_pause",
        timeout_ms: timeoutMs,
      }).then((result) => {
        if (result.state !== "paused") {
          throw bridgeError("bridge.pause_timeout", "Timed out waiting for a pause");
        }
        return result.snapshot;
      });
    },

    setBreakpoint(fileLine: string) {
      const match = fileLine.match(/^(.*):(\d+)$/);
      if (!match) {
        throw bridgeError("refs.invalid", `Invalid breakpoint location: ${fileLine}`);
      }

      return sendBridgeRequest<BridgeBreakpointResult>(transport, {
        action: "set_breakpoint",
        file: match[1],
        line: Number(match[2]),
      });
    },

    evaluate(expression: string) {
      return sendBridgeRequest<BridgeEvaluationResult>(transport, {
        action: "evaluate",
        expression,
      }).then((result) => result.result);
    },

    shutdown() {
      return sendBridgeRequest<void>(transport, { action: "shutdown" }).catch(() => {});
    },

    close() {
      return Promise.resolve();
    },
  };
}

export type BridgeClient = ReturnType<typeof createBridgeClient>;

import { createServer } from "node:net";
import { createBunSession, type BunPausedSnapshot } from "../adapters/bun/session";
import { writeJsonAtomically } from "../kernel/storage/fs";
import type {
  BridgeBreakpointResult,
  BridgePauseResult,
  BridgeReadyFile,
  BridgeRequest,
  BridgeResponse,
  BridgeStatusResult,
} from "./types";

function ok<T>(data: T): BridgeResponse<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): BridgeResponse {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function isPauseTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Timed out waiting for Debugger.paused");
}

function isProcessAlive(pid?: number): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startBridgeServer(options: {
  wsUrl: string;
  readyPath: string;
  targetPid?: number;
}): Promise<void> {
  const live = await createBunSession(options.wsUrl);
  const bridgeToken = crypto.randomUUID();
  let currentSnapshot: BunPausedSnapshot | undefined;
  let currentState: "running" | "paused" | "closed" = "running";
  let closing = false;
  let queue = Promise.resolve();

  async function handleRequest(request: BridgeRequest): Promise<BridgeResponse> {
    switch (request.action) {
      case "ping":
        if (!closing) {
          await live.ping();
        }
        return ok(undefined);

      case "status": {
        const targetAlive = isProcessAlive(options.targetPid);
        const healthy = targetAlive && !closing
          ? await live.ping().then(
            () => true,
            () => false,
          )
          : false;
        const state: BridgeStatusResult["state"] =
          closing ? "closed" : currentState;

        return ok<BridgeStatusResult>({
          healthy,
          target_alive: targetAlive,
          state,
          snapshot: state === "paused" ? currentSnapshot : undefined,
        });
      }

      case "release_waiting_for_debugger":
        await live.releaseWaitingForDebugger();
        return ok(undefined);

      case "pause": {
        const snapshot = await live.pause(request.timeout_ms);
        currentSnapshot = snapshot;
        currentState = "paused";
        return ok<BridgePauseResult>({
          state: "paused",
          snapshot,
        });
      }

      case "wait_for_pause": {
        try {
          const snapshot = await live.snapshotPaused(request.timeout_ms);
          currentSnapshot = snapshot;
          currentState = "paused";
          return ok<BridgePauseResult>({
            state: "paused",
            snapshot,
          });
        } catch (error) {
          if (isPauseTimeout(error)) {
            currentSnapshot = undefined;
            currentState = "running";
            return ok<BridgePauseResult>({ state: "running" });
          }

          throw error;
        }
      }

      case "resume_and_wait": {
        try {
          const snapshot = await live.continueUntilPaused(request.timeout_ms);
          currentSnapshot = snapshot;
          currentState = "paused";
          return ok<BridgePauseResult>({
            state: "paused",
            snapshot,
          });
        } catch (error) {
          if (isPauseTimeout(error)) {
            currentSnapshot = undefined;
            currentState = "running";
            return ok<BridgePauseResult>({ state: "running" });
          }

          throw error;
        }
      }

      case "set_breakpoint": {
        const breakpoint = await live.setBreakpoint(`${request.file}:${request.line}`);
        return ok<BridgeBreakpointResult>(breakpoint);
      }

      case "evaluate": {
        if (currentState !== "paused" || !currentSnapshot) {
          return fail("session.stale_snapshot", "Debug bridge does not have a paused frame");
        }

        const result = await live.evaluate(request.expression);
        return ok({ result });
      }

      case "shutdown":
        closing = true;
        currentSnapshot = undefined;
        currentState = "closed";
        queueMicrotask(async () => {
          await live.close().catch(() => {});
          server.close();
        });
        return ok(undefined);
    }
  }

  function serializeResponse(socket: { end: (chunk?: string) => void }, response: BridgeResponse) {
    socket.end(`${JSON.stringify(response)}\n`);
  }

  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const payload = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      let request: BridgeRequest;
      try {
        request = JSON.parse(payload) as BridgeRequest;
      } catch {
        serializeResponse(socket, fail("bridge.invalid_request", "Debug bridge received invalid JSON"));
        return;
      }

      if (!request.token || request.token !== bridgeToken) {
        serializeResponse(socket, fail("bridge.unauthorized", "Debug bridge token mismatch"));
        return;
      }

      const run = queue.then(
        async () => handleRequest(request),
        async () => handleRequest(request),
      );
      queue = run.then(
        () => undefined,
        () => undefined,
      );

      run.then(
        (response) => serializeResponse(socket, response),
        (error) => {
          serializeResponse(
            socket,
            fail(
              closing ? "bridge.closed" : "bridge.command_failed",
              error instanceof Error ? error.message : "Debug bridge command failed",
            ),
          );
        },
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Debug bridge failed to bind to a TCP port");
  }

  const ready: BridgeReadyFile = {
    host: "127.0.0.1",
    port: address.port,
    token: bridgeToken,
    bridge_pid: process.pid,
  };

  await writeJsonAtomically(options.readyPath, ready);

  await new Promise<void>((resolve) => {
    server.on("close", resolve);
  });
}

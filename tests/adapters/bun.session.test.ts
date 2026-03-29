import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createBunSession } from "../../src/adapters/bun/session";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-breakpoint.ts");

function decodeMessage(message: string | Uint8Array): string {
  if (typeof message === "string") return message;
  return new TextDecoder().decode(message);
}

function startMockInspector() {
  const seen: Array<{ method: string; params?: any }> = [];

  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) {
        return;
      }
      return new Response("ok");
    },
    websocket: {
      message(socket, message) {
        const payload = JSON.parse(decodeMessage(message));
        seen.push(payload);

        if (
          payload.method === "Runtime.enable"
          || payload.method === "Debugger.enable"
          || payload.method === "Debugger.setBreakpointsActive"
        ) {
          socket.send(JSON.stringify({ id: payload.id, result: {} }));
          return;
        }

        if (payload.method === "Debugger.setBreakpointByUrl") {
          socket.send(
            JSON.stringify({
              id: payload.id,
              result: {
                breakpointId: "bp-1",
                locations: [
                  {
                    scriptId: "script-1",
                    url: payload.params.url,
                    lineNumber: payload.params.lineNumber,
                    columnNumber: payload.params.columnNumber ?? 0,
                  },
                ],
              },
            }),
          );
          return;
        }

        if (payload.method === "Debugger.resume") {
          socket.send(JSON.stringify({ id: payload.id, result: {} }));
          socket.send(
            JSON.stringify({
              method: "Debugger.paused",
              params: {
                reason: "breakpoint",
                callFrames: [
                  {
                    callFrameId: "frame-1",
                    functionName: "main",
                    url: fixturePath,
                    location: {
                      scriptId: "script-1",
                      lineNumber: 5,
                      columnNumber: 2,
                    },
                    scopeChain: [
                      {
                        type: "local",
                        name: "Local",
                        object: { objectId: "scope-1" },
                      },
                    ],
                  },
                  {
                    callFrameId: "frame-2",
                    functionName: "helper",
                    url: fixturePath,
                    location: {
                      scriptId: "script-1",
                      lineNumber: 1,
                      columnNumber: 0,
                    },
                    scopeChain: [],
                  },
                ],
              },
            }),
          );
          return;
        }

        if (payload.method === "Runtime.getProperties") {
          socket.send(
            JSON.stringify({
              id: payload.id,
              result: {
                result: [
                  {
                    name: "tracked",
                    value: { type: "number", value: 41, description: "41" },
                  },
                  {
                    name: "message",
                    value: { type: "string", value: "hello", description: "hello" },
                  },
                ],
              },
            }),
          );
          return;
        }

        if (payload.method === "Debugger.evaluateOnCallFrame") {
          socket.send(
            JSON.stringify({
              id: payload.id,
              result: {
                result: {
                  type: "number",
                  value: 42,
                  description: "42",
                },
              },
            }),
          );
        }
      },
    },
  });

  return { server, seen };
}

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop();
  server = undefined;
});

test("createBunSession enables Bun CDP domains and translates file:line breakpoints", async () => {
  const mock = startMockInspector();
  server = mock.server;

  const session = await createBunSession(`ws://127.0.0.1:${server.port}/`);
  try {
    const breakpoint = await session.setBreakpoint(`${fixturePath}:6`);

    expect(mock.seen.map((entry) => entry.method)).toEqual([
      "Runtime.enable",
      "Debugger.enable",
      "Debugger.setBreakpointsActive",
      "Debugger.setBreakpointByUrl",
    ]);
    expect(mock.seen[3].params.url).toBe(fixturePath);
    expect(mock.seen[3].params.lineNumber).toBe(5);
    expect(breakpoint.breakpointId).toBe("bp-1");
    expect(breakpoint.locations[0].url).toBe(fixturePath);
  } finally {
    await session.close();
  }
});

test("createBunSession captures a paused snapshot and evaluates the top frame", async () => {
  const mock = startMockInspector();
  server = mock.server;

  const session = await createBunSession(`ws://127.0.0.1:${server.port}/`);
  try {
    await session.setBreakpoint(`${fixturePath}:6`);

    const snapshot = await session.continueUntilPaused();
    expect(snapshot.topFrame.functionName).toBe("main");
    expect(snapshot.topFrame.location.file).toBe(fixturePath);
    expect(snapshot.topFrame.location.line).toBe(6);
    expect(snapshot.locals).toEqual([
      { name: "tracked", value: "41", type: "number", objectId: undefined },
      { name: "message", value: "hello", type: "string", objectId: undefined },
    ]);
    expect(snapshot.rawCallFrames.length).toBe(2);

    const evaluation = await session.evaluate("tracked + 1");
    expect(mock.seen.some((entry) => entry.method === "Debugger.evaluateOnCallFrame")).toBe(true);
    expect(evaluation.result.value).toBe(42);
  } finally {
    await session.close();
  }
});

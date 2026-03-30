import { expect, test } from "bun:test";
import { createNodeSession } from "../../src/adapters/node/session";

type Listener = (event: { data: string }) => void;

function createMockSocket(options: { autoClose?: boolean } = {}) {
  const sent: string[] = [];
  const messageListeners = new Set<Listener>();
  const closeListeners = new Set<() => void>();
  const autoClose = options.autoClose ?? true;
  let closeCalls = 0;

  const socket = {
    readyState: 1,
    send(message: string) {
      sent.push(message);
    },
    addEventListener(type: string, listener: Listener | (() => void)) {
      if (type === "message") {
        messageListeners.add(listener as Listener);
      } else if (type === "close") {
        closeListeners.add(listener as () => void);
      }
    },
    removeEventListener(type: string, listener: Listener | (() => void)) {
      if (type === "message") {
        messageListeners.delete(listener as Listener);
      } else if (type === "close") {
        closeListeners.delete(listener as () => void);
      }
    },
    close() {
      closeCalls += 1;
      socket.readyState = 2;
      if (autoClose) {
        api.emitClose();
      }
    },
  };

  const api = {
    sent,
    socket,
    get closeCalls() {
      return closeCalls;
    },
    emit(payload: unknown) {
      const event = { data: JSON.stringify(payload) };
      for (const listener of messageListeners) {
        listener(event);
      }
    },
    emitClose() {
      socket.readyState = 3;
      for (const listener of closeListeners) {
        listener();
      }
    },
  };

  return api;
}

function parseSentMessages(sent: string[]) {
  return sent.map((message) => JSON.parse(message) as { id: number; method: string; params?: Record<string, unknown> });
}

function startSession(mock: ReturnType<typeof createMockSocket>) {
  return createNodeSession({
    wsUrl: "ws://127.0.0.1:9229/abc",
    createSocket: () => mock.socket as WebSocket,
  });
}

async function bootstrapSession(mock: ReturnType<typeof createMockSocket>) {
  const sessionPromise = startSession(mock);

  expect(parseSentMessages(mock.sent).map((message) => message.method)).toEqual([
    "Runtime.enable",
    "Debugger.enable",
  ]);

  mock.emit({ id: 1, result: {} });
  mock.emit({ id: 2, result: {} });

  return sessionPromise;
}

test("createNodeSession waits for Runtime and Debugger bootstrap before resolving", async () => {
  const mock = createMockSocket();

  let settled = false;
  const sessionPromise = startSession(mock).then((session) => {
    settled = true;
    return session;
  });

  expect(parseSentMessages(mock.sent).map((message) => message.method)).toEqual([
    "Runtime.enable",
    "Debugger.enable",
  ]);

  await Bun.sleep(0);
  expect(settled).toBe(false);

  mock.emit({ id: 1, result: {} });
  mock.emit({ id: 2, result: {} });

  const session = await sessionPromise;
  await session.close();
});

test("createNodeSession surfaces bootstrap failures", async () => {
  const mock = createMockSocket();
  const sessionPromise = startSession(mock);

  expect(parseSentMessages(mock.sent).map((message) => message.method)).toEqual([
    "Runtime.enable",
    "Debugger.enable",
  ]);

  mock.emit({ id: 1, result: {} });
  mock.emit({
    id: 2,
    error: {
      code: -32000,
      message: "Debugger unavailable",
    },
  });

  await expect(sessionPromise).rejects.toMatchObject({
    code: "session.invalid_state",
    detail_code: "node.inspector.request_failed",
    message: expect.stringContaining("Debugger unavailable"),
  });

  expect(mock.closeCalls).toBe(1);
});

test("createNodeSession pause returns a normalized snapshot and state", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  mock.emit({
    method: "Debugger.scriptParsed",
    params: {
      scriptId: "script-1",
      url: "file:///tmp/node-fixture.js",
    },
  });

  const paused = session.pause();

  mock.emit({ id: 3, result: {} });
  mock.emit({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [
        {
          callFrameId: "frame-1",
          functionName: "main",
          location: {
            scriptId: "script-1",
            lineNumber: 10,
            columnNumber: 2,
          },
          scopeChain: [
            {
              type: "local",
              object: { objectId: "scope-1" },
            },
          ],
        },
      ],
    },
  });
  mock.emit({
    id: 4,
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
  });

  await expect(paused).resolves.toMatchObject({
    reason: "breakpoint",
    topFrame: {
      callFrameId: "frame-1",
      functionName: "main",
      location: {
        file: "/tmp/node-fixture.js",
        line: 11,
        column: 3,
      },
    },
    locals: [
      { name: "tracked", value: "41", type: "number" },
      { name: "message", value: "hello", type: "string" },
    ],
  });

  await expect(session.state()).resolves.toMatchObject({
    state: "paused",
    snapshot: {
      reason: "breakpoint",
      topFrame: {
        functionName: "main",
      },
    },
  });

  expect(await session.stack()).toEqual([
    {
      callFrameId: "frame-1",
      functionName: "main",
      location: {
        scriptId: "script-1",
        lineNumber: 10,
        columnNumber: 2,
      },
      scopeChain: [
        {
          type: "local",
          object: { objectId: "scope-1" },
        },
      ],
    },
  ]);

  expect(await session.vars()).toEqual([
    { name: "tracked", value: "41", type: "number", objectId: undefined },
    { name: "message", value: "hello", type: "string", objectId: undefined },
  ]);

  await session.close();
});

test("createNodeSession eval runs on the current call frame and returns the Bun-style payload", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  const paused = session.pause();
  mock.emit({ id: 3, result: {} });
  mock.emit({
    method: "Debugger.paused",
    params: {
      callFrames: [
        {
          callFrameId: "frame-2",
          functionName: "tick",
          location: {
            scriptId: "script-2",
            lineNumber: 4,
            columnNumber: 0,
          },
          scopeChain: [],
        },
      ],
    },
  });

  await paused;

  const evaluation = session.eval("tracked + 1");
  const sent = parseSentMessages(mock.sent);
  expect(sent.at(-1)?.method).toBe("Debugger.evaluateOnCallFrame");
  expect(sent.at(-1)?.id).toBe(4);
  expect(sent.at(-1)?.params).toMatchObject({
    callFrameId: "frame-2",
    expression: "tracked + 1",
    returnByValue: true,
  });

  mock.emit({
    id: 4,
    result: {
      result: {
        type: "number",
        value: 42,
        description: "42",
      },
    },
  });

  await expect(evaluation).resolves.toMatchObject({
    result: {
      type: "number",
      value: 42,
    },
  });

  await session.close();
});

test("createNodeSession eval rejects expressions that report exceptionDetails", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  const paused = session.pause();
  mock.emit({ id: 3, result: {} });
  mock.emit({
    method: "Debugger.paused",
    params: {
      callFrames: [
        {
          callFrameId: "frame-9",
          functionName: "tick",
          location: {
            scriptId: "script-2",
            lineNumber: 4,
            columnNumber: 0,
          },
          scopeChain: [],
        },
      ],
    },
  });
  await paused;

  const evaluation = session.eval("throw new Error('boom')");
  mock.emit({
    id: 4,
    result: {
      result: {
        type: "object",
        description: "Error: boom",
      },
      exceptionDetails: {
        text: "Uncaught Error: boom",
      },
    },
  });

  await expect(evaluation).rejects.toMatchObject({
    code: "runtime.evaluation_failed",
    message: expect.stringContaining("boom"),
  });

  await session.close();
});

test("createNodeSession continue invalidates the paused snapshot", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  const paused = session.pause();
  mock.emit({ id: 3, result: {} });
  mock.emit({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [
        {
          callFrameId: "frame-3",
          functionName: "loop",
          location: {
            scriptId: "script-3",
            lineNumber: 6,
            columnNumber: 1,
          },
          scopeChain: [],
        },
      ],
    },
  });
  await paused;

  await expect(session.state()).resolves.toEqual({
    state: "paused",
    snapshot: {
      hitBreakpoints: [],
      reason: "breakpoint",
      topFrame: {
        callFrameId: "frame-3",
        functionName: "loop",
        location: {
          scriptId: "script-3",
          file: undefined,
          line: 7,
          column: 2,
        },
      },
      locals: [],
      rawCallFrames: [
        {
          callFrameId: "frame-3",
          functionName: "loop",
          location: {
            scriptId: "script-3",
            lineNumber: 6,
            columnNumber: 1,
          },
          scopeChain: [],
        },
      ],
    },
  });

  const resumed = session.continue();
  const sent = parseSentMessages(mock.sent);
  expect(sent.at(-1)?.method).toBe("Debugger.resume");

  mock.emit({ id: 4, result: {} });
  mock.emit({ method: "Debugger.resumed", params: {} });
  await resumed;

  await expect(session.state()).resolves.toEqual({ state: "running" });
  await expect(session.stack()).rejects.toMatchObject({ code: "snapshot.stale" });
  await expect(session.vars()).rejects.toMatchObject({ code: "snapshot.stale" });

  await session.close();
});

test("createNodeSession state can recover a spontaneous paused event", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  mock.emit({
    method: "Debugger.scriptParsed",
    params: {
      scriptId: "script-5",
      url: "file:///tmp/node-fixture.js",
    },
  });
  mock.emit({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [
        {
          callFrameId: "frame-5",
          functionName: "worker",
          location: {
            scriptId: "script-5",
            lineNumber: 19,
            columnNumber: 3,
          },
          scopeChain: [],
        },
      ],
    },
  });

  await expect(session.state()).resolves.toEqual({
    state: "paused",
    snapshot: {
      hitBreakpoints: [],
      reason: "breakpoint",
      topFrame: {
        callFrameId: "frame-5",
        functionName: "worker",
        location: {
          scriptId: "script-5",
          file: "/tmp/node-fixture.js",
          line: 20,
          column: 4,
        },
      },
      locals: [],
      rawCallFrames: [
        {
          callFrameId: "frame-5",
          functionName: "worker",
          location: {
            scriptId: "script-5",
            lineNumber: 19,
            columnNumber: 3,
          },
          scopeChain: [],
        },
      ],
    },
  });

  const sentBeforePause = mock.sent.length;
  await expect(session.pause()).resolves.toMatchObject({
    topFrame: {
      callFrameId: "frame-5",
      functionName: "worker",
    },
  });
  expect(mock.sent.length).toBe(sentBeforePause);

  await session.close();
});

test("createNodeSession ignores stale buffered pauses after a resumed event", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  mock.emit({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [
        {
          callFrameId: "frame-stale",
          functionName: "stale",
          location: {
            scriptId: "script-stale",
            lineNumber: 1,
            columnNumber: 0,
          },
          scopeChain: [],
        },
      ],
    },
  });
  mock.emit({ method: "Debugger.resumed", params: {} });

  await expect(session.state()).resolves.toEqual({ state: "running" });
  await expect(session.stack()).rejects.toMatchObject({ code: "snapshot.stale" });

  await session.close();
});

test("createNodeSession vars stack and eval can recover a spontaneous paused event directly", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  mock.emit({
    method: "Debugger.scriptParsed",
    params: {
      scriptId: "script-6",
      url: "file:///tmp/node-fixture.js",
    },
  });
  mock.emit({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [
        {
          callFrameId: "frame-6",
          functionName: "agent",
          location: {
            scriptId: "script-6",
            lineNumber: 7,
            columnNumber: 1,
          },
          scopeChain: [
            {
              type: "local",
              object: { objectId: "scope-6" },
            },
          ],
        },
      ],
    },
  });

  const vars = session.vars();
  mock.emit({
    id: 3,
    result: {
      result: [
        {
          name: "tracked",
          value: { type: "number", value: 41, description: "41" },
        },
      ],
    },
  });

  await expect(vars).resolves.toEqual([
    { name: "tracked", value: "41", type: "number", objectId: undefined },
  ]);

  await expect(session.stack()).resolves.toEqual([
    {
      callFrameId: "frame-6",
      functionName: "agent",
      location: {
        scriptId: "script-6",
        lineNumber: 7,
        columnNumber: 1,
      },
      scopeChain: [
        {
          type: "local",
          object: { objectId: "scope-6" },
        },
      ],
    },
  ]);

  const evaluation = session.eval("tracked + 1");
  mock.emit({
    id: 4,
    result: {
      result: {
        type: "number",
        value: 42,
        description: "42",
      },
    },
  });

  await expect(evaluation).resolves.toMatchObject({
    result: {
      type: "number",
      value: 42,
    },
  });

  await session.close();
});

test("createNodeSession break maps file:line input to a breakpoint url", async () => {
  const mock = createMockSocket();
  const session = await bootstrapSession(mock);

  mock.emit({
    method: "Debugger.scriptParsed",
    params: {
      scriptId: "script-9",
      url: "file:///tmp/node-fixture.js",
    },
  });

  const breakResult = session.break("file:///tmp/node-fixture.js:42");
  const sent = parseSentMessages(mock.sent);

  expect(sent.at(-1)?.method).toBe("Debugger.setBreakpointByUrl");
  expect(sent.at(-1)?.params).toMatchObject({
    url: "file:///tmp/node-fixture.js",
    lineNumber: 41,
    columnNumber: 0,
  });

  mock.emit({
    id: 3,
    result: {
      breakpointId: "breakpoint-1",
      locations: [
        {
          scriptId: "script-9",
          url: "/tmp/node-fixture.js",
          lineNumber: 41,
          columnNumber: 0,
        },
      ],
    },
  });

  await expect(breakResult).resolves.toEqual({
    breakpointId: "breakpoint-1",
    locations: [
      {
        scriptId: "script-9",
        url: "/tmp/node-fixture.js",
        lineNumber: 41,
        columnNumber: 0,
      },
    ],
  });

  await session.close();
});

test("createNodeSession rejects state access after close", async () => {
  const mock = createMockSocket({ autoClose: false });
  const session = await bootstrapSession(mock);

  const closing = session.close();
  let settled = false;
  void closing.then(() => {
    settled = true;
  });

  await Bun.sleep(0);
  expect(settled).toBe(false);

  mock.emitClose();
  await closing;

  await expect(session.state()).rejects.toMatchObject({ code: "transport.closed" });
  await expect(session.stack()).rejects.toMatchObject({ code: "transport.closed" });
  await expect(session.vars()).rejects.toMatchObject({ code: "transport.closed" });
});

test("createNodeSession surfaces unexpected transport loss as transport.closed", async () => {
  const mock = createMockSocket({ autoClose: false });
  const session = await bootstrapSession(mock);

  const paused = session.pause();
  mock.emit({ id: 3, result: {} });
  mock.emit({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [
        {
          callFrameId: "frame-8",
          functionName: "watch",
          location: {
            scriptId: "script-8",
            lineNumber: 2,
            columnNumber: 0,
          },
          scopeChain: [],
        },
      ],
    },
  });
  await paused;

  mock.emitClose();

  await expect(session.state()).rejects.toMatchObject({ code: "transport.closed" });
  await expect(session.stack()).rejects.toMatchObject({ code: "transport.closed" });
  await expect(session.vars()).rejects.toMatchObject({ code: "transport.closed" });
});

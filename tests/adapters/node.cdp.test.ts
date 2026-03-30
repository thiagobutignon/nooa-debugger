import { expect, test } from "bun:test";
import { createNodeCdpClient } from "../../src/adapters/node/cdp";

type Listener = (event: { data: string }) => void;

function createMockSocket(options: { autoClose?: boolean } = {}) {
  const sent: string[] = [];
  const messageListeners = new Set<Listener>();
  const closeListeners = new Set<() => void>();
  const autoClose = options.autoClose ?? true;

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
      socket.readyState = 2;
      if (autoClose) {
        api.emitClose();
      }
    },
  };

  const api = {
    sent,
    socket,
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

test("createNodeCdpClient correlates responses by id", async () => {
  const mock = createMockSocket();
  const client = createNodeCdpClient(mock.socket as WebSocket);

  const first = client.send("Runtime.enable");
  const second = client.send("Debugger.enable");

  mock.emit({ id: 2, result: { debuggerEnabled: true } });
  mock.emit({ id: 1, result: { runtimeEnabled: true } });

  await expect(first).resolves.toEqual({ runtimeEnabled: true });
  await expect(second).resolves.toEqual({ debuggerEnabled: true });

  expect(mock.sent).toEqual([
    JSON.stringify({ id: 1, method: "Runtime.enable" }),
    JSON.stringify({ id: 2, method: "Debugger.enable" }),
  ]);

  await client.close();
});

test("createNodeCdpClient buffers Debugger.paused before waitForPaused is called", async () => {
  const mock = createMockSocket();
  const client = createNodeCdpClient(mock.socket as WebSocket);

  mock.emit({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [{ callFrameId: "frame-1" }],
    },
  });

  await expect(client.waitForPaused()).resolves.toEqual({
    method: "Debugger.paused",
    params: {
      reason: "breakpoint",
      callFrames: [{ callFrameId: "frame-1" }],
    },
  });

  await client.close();
});

test("createNodeCdpClient maps inspector errors to stable machine-readable codes", async () => {
  const mock = createMockSocket();
  const client = createNodeCdpClient(mock.socket as WebSocket);

  const request = client.send("Runtime.evaluate");
  mock.emit({
    id: 1,
    error: {
      code: -32000,
      message: "Cannot evaluate in running state",
    },
  });

  await expect(request).rejects.toMatchObject({
    code: "session.invalid_state",
    detail_code: "node.inspector.request_failed",
    message: expect.stringContaining("Cannot evaluate in running state"),
  });

  await client.close();
});

test("createNodeCdpClient close waits for the socket close event", async () => {
  const mock = createMockSocket({ autoClose: false });
  const client = createNodeCdpClient(mock.socket as WebSocket);

  let settled = false;
  const closing = client.close().then(() => {
    settled = true;
  });

  await Bun.sleep(0);
  expect(settled).toBe(false);

  mock.emitClose();
  await closing;
  expect(settled).toBe(true);
});

import { expect, test } from "bun:test";
import { createDapClient } from "../../src/adapters/dap-node/client";
import type {
  DapEventMessage,
  DapMessage,
  DapRequestMessage,
  DapResponseMessage,
  DapTransport,
} from "../../src/adapters/dap-node/protocol";

function createMemoryTransport() {
  const sent: DapRequestMessage[] = [];
  const listeners = new Set<(message: DapMessage) => void>();

  const transport: DapTransport = {
    send(message) {
      sent.push(message);
    },
    close() {
      return undefined;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    sent,
    transport,
    emit(message: DapMessage) {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

test("dap client sends requests and resolves responses by request_seq", async () => {
  const memory = createMemoryTransport();
  const client = createDapClient(memory.transport);

  const initialize = client.initialize({
    adapterID: "node",
    linesStartAt1: true,
    columnsStartAt1: true,
  });

  expect(memory.sent).toHaveLength(1);
  expect(memory.sent[0]).toEqual({
    seq: 1,
    type: "request",
    command: "initialize",
    arguments: {
      adapterID: "node",
      linesStartAt1: true,
      columnsStartAt1: true,
    },
  });

  memory.emit({
    seq: 99,
    type: "response",
    request_seq: 1,
    success: true,
    command: "initialize",
    body: {
      supportsConfigurationDoneRequest: true,
    },
  } satisfies DapResponseMessage);

  await expect(initialize).resolves.toEqual({
    supportsConfigurationDoneRequest: true,
  });

  await client.dispose();
});

test("dap client exposes event listeners and high-level helpers", async () => {
  const memory = createMemoryTransport();
  const client = createDapClient(memory.transport);
  const events: string[] = [];

  const removeListener = client.onEvent("stopped", (event) => {
    events.push(event.reason as string);
  });

  const stackTrace = client.stackTrace({ threadId: 7 });
  expect(memory.sent[0]).toEqual({
    seq: 1,
    type: "request",
    command: "stackTrace",
    arguments: { threadId: 7 },
  });

  memory.emit({
    seq: 100,
    type: "event",
    event: "stopped",
    body: { reason: "breakpoint" },
  } satisfies DapEventMessage);

  memory.emit({
    seq: 101,
    type: "response",
    request_seq: 1,
    success: true,
    command: "stackTrace",
    body: {
      stackFrames: [
        {
          id: 4,
          name: "main",
          source: { path: "/tmp/app.ts" },
          line: 12,
          column: 3,
        },
      ],
    },
  } satisfies DapResponseMessage);

  await expect(stackTrace).resolves.toEqual({
    stackFrames: [
      {
        id: 4,
        name: "main",
        source: { path: "/tmp/app.ts" },
        line: 12,
        column: 3,
      },
    ],
  });

  const vars = client.variables({ variablesReference: 12 });
  expect(memory.sent[1]).toEqual({
    seq: 2,
    type: "request",
    command: "variables",
    arguments: { variablesReference: 12 },
  });

  memory.emit({
    seq: 102,
    type: "response",
    request_seq: 2,
    success: true,
    command: "variables",
    body: {
      variables: [{ name: "tracked", value: "41", variablesReference: 0 }],
    },
  } satisfies DapResponseMessage);

  await expect(vars).resolves.toEqual({
    variables: [{ name: "tracked", value: "41", variablesReference: 0 }],
  });

  expect(events).toEqual(["breakpoint"]);

  removeListener();
  await client.dispose();
});

import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { once } from "node:events";

test("stdio DAP transport parses chunked Content-Length frames", async () => {
  const { createDapRequest, createStdioDapTransport } = await import("../../src/adapters/dap/stdio");
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: unknown[] = [];
  const transport = createStdioDapTransport({
    stdin: output,
    stdout: input,
  });

  const unsubscribe = transport.onMessage((message) => {
    messages.push(message);
  });

  const response = JSON.stringify({
    seq: 2,
    type: "response",
    request_seq: 1,
    success: true,
    command: "initialize",
    body: { supportsConfigurationDoneRequest: true },
  });
  const event = JSON.stringify({
    seq: 3,
    type: "event",
    event: "stopped",
    body: { reason: "breakpoint", threadId: 7 },
  });

  input.write(`Content-Length: ${response.length}\r\n\r\n${response.slice(0, 30)}`);
  input.write(response.slice(30));
  input.write(`Content-Length: ${event.length}\r\n\r\n${event}`);
  input.end();
  await once(input, "end");

  expect(messages).toEqual([
    {
      seq: 2,
      type: "response",
      request_seq: 1,
      success: true,
      command: "initialize",
      body: { supportsConfigurationDoneRequest: true },
    },
    {
      seq: 3,
      type: "event",
      event: "stopped",
      body: { reason: "breakpoint", threadId: 7 },
    },
  ]);

  await transport.send(createDapRequest(1, "initialize", { adapterID: "node" }));
  const written = output.read()?.toString("utf8") ?? "";
  expect(written).toContain("Content-Length:");
  expect(written).toContain('"command":"initialize"');

  unsubscribe();
  await transport.close();
});

test("stdio DAP transport closes the underlying process handles", async () => {
  const { createStdioDapTransport } = await import("../../src/adapters/dap/stdio");
  const input = new PassThrough();
  const output = new PassThrough();
  let closed = false;

  const transport = createStdioDapTransport({
    stdin: output,
    stdout: input,
    close: async () => {
      closed = true;
    },
  });

  await transport.close();

  expect(closed).toBe(true);
});

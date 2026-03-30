import { expect, test } from "bun:test";
import { fetchNodeInspectorWebSocketUrl, resolveNodeInspectorEndpoint } from "../../src/adapters/node/discovery";

test("resolveNodeInspectorEndpoint normalizes ws_url into host and port", async () => {
  await expect(
    resolveNodeInspectorEndpoint({
      wsUrl: "ws://127.0.0.1:9229/abc123",
    }),
  ).resolves.toEqual({
    wsUrl: "ws://127.0.0.1:9229/abc123",
    host: "127.0.0.1",
    port: 9229,
  });
});

test("fetchNodeInspectorWebSocketUrl resolves the websocket debugger url from /json/version", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        webSocketDebuggerUrl: "ws://127.0.0.1:9229/abc123",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    await expect(fetchNodeInspectorWebSocketUrl("127.0.0.1", 9229)).resolves.toBe(
      "ws://127.0.0.1:9229/abc123",
    );
    expect(calls).toEqual(["http://127.0.0.1:9229/json/version"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchNodeInspectorWebSocketUrl normalizes fetch network failures to transport.unreachable", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (() => {
    throw new TypeError("connect ECONNREFUSED");
  }) as typeof fetch;

  try {
    await expect(fetchNodeInspectorWebSocketUrl("127.0.0.1", 9229)).rejects.toMatchObject({
      code: "transport.unreachable",
      message: expect.stringContaining("connect ECONNREFUSED"),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveNodeInspectorEndpoint normalizes malformed ws_url to transport.unreachable", async () => {
  await expect(
    resolveNodeInspectorEndpoint({
      wsUrl: "not-a-url",
    }),
  ).rejects.toMatchObject({
    code: "transport.unreachable",
    message: expect.stringContaining("invalid ws_url"),
  });
});

test("resolveNodeInspectorEndpoint rejects when attach inputs are missing", async () => {
  await expect(resolveNodeInspectorEndpoint({})).rejects.toMatchObject({
    code: "transport.unreachable",
  });
});

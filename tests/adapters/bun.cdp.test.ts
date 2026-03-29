import { expect, test } from "bun:test";
import { createBunCdpClient } from "../../src/adapters/bun/cdp";

function decodeMessage(message: string | Uint8Array): string {
  if (typeof message === "string") return message;
  return new TextDecoder().decode(message);
}

function startMockInspector(
  onMessage: (socket: unknown, payload: any) => void,
  onOpen?: (socket: unknown) => void,
) {
  return Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) {
        return;
      }
      return new Response("ok");
    },
    websocket: {
      open(socket) {
        onOpen?.(socket);
      },
      message(socket, message) {
        onMessage(socket, JSON.parse(decodeMessage(message)));
      },
    },
  });
}

test("createBunCdpClient correlates out-of-order CDP responses by request id", async () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  const received: Array<{ id: number; method: string }> = [];

  try {
    server = startMockInspector((socket, payload) => {
      received.push(payload);
      if (received.length !== 2) return;

      queueMicrotask(() => {
        (socket as { send: (message: string) => void }).send(
          JSON.stringify({
            id: received[1].id,
            result: { echoed_method: received[1].method },
          }),
        );
        (socket as { send: (message: string) => void }).send(
          JSON.stringify({
            id: received[0].id,
            result: { echoed_method: received[0].method },
          }),
        );
      });
    });

    const client = createBunCdpClient(`ws://127.0.0.1:${server.port}/`);
    try {
      const first = client.send("Debugger.enable");
      const second = client.send("Runtime.enable");

      const firstResponse = await first;
      const secondResponse = await second;

      expect(received).toEqual([
        { id: 1, method: "Debugger.enable" },
        { id: 2, method: "Runtime.enable" },
      ]);
      expect(firstResponse.id).toBe(1);
      expect(firstResponse.result.echoed_method).toBe("Debugger.enable");
      expect(secondResponse.id).toBe(2);
      expect(secondResponse.result.echoed_method).toBe("Runtime.enable");
    } finally {
      await client.close();
    }
  } finally {
    server?.stop();
  }
});

test("createBunCdpClient captures paused events even before waitForPaused is called", async () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  try {
    server = startMockInspector(
      (socket, payload) => {
        if (payload.method === "Debugger.enable") {
          (socket as { send: (message: string) => void }).send(
            JSON.stringify({ id: payload.id, result: {} }),
          );
          return;
        }

        if (payload.method === "Runtime.enable") {
          (socket as { send: (message: string) => void }).send(
            JSON.stringify({ id: payload.id, result: {} }),
          );
          (socket as { send: (message: string) => void }).send(
            JSON.stringify({
              method: "Debugger.paused",
              params: {
                reason: "breakpoint",
                hitBreakpoints: ["file:///fixture.ts:3"],
              },
            }),
          );
        }
      },
      (socket) => {
        (socket as { send: (message: string) => void }).send(
          JSON.stringify({
            method: "Debugger.paused",
            params: {
              reason: "breakpoint",
              hitBreakpoints: ["file:///fixture.ts:1"],
            },
          }),
        );
      },
    );

    const client = createBunCdpClient(`ws://127.0.0.1:${server.port}/`);
    try {
      await client.send("Debugger.enable");
      await client.send("Runtime.enable");

      const paused = await client.waitForPaused(1_000);

      expect(paused.method).toBe("Debugger.paused");
      expect(paused.params.reason).toBe("breakpoint");
      expect(paused.params.hitBreakpoints).toEqual(["file:///fixture.ts:1"]);
    } finally {
      await client.close();
    }
  } finally {
    server?.stop();
  }
});

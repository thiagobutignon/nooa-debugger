import { expect, test } from "bun:test";
import { launchNodeTarget, extractNodeInspectorUrl } from "../../src/adapters/node/launch";

test("extractNodeInspectorUrl reads the inspector websocket from node stderr", () => {
  const stderr = [
    "Debugger listening on ws://127.0.0.1:61234/abc123",
    "For help, see: https://nodejs.org/en/docs/inspector",
  ].join("\n");

  expect(extractNodeInspectorUrl(stderr)).toBe("ws://127.0.0.1:61234/abc123");
});

test("extractNodeInspectorUrl returns undefined when stderr does not contain an inspector url", () => {
  expect(extractNodeInspectorUrl("node started without inspector")).toBeUndefined();
});

test("extractNodeInspectorUrl ignores non-localhost inspector urls", () => {
  expect(extractNodeInspectorUrl("Debugger listening on ws://10.0.0.1:61234/abc123")).toBeUndefined();
});

test("launchNodeTarget reads stderr chunks until it discovers the inspector url", async () => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [
    encoder.encode("Debugger listening on "),
    encoder.encode("ws://127.0.0.1:61234/abc123\n"),
  ];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const spawn = () => {
    const stderr = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
    });

    const exited = new Promise<number>(() => {});

    return {
      pid: 4242,
      stderr,
      exited,
      kill() {},
      unref() {},
    };
  };

  const launched = launchNodeTarget(["node", "tests/fixtures/node-idle.js"], {
    spawn,
    timeoutMs: 200,
  });

  controller?.enqueue(chunks[0]);
  await Bun.sleep(20);
  controller?.enqueue(chunks[1]);

  await expect(launched).resolves.toMatchObject({
    pid: 4242,
    ws_url: "ws://127.0.0.1:61234/abc123",
  });
});

test("launchNodeTarget fails when the inspector url never appears", async () => {
  const spawn = () => {
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("node booted"));
        controller.close();
      },
    });

    const exited = Promise.resolve(0);

    return {
      pid: 4242,
      stderr,
      exited,
      kill() {},
      unref() {},
    };
  };

  await expect(
    launchNodeTarget(["node", "tests/fixtures/node-idle.js"], {
      spawn,
      timeoutMs: 50,
    }),
  ).rejects.toThrow(/transport\.unreachable/);
});

test("launchNodeTarget rejects empty commands with runtime.not_supported", async () => {
  await expect(launchNodeTarget([])).rejects.toMatchObject({
    code: "runtime.not_supported",
  });
});

test("launchNodeTarget rejects non-node commands with runtime.not_supported", async () => {
  await expect(launchNodeTarget(["npm", "run", "dev"])).rejects.toMatchObject({
    code: "runtime.not_supported",
  });
});

import { afterEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";
import { createSessionStore } from "../../src/kernel/sessions/store";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");
const pauseFixturePath = join(import.meta.dir, "..", "fixtures", "bun-breakpoint.ts");
const repoRoot = join(import.meta.dir, "..", "..");
const sessionIdsToStop: Array<{ cwd: string; sessionId: string }> = [];

async function runCommand(args: string[], cwd: string) {
  const writes: string[] = [];
  await main(args, {
    write: (chunk) => writes.push(chunk),
    setExitCode: () => undefined,
    cwd,
  });
  return JSON.parse(writes.join("").trim());
}

async function readJsonFromStream(
  stream: ReadableStream<Uint8Array> | null,
  timeoutMs = 2_000,
): Promise<any> {
  if (!stream) {
    throw new Error("Missing stdout stream");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Timed out waiting for JSON output");
      }

      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => ({ done: true, value: undefined, timedOut: true })),
      ]);

      if ("timedOut" in chunk) {
        throw new Error("Timed out waiting for JSON output");
      }

      if (chunk.done) {
        throw new Error(`Stream ended before JSON was complete: ${buffer}`);
      }

      buffer += decoder.decode(chunk.value, { stream: true });

      try {
        return JSON.parse(buffer.trim());
      } catch {}
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

afterEach(async () => {
  for (const item of sessionIdsToStop) {
    await runCommand(["debug", "stop", item.sessionId], item.cwd).catch(() => {});
  }
  sessionIdsToStop.length = 0;
});

test("debug status reloads persisted session and stop exits it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-status-"));

  const launchWrites: string[] = [];
  await main(["debug", "launch", "--", "bun", "run", fixturePath], {
    write: (chunk) => launchWrites.push(chunk),
    cwd,
  });
  const launchPayload = JSON.parse(launchWrites.join("").trim());
  expect(launchPayload.ok).toBe(true);
  expect(launchPayload.data.daemon.running).toBe(true);
  expect(typeof launchPayload.data.daemon.pid).toBe("number");

  const statusWrites: string[] = [];
  await main(["debug", "status", launchPayload.data.session_id], {
    write: (chunk) => statusWrites.push(chunk),
    cwd,
  });
  const statusPayload = JSON.parse(statusWrites.join("").trim());
  expect(statusPayload.ok).toBe(true);
  expect(statusPayload.data.session_id).toBe(launchPayload.data.session_id);
  expect(["running", "created"]).toContain(statusPayload.data.state);
  expect(statusPayload.data.daemon.running).toBe(true);
  expect(statusPayload.data.daemon.pid).toBe(launchPayload.data.daemon.pid);

  const stopWrites: string[] = [];
  await main(["debug", "stop", launchPayload.data.session_id], {
    write: (chunk) => stopWrites.push(chunk),
    cwd,
  });
  const stopPayload = JSON.parse(stopWrites.join("").trim());
  expect(stopPayload.ok).toBe(true);
  expect(stopPayload.data.state).toBe("exited");
  expect(stopPayload.data.daemon.running).toBe(false);
});

test("debug launch exits as a short-lived CLI process while the target stays alive", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-launch-cli-"));
  const child = Bun.spawn(
    ["bun", join(repoRoot, "index.ts"), "debug", "launch", "--", "bun", "run", pauseFixturePath],
    {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    },
  );

  let launchPayload: any;
  try {
    launchPayload = await readJsonFromStream(child.stdout);
    expect(launchPayload.ok).toBe(true);
    sessionIdsToStop.push({ cwd, sessionId: launchPayload.data.session_id });

    const exitState = await Promise.race([
      child.exited.then(() => "exited"),
      Bun.sleep(1_000).then(() => "timeout"),
    ]);
    expect(exitState).toBe("exited");

    await Bun.sleep(150);

    const status = await runCommand(["debug", "status", launchPayload.data.session_id], cwd);
    expect(status.ok).toBe(true);
    expect(status.data.daemon.running).toBe(true);
    expect(status.data.state).toBe("running");
  } finally {
    child.kill();
    await child.exited.catch(() => {});
  }
});

test("debug launch followed by debug pause can inspect a live Bun target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-pause-"));

  const launch = await runCommand(["debug", "launch", "--", "bun", "run", pauseFixturePath], cwd);
  expect(launch.ok).toBe(true);
  expect(launch.data.daemon.running).toBe(true);
  expect(typeof launch.data.daemon.pid).toBe("number");
  sessionIdsToStop.push({ cwd, sessionId: launch.data.session_id });

  await Bun.sleep(100);

  const paused = await runCommand(["debug", "pause", launch.data.session_id], cwd);
  expect(paused.ok).toBe(true);
  expect(paused.data.session_id).toBe(launch.data.session_id);
  expect(paused.data.state).toBe("paused");
  expect(paused.data.location.file).toBe(pauseFixturePath);

  const state = await runCommand(["debug", "state", launch.data.session_id], cwd);
  expect(state.ok).toBe(true);
  expect(state.data.location.file).toBe(pauseFixturePath);
  expect(state.data.location.line).toBeGreaterThanOrEqual(8);
  expect(state.data.frame_refs.length).toBeGreaterThan(0);

  const evalResult = await runCommand(
    ["debug", "eval", launch.data.session_id, "globalThis.tracked + 1"],
    cwd,
  );
  expect(evalResult.ok).toBe(true);
  expect(evalResult.data.result.value).toBe("42");
});

test("debug break followed by continue pauses on a future Bun callback breakpoint", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-break-"));

  const launch = await runCommand(["debug", "launch", "--", "bun", "run", pauseFixturePath], cwd);
  expect(launch.ok).toBe(true);
  sessionIdsToStop.push({ cwd, sessionId: launch.data.session_id });

  const breakpoint = await runCommand(
    ["debug", "break", launch.data.session_id, `${pauseFixturePath}:11`],
    cwd,
  );
  expect(breakpoint.ok).toBe(true);

  const paused = await runCommand(["debug", "continue", launch.data.session_id], cwd);
  expect(paused.ok).toBe(true);
  expect(paused.data.state).toBe("paused");
  expect(paused.data.location.file).toBe(pauseFixturePath);
  expect(paused.data.location.line).toBe(11);

  const evalResult = await runCommand(
    ["debug", "eval", launch.data.session_id, "globalThis.tracked + 1"],
    cwd,
  );
  expect(evalResult.ok).toBe(true);
  expect(evalResult.data.result.value).toBe("42");
});

test("debug continue releases Bun waiting_for_debugger before waiting for the next pause", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-waiting-"));

  const launch = await runCommand(
    ["debug", "launch", "--brk", "--", "bun", "run", pauseFixturePath],
    cwd,
  );
  expect(launch.ok).toBe(true);
  expect(launch.data.waiting_for_debugger).toBe(true);
  sessionIdsToStop.push({ cwd, sessionId: launch.data.session_id });

  const breakpoint = await runCommand(
    ["debug", "break", launch.data.session_id, `${pauseFixturePath}:11`],
    cwd,
  );
  expect(breakpoint.ok).toBe(true);

  const paused = await runCommand(["debug", "continue", launch.data.session_id], cwd);
  expect(paused.ok).toBe(true);
  expect(paused.data.state).toBe("paused");
  expect(paused.data.location.file).toBe(pauseFixturePath);
  expect(paused.data.location.line).toBe(11);
});

test("debug state can recover a paused snapshot from the live bridge when persisted snapshot is missing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-rehydrate-"));
  const sessions = createSessionStore(cwd);

  const launch = await runCommand(["debug", "launch", "--", "bun", "run", pauseFixturePath], cwd);
  expect(launch.ok).toBe(true);
  sessionIdsToStop.push({ cwd, sessionId: launch.data.session_id });

  await Bun.sleep(100);

  const paused = await runCommand(["debug", "pause", launch.data.session_id], cwd);
  expect(paused.ok).toBe(true);

  const persisted = await sessions.get(launch.data.session_id);
  expect(persisted?.state).toBe("paused");
  expect(persisted?.paused_snapshot).toBeDefined();

  await sessions.put({
    ...persisted!,
    state: "paused",
    paused_snapshot: undefined,
  });

  const state = await runCommand(["debug", "state", launch.data.session_id], cwd);
  expect(state.ok).toBe(true);
  expect(state.data.location.file).toBe(pauseFixturePath);

  const evalResult = await runCommand(
    ["debug", "eval", launch.data.session_id, "globalThis.tracked + 1"],
    cwd,
  );
  expect(evalResult.ok).toBe(true);
  expect(evalResult.data.result.value).toBe("42");
});

import { afterEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");
const pauseFixturePath = join(import.meta.dir, "..", "fixtures", "bun-breakpoint.ts");
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

  const statusWrites: string[] = [];
  await main(["debug", "status", launchPayload.data.session_id], {
    write: (chunk) => statusWrites.push(chunk),
    cwd,
  });
  const statusPayload = JSON.parse(statusWrites.join("").trim());
  expect(statusPayload.ok).toBe(true);
  expect(statusPayload.data.session_id).toBe(launchPayload.data.session_id);
  expect(["running", "created"]).toContain(statusPayload.data.state);

  const stopWrites: string[] = [];
  await main(["debug", "stop", launchPayload.data.session_id], {
    write: (chunk) => stopWrites.push(chunk),
    cwd,
  });
  const stopPayload = JSON.parse(stopWrites.join("").trim());
  expect(stopPayload.ok).toBe(true);
  expect(stopPayload.data.state).toBe("exited");
});

test("debug launch followed by debug pause can inspect a live Bun target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-pause-"));

  const launch = await runCommand(["debug", "launch", "--", "bun", "run", pauseFixturePath], cwd);
  expect(launch.ok).toBe(true);
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

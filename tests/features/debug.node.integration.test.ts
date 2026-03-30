import { afterEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

const idleFixturePath = join(import.meta.dir, "..", "fixtures", "node-idle.js");
const breakpointFixturePath = join(import.meta.dir, "..", "fixtures", "node-breakpoint.js");
const sessionIdsToStop: Array<{ cwd: string; sessionId: string }> = [];

async function runDebug(args: string[], cwd: string) {
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
    await runDebug(["debug", "stop", item.sessionId], item.cwd).catch(() => {});
  }
  sessionIdsToStop.length = 0;
});

test("debug node launch pause state eval and stop work against a live target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-node-live-"));

  const launch = await runDebug(
    ["debug", "launch", "--runtime", "node", "--", "node", idleFixturePath],
    cwd,
  );
  expect(launch.ok).toBe(true);
  expect(launch.data.runtime).toBe("node");
  sessionIdsToStop.push({ cwd, sessionId: launch.data.session_id });

  await Bun.sleep(100);

  const paused = await runDebug(["debug", "pause", launch.data.session_id], cwd);
  expect(paused.ok).toBe(true);
  expect(paused.data.state).toBe("paused");

  const state = await runDebug(["debug", "state", launch.data.session_id], cwd);
  expect(state.ok).toBe(true);
  expect(state.data.frame_refs.length).toBeGreaterThan(0);
  expect(typeof state.data.location.line).toBe("number");
  expect(state.data.location.line).toBeGreaterThan(0);

  const evaluation = await runDebug(
    ["debug", "eval", launch.data.session_id, "globalThis.__tracked + 1"],
    cwd,
  );
  expect(evaluation.ok).toBe(true);
  expect(evaluation.data.result.value).toBe("42");

  const stopped = await runDebug(["debug", "stop", launch.data.session_id], cwd);
  expect(stopped.ok).toBe(true);
  expect(stopped.data.state).toBe("exited");
});

test("debug node break followed by continue pauses on a future callback breakpoint", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-node-break-"));

  const launch = await runDebug(
    ["debug", "launch", "--runtime", "node", "--", "node", breakpointFixturePath],
    cwd,
  );
  expect(launch.ok).toBe(true);
  sessionIdsToStop.push({ cwd, sessionId: launch.data.session_id });

  const breakpoint = await runDebug(
    ["debug", "break", launch.data.session_id, `${breakpointFixturePath}:3`],
    cwd,
  );
  expect(breakpoint.ok).toBe(true);

  const paused = await runDebug(["debug", "continue", launch.data.session_id], cwd);
  expect(paused.ok).toBe(true);
  expect(paused.data.state).toBe("paused");
  expect(paused.data.location.file).toBe(breakpointFixturePath);
  expect(paused.data.location.line).toBe(3);

  const evaluation = await runDebug(
    ["debug", "eval", launch.data.session_id, "tracked + 1"],
    cwd,
  );
  expect(evaluation.ok).toBe(true);
  expect(evaluation.data.result.value).toBe("42");
});

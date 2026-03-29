import { afterEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-debugger-statement.js");
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

// Bun 1.3.10 currently does not emit a usable Debugger.paused event for this
// flow in local dogfooding, even when attached to the inspector and waiting.
test.skip("debugger can wait for a Bun debugger statement and inspect runtime state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-paused-state-"));

  const launch = await runCommand(
    ["debug", "launch", "--", "bun", "run", fixturePath],
    cwd,
  );
  expect(launch.ok).toBe(true);
  sessionIdsToStop.push({ cwd, sessionId: launch.data.session_id });

  const resumed = await runCommand(
    ["debug", "continue", launch.data.session_id],
    cwd,
  );
  expect(resumed.ok).toBe(true);
  expect(resumed.data.state).toBe("paused");

  const state = await runCommand(["debug", "state", launch.data.session_id], cwd);
  expect(state.ok).toBe(true);
  expect(state.data.location.file).toContain("bun-debugger-statement.js");
  expect(state.data.location.line).toBe(5);

  const vars = await runCommand(["debug", "vars", launch.data.session_id], cwd);
  expect(vars.ok).toBe(true);
  expect(vars.data.locals.some((local: { name: string; value: string }) => local.name === "tracked" && local.value === "41")).toBe(true);

  const evalResult = await runCommand(
    ["debug", "eval", launch.data.session_id, "tracked + 1"],
    cwd,
  );
  expect(evalResult.ok).toBe(true);
  expect(evalResult.data.result.value).toBe("42");

  const resumedAgain = await runCommand(
    ["debug", "continue", launch.data.session_id],
    cwd,
  );
  expect(resumedAgain.ok).toBe(true);
  expect(resumedAgain.data.state).toBe("running");
});

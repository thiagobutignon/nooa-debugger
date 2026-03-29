import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";
import { createSessionStore } from "../../src/kernel/sessions/store";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");

async function runDebug(args: string[], cwd: string) {
  const writes: string[] = [];

  await main(args, {
    write: (chunk) => writes.push(chunk),
    setExitCode: () => undefined,
    cwd,
  });

  return JSON.parse(writes.join("").trim());
}

test("debug launch returns session and investigation ids", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-launch-"));
  const writes: string[] = [];

  await main(["debug", "launch", "--", "bun", "run", fixturePath], {
    write: (chunk) => writes.push(chunk),
    cwd,
  });

  const payload = JSON.parse(writes.join("").trim());
  expect(payload.ok).toBe(true);
  expect(payload.data.session_id).toStartWith("sess-");
  expect(payload.data.investigation_id).toStartWith("inv-");
  expect(payload.data.runtime).toBe("bun");
});

test("debug break reports missing session ids as not found", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-break-missing-"));
  const payload = await runDebug(["debug", "break"], cwd);

  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.not_found");
  expect(payload.error.recoverable).toBe(true);
});

test("debug break reports transport loss when ws_url is unavailable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-break-transport-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "running",
    root_command: ["bun", "run", fixturePath],
  });

  const payload = await runDebug(
    ["debug", "break", session.session_id, `${fixturePath}:3`],
    cwd,
  );

  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.transport_lost");
});

test("debug state rejects a running session", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-state-running-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "running",
    root_command: ["bun", "run", fixturePath],
  });

  const payload = await runDebug(["debug", "state", session.session_id], cwd);

  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.invalid_state");
});

test("debug state returns the persisted paused snapshot", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-state-paused-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "paused",
    root_command: ["bun", "run", fixturePath],
  });

  await sessions.put({
    ...session,
    state: "paused",
    paused_snapshot: {
      paused_ref: "pause-1",
      captured_at: new Date().toISOString(),
      location: {
        file: fixturePath,
        line: 3,
        column: 1,
      },
      frames: [
        {
          frame_ref: "@f0",
          call_frame_id: "cf-1",
          function_name: "main",
          location: {
            file: fixturePath,
            line: 3,
            column: 1,
          },
        },
      ],
      locals: [{ frame_ref: "@f0", name: "tracked", value: "41", type: "number" }],
    },
  });

  const payload = await runDebug(["debug", "state", session.session_id], cwd);

  expect(payload.ok).toBe(true);
  expect(payload.data.location.file).toBe(fixturePath);
  expect(payload.data.location.line).toBe(3);
  expect(payload.data.frame_refs).toEqual(["@f0"]);
});

test("debug stack reports a stale paused snapshot", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-stack-paused-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "paused",
    root_command: ["bun", "run", fixturePath],
  });

  const payload = await runDebug(["debug", "stack", session.session_id], cwd);

  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.stale_snapshot");
});

test("debug vars reports a stale paused snapshot", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-vars-paused-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "paused",
    root_command: ["bun", "run", fixturePath],
  });

  const payload = await runDebug(["debug", "vars", session.session_id], cwd);

  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.stale_snapshot");
});

test("debug vars returns persisted locals from the paused snapshot", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-vars-snapshot-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "paused",
    root_command: ["bun", "run", fixturePath],
  });

  await sessions.put({
    ...session,
    state: "paused",
    paused_snapshot: {
      paused_ref: "pause-1",
      captured_at: new Date().toISOString(),
      location: {
        file: fixturePath,
        line: 3,
        column: 1,
      },
      frames: [
        {
          frame_ref: "@f0",
          call_frame_id: "cf-1",
          function_name: "main",
          location: {
            file: fixturePath,
            line: 3,
            column: 1,
          },
        },
      ],
      locals: [{ frame_ref: "@f0", name: "tracked", value: "41", type: "number" }],
    },
  });

  const payload = await runDebug(["debug", "vars", session.session_id], cwd);

  expect(payload.ok).toBe(true);
  expect(payload.data.frame_ref).toBe("@f0");
  expect(payload.data.locals).toEqual([
    { name: "tracked", value: "41", type: "number" },
  ]);
});

test("debug eval reports a stale paused snapshot", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-eval-paused-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "paused",
    root_command: ["bun", "run", fixturePath],
  });

  const payload = await runDebug(["debug", "eval", session.session_id, "1 + 1"], cwd);

  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.stale_snapshot");
});

test("debug continue reports transport loss when a running session has no ws_url", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-debug-continue-running-"));
  const sessions = createSessionStore(cwd);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "running",
    root_command: ["bun", "run", fixturePath],
  });

  const payload = await runDebug(["debug", "continue", session.session_id], cwd);

  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.transport_lost");
});

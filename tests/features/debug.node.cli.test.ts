import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";
import { createSessionStore } from "../../src/kernel/sessions/store";

const idleFixturePath = join(import.meta.dir, "..", "fixtures", "node-idle.js");

async function runDebug(args: string[], cwd: string) {
  const writes: string[] = [];

  await main(args, {
    write: (chunk) => writes.push(chunk),
    setExitCode: () => undefined,
    cwd,
  });

  return JSON.parse(writes.join("").trim());
}

test("debug launch --runtime node persists a node session with inspector transport", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-node-cli-"));
  const sessions = createSessionStore(cwd);

  const payload = await runDebug(
    ["debug", "launch", "--runtime", "node", "--", "node", idleFixturePath],
    cwd,
  );

  expect(payload.ok).toBe(true);
  expect(payload.data.runtime).toBe("node");
  expect(payload.data.state).toBe("running");
  expect(typeof payload.data.root_pid).toBe("number");
  expect(payload.data.daemon.running).toBe(true);

  const session = await sessions.get(payload.data.session_id);
  expect(session?.adapter).toBe("node");
  expect(session?.runtime).toBe("node");
  expect(session?.root_command[0]).toBe("node");
  expect(session?.transport_hint?.ws_url).toContain("ws://127.0.0.1:");
  expect(session?.transport_hint?.bridge?.port).toBeGreaterThan(0);

  const stopped = await runDebug(["debug", "stop", payload.data.session_id], cwd);
  expect(stopped.ok).toBe(true);
});

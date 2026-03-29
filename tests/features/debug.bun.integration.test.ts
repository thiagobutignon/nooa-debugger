import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");

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

import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");

test("investigation show returns timeline events", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-investigation-show-"));

  const launchWrites: string[] = [];
  await main(["debug", "launch", "--", "bun", "run", fixturePath], {
    write: (chunk) => launchWrites.push(chunk),
    cwd,
  });
  const launchPayload = JSON.parse(launchWrites.join("").trim());

  const showWrites: string[] = [];
  await main(["investigation", "show", launchPayload.data.investigation_id], {
    write: (chunk) => showWrites.push(chunk),
    cwd,
  });
  const payload = JSON.parse(showWrites.join("").trim());
  expect(payload.ok).toBe(true);
  expect(payload.data.record.investigation_id).toBe(
    launchPayload.data.investigation_id,
  );
  expect(payload.data.events.length).toBeGreaterThan(0);
});

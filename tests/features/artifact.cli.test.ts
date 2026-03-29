import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");

test("artifact list and get return launch artifacts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-artifact-list-"));

  const launchWrites: string[] = [];
  await main(["debug", "launch", "--", "bun", "run", fixturePath], {
    write: (chunk) => launchWrites.push(chunk),
    cwd,
  });
  const launchPayload = JSON.parse(launchWrites.join("").trim());

  const listWrites: string[] = [];
  await main(["artifact", "list", launchPayload.data.investigation_id], {
    write: (chunk) => listWrites.push(chunk),
    cwd,
  });
  const listPayload = JSON.parse(listWrites.join("").trim());
  expect(listPayload.ok).toBe(true);
  expect(listPayload.data.items.length).toBeGreaterThan(0);

  const artifactId = listPayload.data.items[0].artifact_id;
  const getWrites: string[] = [];
  await main(["artifact", "get", artifactId], {
    write: (chunk) => getWrites.push(chunk),
    cwd,
  });
  const getPayload = JSON.parse(getWrites.join("").trim());
  expect(getPayload.ok).toBe(true);
  expect(getPayload.data.artifact_id).toBe(artifactId);
});

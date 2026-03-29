import { expect, test } from "bun:test";
import { readJsonFile, writeJsonAtomically } from "../../src/kernel/storage/fs";
import { createId } from "../../src/kernel/ids";
import { withFileLock } from "../../src/kernel/storage/lock";

test("createId prefixes identifiers", () => {
  expect(createId("sess")).toStartWith("sess-");
});

test("writeJsonAtomically writes readable JSON", async () => {
  const path = `/tmp/nooa-debugger-${Date.now()}.json`;
  await writeJsonAtomically(path, { schema_version: 1, ok: true });
  const value = await readJsonFile<{ ok: boolean }>(path);
  expect(value?.ok).toBe(true);
});

test("withFileLock serializes access for same path", async () => {
  const path = `/tmp/nooa-debugger-lock-${Date.now()}.lock`;
  const activeHolders: string[] = [];
  let maxConcurrentHolders = 0;

  await Promise.all([
    withFileLock(path, async () => {
      activeHolders.push("first");
      maxConcurrentHolders = Math.max(maxConcurrentHolders, activeHolders.length);
      await Bun.sleep(50);
      activeHolders.pop();
    }),
    withFileLock(path, async () => {
      activeHolders.push("second");
      maxConcurrentHolders = Math.max(maxConcurrentHolders, activeHolders.length);
      activeHolders.pop();
    }),
  ]);

  expect(activeHolders).toEqual([]);
  expect(maxConcurrentHolders).toBe(1);
});

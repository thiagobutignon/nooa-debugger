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
  const events: string[] = [];

  await Promise.all([
    withFileLock(path, async () => {
      events.push("first:start");
      await Bun.sleep(50);
      events.push("first:end");
    }),
    withFileLock(path, async () => {
      events.push("second:start");
      events.push("second:end");
    }),
  ]);

  expect(events).toEqual([
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

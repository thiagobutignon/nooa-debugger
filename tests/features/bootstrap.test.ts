import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

test("prints JSON error for unknown command", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nooa-debugger-bootstrap-"));
  const writes: string[] = [];
  const exitCodes: number[] = [];

  await main(["unknown"], {
    write: (chunk) => writes.push(chunk),
    setExitCode: (code) => exitCodes.push(code),
    cwd,
  });

  const payload = JSON.parse(writes.join("").trim());
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("command.unknown");
  expect(exitCodes.at(-1)).toBe(1);
});

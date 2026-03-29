import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../index";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");

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

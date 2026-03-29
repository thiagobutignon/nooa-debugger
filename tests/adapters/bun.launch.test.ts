import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { launchBunTarget } from "../../src/adapters/bun/launch";

const fixturePath = join(import.meta.dir, "..", "fixtures", "bun-idle.ts");
const pidsToCleanUp = new Set<number>();

afterEach(() => {
  for (const pid of pidsToCleanUp) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  pidsToCleanUp.clear();
});

test("launchBunTarget starts Bun inspector and returns ws_url", async () => {
  const launched = await launchBunTarget(["bun", "run", fixturePath]);
  pidsToCleanUp.add(launched.pid);

  expect(launched.command[0]).toBe("bun");
  expect(
    launched.command.some((part) => part.startsWith("--inspect")),
  ).toBe(true);
  expect(launched.ws_url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\//);
});

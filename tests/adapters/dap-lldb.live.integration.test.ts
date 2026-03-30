import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const LLDB_DAP = "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap";
const HAS_LLDB_DAP = existsSync(LLDB_DAP);
const HAS_CLANG = spawnSync("clang", ["--version"]).status === 0;
const RUN_LIVE_LLDB = process.env.NOOA_RUN_LLDB_LIVE === "1";

function createNativeLoopFixture() {
  const directory = mkdtempSync(join(tmpdir(), "nooa-lldb-live-"));
  const sourcePath = join(directory, "tracked-loop.c");
  const binaryPath = join(directory, "tracked-loop");

  writeFileSync(
    sourcePath,
    [
      "int main(void) {",
      "  volatile int tracked = 41;",
      "  volatile unsigned long tick = 0;",
      "  while (tick < 2000000000UL) {",
      "    tracked += 1;",
      "    tracked -= 1;",
      "    tick += 1;",
      "  }",
      "  return tracked - 41;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const compile = spawnSync("clang", ["-g", "-O0", sourcePath, "-o", binaryPath], {
    encoding: "utf8",
  });
  if (compile.status !== 0) {
    throw new Error(compile.stderr || "Failed to compile native LLDB fixture");
  }

  return {
    directory,
    binaryPath,
  };
}

if (!HAS_LLDB_DAP || !HAS_CLANG || !RUN_LIVE_LLDB) {
  test.skip("live LLDB integration requires local lldb-dap, clang, and NOOA_RUN_LLDB_LIVE=1", () => {});
} else {
  test("live LLDB session can launch a native target and pause into a stable main frame", async () => {
    const { startLldbDapSession } = await import("../../src/adapters/dap-lldb/live");
    const fixture = createNativeLoopFixture();
    const session = startLldbDapSession();

    const launched = await session.launch({
      program: fixture.binaryPath,
      cwd: fixture.directory,
      stopOnEntry: false,
    });

    expect(launched.kind).toBe("launch");
    await new Promise((resolve) => setTimeout(resolve, 200));

    const paused = await session.pause();
    expect(paused.state).toBe("paused");
    expect(paused.frames[0]?.name).toContain("main");

    const vars = await session.vars();
    expect(vars.locals.some((local) => local.name === "tracked")).toBe(true);

    const evaluated = await session.eval({
      expression: "tracked",
    });
    expect(evaluated.result).toContain("41");

    await session.close();
  }, 15000);
}

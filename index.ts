#!/usr/bin/env bun
import { loadCommands } from "./src/core/registry";
import { jsonError, type JsonFailure, type JsonSuccess } from "./src/core/errors";
import { writeJson } from "./src/core/json-output";

type MainDeps = {
  write: (chunk: string) => void;
  setExitCode: (code: number) => void;
  cwd: string;
};

export async function main(
  args: string[] = Bun.argv.slice(2),
  deps: Partial<MainDeps> = {},
): Promise<void> {
  const write = deps.write ?? ((chunk: string) => process.stdout.write(chunk));
  const setExitCode = deps.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  const cwd = deps.cwd ?? process.cwd();

  const commands = await loadCommands();
  const commandName = args[0];
  const command = commandName ? commands.get(commandName) : undefined;

  if (!command) {
    writeJson<JsonFailure>(
      write,
      jsonError("command.unknown", "Unknown command", { recoverable: false }),
    );
    setExitCode(1);
    return;
  }

  const result = await command.execute({ args, cwd });
  writeJson<JsonSuccess<unknown> | JsonFailure>(write, result);
  if (!result.ok) {
    setExitCode(1);
  }
}

if (import.meta.path === Bun.main) {
  await main();
}

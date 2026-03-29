import type { Command } from "./command";
import artifact from "../features/artifact/cli";
import debug from "../features/debug/cli";
import investigation from "../features/investigation/cli";

export async function loadCommands(): Promise<Map<string, Command>> {
  return new Map<string, Command>([
    [debug.name, debug],
    [investigation.name, investigation],
    [artifact.name, artifact],
  ]);
}

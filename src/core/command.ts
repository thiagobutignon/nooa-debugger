import type { JsonFailure, JsonSuccess } from "./errors";

export type CommandContext = {
  args: string[];
  cwd: string;
};

export type CommandResult = JsonSuccess<unknown> | JsonFailure;

export type Command = {
  name: string;
  execute: (context: CommandContext) => Promise<CommandResult>;
};

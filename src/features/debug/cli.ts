import type { Command } from "../../core/command";
import { runDebug } from "./execute";

const command: Command = {
  name: "debug",
  async execute({ args, cwd }) {
    return runDebug(args, cwd);
  },
};

export default command;

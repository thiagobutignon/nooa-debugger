export async function launchBunTarget(command: string[]): Promise<{
  pid: number;
  command: string[];
  ws_url?: string;
}> {
  if (command[0] !== "bun") {
    throw new Error("runtime.unsupported_operation");
  }

  const withInspect =
    command.includes("--inspect") || command.includes("--inspect-brk")
      ? command
      : ["bun", "--inspect", ...command.slice(1)];

  const proc = Bun.spawn(withInspect, {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  return {
    pid: proc.pid,
    command: withInspect,
  };
}

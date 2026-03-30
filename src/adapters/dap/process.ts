import { spawn, type ChildProcess } from "node:child_process";
import { createStdioDapTransport, type DapTransport } from "./stdio";

type SpawnDapProcessOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type SpawnedDapProcess = {
  pid: number | undefined;
  transport: DapTransport;
  stderr(): string;
  waitForExit(): Promise<number>;
  kill(signal?: NodeJS.Signals | number): void;
};

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 0));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function spawnDapProcess(options: SpawnDapProcessOptions): SpawnedDapProcess {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const exited = waitForExit(child);
  let stderr = "";

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string | Buffer) => {
    stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  });

  const transport = createStdioDapTransport({
    stdin: child.stdin as NodeJS.WritableStream,
    stdout: child.stdout as NodeJS.ReadableStream,
    close: async () => {
      if (!child.stdin?.destroyed) {
        child.stdin?.end();
      }

      await Promise.race([exited, delay(200)]);

      if (child.exitCode === null && !child.killed) {
        child.kill();
      }

      await exited.catch(() => {});
    },
  });

  return {
    pid: child.pid,
    transport,
    stderr() {
      return stderr;
    },
    waitForExit() {
      return exited;
    },
    kill(signal) {
      child.kill(signal);
    },
  };
}

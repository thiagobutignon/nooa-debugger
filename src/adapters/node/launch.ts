const NODE_INSPECTOR_URL_PATTERN = /ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/;

type SpawnedNodeProcess = {
  pid: number;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: string | number): void;
  unref(): void;
};

type NodeSpawnFunction = (
  command: string[],
  options: { stdout: "ignore"; stderr: "pipe"; stdin: "ignore"; detached: true },
) => SpawnedNodeProcess;

type LaunchNodeTargetOptions = {
  breakOnStart?: boolean;
  timeoutMs?: number;
  spawn?: NodeSpawnFunction;
};

function runtimeError(message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = "transport.unreachable";
  return error;
}

function unsupportedRuntimeError(message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = "runtime.not_supported";
  return error;
}

function isNodeCommand(command: string[]): boolean {
  return command[0] === "node";
}

function injectInspectFlag(command: string[], options: LaunchNodeTargetOptions): string[] {
  const alreadyConfigured = command.some(
    (part) =>
      part.startsWith("--inspect")
      || part.startsWith("--inspect-brk")
      || part.startsWith("--inspect-wait"),
  );

  if (alreadyConfigured) {
    return command;
  }

  const inspectFlag = options.breakOnStart
    ? "--inspect-brk=127.0.0.1:0"
    : "--inspect=127.0.0.1:0";

  return [command[0]!, inspectFlag, ...command.slice(1)];
}

export function extractNodeInspectorUrl(stderr: string): string | undefined {
  return stderr.match(NODE_INSPECTOR_URL_PATTERN)?.[0];
}

async function readInspectorUrl(
  stderr: ReadableStream<Uint8Array> | null,
  exited: Promise<number>,
  timeoutMs: number,
): Promise<{ ws_url?: string; stderr_text: string }> {
  if (!stderr) {
    return { stderr_text: "" };
  }

  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let stderrText = "";

  const readLoop = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        return undefined;
      }

      stderrText += decoder.decode(value, { stream: true });
      const match = extractNodeInspectorUrl(stderrText);
      if (match) {
        return match;
      }
    }
  })();

  const wsUrl = await Promise.race<string | undefined>([
    readLoop,
    exited.then(() => undefined),
    Bun.sleep(timeoutMs).then(() => undefined),
  ]);

  await reader.cancel().catch(() => {});

  return {
    ws_url: wsUrl,
    stderr_text: stderrText,
  };
}

export async function launchNodeTarget(
  command: string[],
  options: LaunchNodeTargetOptions = {},
): Promise<{
  pid: number;
  command: string[];
  ws_url: string;
  stderr_text: string;
}> {
  if (command.length === 0 || !isNodeCommand(command)) {
    throw unsupportedRuntimeError("runtime.not_supported: launch command must start with node");
  }

  const withInspect = injectInspectFlag(command, options);
  const spawn = options.spawn ?? ((nextCommand) => Bun.spawn(nextCommand, {
    detached: true,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  }) as unknown as SpawnedNodeProcess);

  const proc = spawn(withInspect, {
    detached: true,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  const { ws_url, stderr_text } = await readInspectorUrl(
    proc.stderr,
    proc.exited,
    options.timeoutMs ?? 2_000,
  );

  if (!ws_url) {
    proc.kill();
    throw runtimeError(
      `transport.unreachable: ${stderr_text.trim() || "runtime.attach_failed: inspector url not detected"}`,
    );
  }

  proc.unref();

  return {
    pid: proc.pid,
    command: withInspect,
    ws_url,
    stderr_text,
  };
}

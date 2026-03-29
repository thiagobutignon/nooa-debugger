const WS_URL_PATTERN = /ws:\/\/[^\s]+/;

type LaunchBunTargetOptions = {
  breakOnStart?: boolean;
};

function injectInspectFlag(command: string[], options: LaunchBunTargetOptions): string[] {
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

  return ["bun", inspectFlag, ...command.slice(1)];
}

async function readInspectorUrl(
  stderr: ReadableStream<Uint8Array> | null,
  exited: Promise<number>,
  timeoutMs = 2_000,
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
      const match = stderrText.match(WS_URL_PATTERN);
      if (match) {
        return match[0];
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

export async function launchBunTarget(
  command: string[],
  options: LaunchBunTargetOptions = {},
): Promise<{
  pid: number;
  command: string[];
  ws_url: string;
  stderr_text: string;
}> {
  if (command[0] !== "bun") {
    throw new Error("runtime.unsupported_operation");
  }

  const withInspect = injectInspectFlag(command, options);

  const proc = Bun.spawn(withInspect, {
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  const { ws_url, stderr_text } = await readInspectorUrl(proc.stderr, proc.exited);

  if (!ws_url) {
    if (!proc.killed) {
      proc.kill();
    }
    throw new Error(
      stderr_text.trim() || "runtime.attach_failed: inspector url not detected",
    );
  }

  return {
    pid: proc.pid,
    command: withInspect,
    ws_url,
    stderr_text,
  };
}

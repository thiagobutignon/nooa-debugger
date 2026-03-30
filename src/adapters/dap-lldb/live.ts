import { createDapRequest, isDapEvent, isDapResponse, type DapMessage } from "../dap/stdio";
import { spawnDapProcess, type SpawnedDapProcess } from "../dap/process";
import { createLldbFacade } from "./facade";
import type { DapEvent, DapTransport } from "./protocol";

type PendingRequest = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type PendingEvent = {
  predicate?: (event: DapEvent) => boolean;
  resolve: (event: DapEvent | undefined) => void;
};

type StartLldbDapSessionOptions = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type LiveLldbSession = ReturnType<typeof createLldbFacade> & {
  pid: number | undefined;
  stderr(): string;
  waitForExit(): Promise<number>;
  kill(signal?: NodeJS.Signals | number): void;
};

function createLiveError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function readFailureMessage(message: Extract<DapMessage, { type: "response" }>, command: string): string {
  if (message.message) {
    return message.message;
  }

  const body = message.body as { error?: { format?: string; message?: string } } | undefined;
  if (body?.error?.format) {
    return body.error.format;
  }

  if (body?.error?.message) {
    return body.error.message;
  }

  return `LLDB request failed for ${command}`;
}

function toDapEvent(message: Extract<DapMessage, { type: "event" }>): DapEvent {
  return {
    event: message.event,
    body: (message.body as Record<string, unknown> | undefined) ?? undefined,
  };
}

function createLiveTransport(processHandle: SpawnedDapProcess): DapTransport {
  let sequence = 0;
  const requests = new Map<number, PendingRequest>();
  const events: DapEvent[] = [];
  const waiters: PendingEvent[] = [];

  const unsubscribe = processHandle.transport.onMessage((message) => {
    if (isDapResponse(message)) {
      const pending = requests.get(message.request_seq);
      if (!pending) {
        return;
      }

      requests.delete(message.request_seq);

      if (!message.success) {
        pending.reject(
          createLiveError(
            "lldb.request_failed",
            readFailureMessage(message, pending.command),
          ),
        );
        return;
      }

      pending.resolve(message.body);
      return;
    }

    if (isDapEvent(message)) {
      const event = toDapEvent(message);
      const index = waiters.findIndex((candidate) => !candidate.predicate || candidate.predicate(event));
      if (index >= 0) {
        const waiter = waiters.splice(index, 1)[0];
        waiter?.resolve(event);
        return;
      }

      events.push(event);
    }
  });

  async function request<TResponse = unknown>(
    command: string,
    arguments_?: Record<string, unknown>,
  ): Promise<TResponse> {
    const seq = ++sequence;

    return new Promise<TResponse>((resolve, reject) => {
      requests.set(seq, {
        command,
        resolve: (value) => resolve(value as TResponse),
        reject,
      });

      Promise.resolve(processHandle.transport.send(createDapRequest(seq, command, arguments_))).catch((error) => {
        requests.delete(seq);
        reject(
          createLiveError(
            "lldb.transport_error",
            error instanceof Error ? error.message : `Failed to send LLDB request ${command}`,
          ),
        );
      });
    });
  }

  async function nextEvent(predicate?: (event: DapEvent) => boolean): Promise<DapEvent | undefined> {
    const index = events.findIndex((event) => !predicate || predicate(event));
    if (index >= 0) {
      return events.splice(index, 1)[0];
    }

    return new Promise<DapEvent | undefined>((resolve) => {
      waiters.push({ predicate, resolve });
    });
  }

  return {
    request,
    nextEvent,
    async close() {
      unsubscribe();

      for (const pending of requests.values()) {
        pending.reject(createLiveError("lldb.closed", "LLDB transport closed"));
      }
      requests.clear();

      while (waiters.length > 0) {
        waiters.shift()?.resolve(undefined);
      }

      await processHandle.transport.close();
    },
  };
}

export function startLldbDapSession(options: StartLldbDapSessionOptions = {}): LiveLldbSession {
  const processHandle = spawnDapProcess({
    command: options.command ?? "/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap",
    args: options.args,
    cwd: options.cwd,
    env: options.env,
  });
  const transport = createLiveTransport(processHandle);
  const facade = createLldbFacade(transport);

  return {
    ...facade,
    pid: processHandle.pid,
    stderr() {
      return processHandle.stderr();
    },
    waitForExit() {
      return processHandle.waitForExit();
    },
    kill(signal) {
      processHandle.kill(signal);
    },
    async close() {
      await facade.close();
      await processHandle.waitForExit().catch(() => {});
    },
  };
}

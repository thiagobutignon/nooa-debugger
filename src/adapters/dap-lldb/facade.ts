import {
  buildAttachArguments,
  buildInitializeArguments,
  buildLaunchArguments,
  describeCapabilities,
  normalizeStackFrame,
  normalizeVariable,
  type LldbAttachInput,
  type LldbEvalResult,
  type LldbLaunchInput,
  type LldbPausedSnapshot,
  type LldbRunningState,
  type LldbSessionDescriptor,
  type LldbStackResult,
  type LldbStateResult,
  type LldbVarsResult,
} from "./mappers";
import type { DapEvent, DapTransport } from "./protocol";

function lldbError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function readThreadId(event: DapEvent | undefined): number {
  return Number(event?.body?.threadId ?? 0);
}

function readReason(event: DapEvent | undefined): string | undefined {
  const reason = event?.body?.reason;
  return typeof reason === "string" ? reason : undefined;
}

function buildSnapshot(input: {
  event: DapEvent;
  threadId: number;
  stackTrace: { stackFrames?: Array<Record<string, unknown>> };
  scopes: { scopes?: Array<Record<string, unknown>> };
  variables: Array<{ variables?: Array<Record<string, unknown>> }>;
}): LldbPausedSnapshot {
  const frames = (input.stackTrace.stackFrames ?? []).map((frame) => normalizeStackFrame(frame));
  const locals = input.variables.flatMap((response) =>
    (response.variables ?? []).map((variable) => normalizeVariable(variable)),
  );

  return {
    state: "paused",
    reason: readReason(input.event),
    threadId: input.threadId,
    frames,
    locals,
  };
}

async function readPausedSnapshot(
  transport: DapTransport,
  event: DapEvent,
): Promise<LldbPausedSnapshot> {
  const threadId = readThreadId(event);
  const stackTrace = await transport.request<{ stackFrames?: Array<Record<string, unknown>> }>(
    "stackTrace",
    {
      threadId,
      startFrame: 0,
      levels: 20,
    },
  );

  const frameId = Number(stackTrace.stackFrames?.[0]?.id ?? 0);
  const scopes = frameId
    ? await transport.request<{ scopes?: Array<Record<string, unknown>> }>("scopes", {
        frameId,
      })
    : { scopes: [] };

  const variables = await Promise.all(
    (scopes.scopes ?? []).filter((scope) => Number(scope.variablesReference ?? 0) > 0).map(
      (scope) =>
        transport.request<{ variables?: Array<Record<string, unknown>> }>("variables", {
          variablesReference: Number(scope.variablesReference ?? 0),
        }),
    ),
  );

  return buildSnapshot({
    event,
    threadId,
    stackTrace,
    scopes,
    variables,
  });
}

export function createLldbFacade(transport: DapTransport) {
  let lastState: LldbPausedSnapshot | LldbRunningState | undefined;
  let initializedCapabilities: LldbSessionDescriptor["capabilities"] | undefined;

  async function initialize(): Promise<LldbSessionDescriptor["capabilities"]> {
    const response = await transport.request<{
      supportsConfigurationDoneRequest?: boolean;
      supportsEvaluateForHovers?: boolean;
      supportsSetVariable?: boolean;
      supportsStepBack?: boolean;
    }>("initialize", buildInitializeArguments());

    const capabilities = describeCapabilities(response);
    initializedCapabilities = capabilities;
    return capabilities;
  }

  async function start(kind: "launch" | "attach", request: Record<string, unknown>) {
    const capabilities = await initialize();
    await transport.request(kind, request);
    await transport.request("configurationDone", {});

    return {
      kind,
      request,
      capabilities,
    } satisfies LldbSessionDescriptor;
  }

  async function readStoppedState(command: "pause" | "continue", request: Record<string, unknown>) {
    await transport.request(command, request);
    const event = await transport.nextEvent((candidate) => candidate.event === "stopped");

    if (!event) {
      lastState = {
        state: "running",
        threads: [],
      };
      return lastState;
    }

    const snapshot = await readPausedSnapshot(transport, event);
    lastState = snapshot;
    return snapshot;
  }

  return {
    async launch(input: LldbLaunchInput) {
      return start("launch", buildLaunchArguments(input));
    },

    async attach(input: LldbAttachInput) {
      return start("attach", buildAttachArguments(input));
    },

    async pause(options: { threadId?: number } = {}) {
      return readStoppedState("pause", options.threadId ? { threadId: options.threadId } : {});
    },

    async continue(options: { threadId?: number } = {}) {
      return readStoppedState("continue", options.threadId ? { threadId: options.threadId } : {});
    },

    async state(): Promise<LldbStateResult> {
      if (lastState?.state === "paused") {
        return lastState;
      }

      const response = await transport.request<{ threads?: Array<Record<string, unknown>> }>(
        "threads",
        {},
      );

      const running: LldbRunningState = {
        state: "running",
        threads: (response.threads ?? []).map((thread) => ({
          id: Number(thread.id ?? 0),
          name: typeof thread.name === "string" ? thread.name : undefined,
        })),
      };

      lastState = running;
      return running;
    },

    async stack(): Promise<LldbStackResult> {
      if (lastState?.state !== "paused") {
        throw lldbError("lldb.invalid_state", "LLDB stack requires a paused snapshot");
      }

      return {
        threadId: lastState.threadId,
        frames: lastState.frames,
      };
    },

    async vars(): Promise<LldbVarsResult> {
      if (lastState?.state !== "paused") {
        throw lldbError("lldb.invalid_state", "LLDB vars requires a paused snapshot");
      }

      return {
        frameId: lastState.frames[0]?.id ?? 0,
        locals: lastState.locals,
      };
    },

    async eval(options: { expression: string; frameId?: number }): Promise<LldbEvalResult> {
      if (lastState?.state !== "paused") {
        throw lldbError("lldb.invalid_state", "LLDB eval requires a paused snapshot");
      }

      const frameId = options.frameId ?? lastState.frames[0]?.id ?? 0;
      const response = await transport.request<{
        result?: string;
        type?: string;
        variablesReference?: number;
      }>("evaluate", {
        frameId,
        expression: options.expression,
      });

      return {
        frameId,
        expression: options.expression,
        result: response.result ?? "",
        type: response.type,
        variablesReference: response.variablesReference,
      };
    },

    async close() {
      await transport.close();
    },

    get capabilities(): LldbSessionDescriptor["capabilities"] | undefined {
      return initializedCapabilities;
    },
  };
}


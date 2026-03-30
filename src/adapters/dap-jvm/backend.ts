import { summarizeJvmCapabilities, toJvmPausedSnapshot, toJvmRunningState, toJvmCapabilitySummary } from "./mapping";
import type { FakeDapTransport } from "./fake-transport";
import type {
  DapRequest,
  DapResponse,
  JvmAttachRequest,
  JvmCapabilitySummary,
  JvmCommandEntry,
  JvmContinueRequest,
  JvmEvalRequest,
  JvmLaunchRequest,
  JvmOperationResult,
  JvmPauseRequest,
  JvmPausedSnapshot,
  JvmRunningState,
  JvmVarsRequest,
} from "./types";

type BackendOptions = {
  transport: FakeDapTransport;
};

type InitializeResponse = DapResponse<{
  capabilities?: Record<string, boolean | undefined>;
}>;

type StackTraceResponse = DapResponse<{
  stackFrames?: Array<{
    id: number;
    name: string;
    sourcePath: string;
    line: number;
    column: number;
  }>;
}>;

type ScopesResponse = DapResponse<{
  scopes?: Array<{ name: string; variablesReference: number }>;
}>;

type VariablesResponse = DapResponse<{
  variables?: Array<{
    name: string;
    value: string;
    type?: string;
    variablesReference?: number;
  }>;
}>;

type EvaluateResponse = DapResponse<{
  result?: string;
  type?: string;
  variablesReference?: number;
}>;

function makeRequest(seq: number, command: string, arguments_?: Record<string, unknown>): DapRequest {
  return {
    seq,
    type: "request",
    command,
    arguments: arguments_,
  };
}

function defaultCapabilities(): JvmCapabilitySummary {
  return summarizeJvmCapabilities({
    supportsConfigurationDoneRequest: true,
    supportsEvaluateForHovers: true,
    supportsSetVariable: true,
  });
}

export function createJvmBackendFacade({ transport }: BackendOptions) {
  let nextSeq = 1;
  let currentSnapshot: JvmPausedSnapshot | undefined;
  let currentCapabilities = defaultCapabilities();

  async function issue<TBody = Record<string, unknown>>(
    command: string,
    arguments_?: Record<string, unknown>,
  ): Promise<{ request: DapRequest; response: DapResponse<TBody> }> {
    const request = makeRequest(nextSeq++, command, arguments_);
    const response = await transport.send<TBody>(request);
    return { request, response };
  }

  function collectCommands(entries: Array<{ request: DapRequest; response: DapResponse }>): JvmCommandEntry[] {
    return entries.map((entry) => ({
      request: entry.request,
      response: entry.response,
    }));
  }

  function currentState(): JvmPausedSnapshot | JvmRunningState {
    return currentSnapshot ?? toJvmRunningState();
  }

  async function configureSession(
    mode: "launch" | "attach",
    payload: Record<string, unknown>,
  ): Promise<JvmOperationResult> {
    const commands: Array<{ request: DapRequest; response: DapResponse }> = [];

    commands.push(await issue<InitializeResponse["body"]>("initialize", {
      adapterID: "jvm",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
    }));
    commands.push(await issue(mode, payload));
    commands.push(await issue("configurationDone"));

    const initialize = commands[0].response as InitializeResponse;
    currentCapabilities = toJvmCapabilitySummary(initialize.body?.capabilities ?? {});
    currentSnapshot = undefined;

    return {
      endpoint: {
        transport: "dap",
        adapter: "dap-jvm",
        mode,
      },
      capabilities: currentCapabilities,
      commands: collectCommands(commands),
    };
  }

  function readFrames(response: StackTraceResponse): Array<{
    id: number;
    name: string;
    sourcePath: string;
    line: number;
    column: number;
  }> {
    return response.body?.stackFrames ?? [];
  }

  function readScopes(response: ScopesResponse): Array<{ name: string; variablesReference: number }> {
    return response.body?.scopes ?? [];
  }

  function readVariables(response: VariablesResponse): Array<{
    name: string;
    value: string;
    type?: string;
    variablesReference?: number;
  }> {
    return response.body?.variables ?? [];
  }

  return {
    async launch(request: JvmLaunchRequest): Promise<JvmOperationResult> {
      return configureSession("launch", {
        mainClass: request.mainClass,
        classPath: request.classPath,
        args: request.args,
        vmArgs: request.vmArgs,
        stopOnEntry: request.stopOnEntry,
        sourcePaths: request.sourcePaths,
        projectRoot: request.projectRoot,
        modulePath: request.modulePath,
        env: request.env,
      });
    },

    async attach(request: JvmAttachRequest): Promise<JvmOperationResult> {
      return configureSession("attach", {
        host: request.host,
        port: request.port,
        sourcePaths: request.sourcePaths,
        projectRoot: request.projectRoot,
      });
    },

    async pause(request: JvmPauseRequest): Promise<JvmPausedSnapshot> {
      await issue("pause", {
        threadId: request.threadId,
      });
      const stackTrace = await issue<StackTraceResponse["body"]>("stackTrace", {
        threadId: request.threadId,
      });

      const frames = readFrames(stackTrace.response as StackTraceResponse);
      const topFrame = frames[0];
      const scopes = await issue<ScopesResponse["body"]>("scopes", {
        frameId: topFrame?.id,
      });

      const firstScope = readScopes(scopes.response as ScopesResponse)[0];
      const variables = await issue<VariablesResponse["body"]>("variables", {
        variablesReference: firstScope?.variablesReference,
      });

      currentSnapshot = toJvmPausedSnapshot({
        reason: "pause",
        threadId: request.threadId,
        frames,
        locals: readVariables(variables.response as VariablesResponse),
      });

      return currentSnapshot;
    },

    async continue(request: JvmContinueRequest): Promise<JvmRunningState> {
      await issue("continue", {
        threadId: request.threadId,
      });
      currentSnapshot = undefined;
      return toJvmRunningState();
    },

    async state(): Promise<JvmPausedSnapshot | JvmRunningState> {
      return currentState();
    },

    async stack(): Promise<JvmPausedSnapshot> {
      if (!currentSnapshot) {
        throw new Error("session.invalid_state: JVM debug session must be paused");
      }

      const stackTrace = await issue<StackTraceResponse["body"]>("stackTrace", {
        threadId: currentSnapshot.selected_thread_id,
      });

      const frames = readFrames(stackTrace.response as StackTraceResponse);
      const mappedFrames = frames.map((frame, index) => ({
        frame_ref: `frame-${index}`,
        call_frame_id: frame.id,
        function_name: frame.name,
        location: {
          file: frame.sourcePath,
          line: frame.line,
          column: frame.column,
        },
      }));
      currentSnapshot = {
        ...currentSnapshot,
        frames: mappedFrames,
        top_frame: frames[0]
          ? {
              frame_ref: "frame-0",
              call_frame_id: frames[0].id,
              function_name: frames[0].name,
              location: {
                file: frames[0].sourcePath,
                line: frames[0].line,
                column: frames[0].column,
              },
            }
          : currentSnapshot.top_frame,
      };

      return currentSnapshot;
    },

    async vars(request: JvmVarsRequest): Promise<JvmPausedSnapshot> {
      if (!currentSnapshot) {
        throw new Error("session.invalid_state: JVM debug session must be paused");
      }

      const frame = currentSnapshot.frames.find((entry) => entry.frame_ref === request.frameRef);
      if (!frame) {
        throw new Error("refs.invalid: Unknown JVM frame ref");
      }

      const scopes = await issue<ScopesResponse["body"]>("scopes", {
        frameId: frame.call_frame_id,
      });
      const firstScope = readScopes(scopes.response as ScopesResponse)[0];
      const variables = await issue<VariablesResponse["body"]>("variables", {
        variablesReference: firstScope?.variablesReference,
      });

      currentSnapshot = {
        ...currentSnapshot,
        locals: readVariables(variables.response as VariablesResponse).map((local) => ({
          frame_ref: frame.frame_ref,
          name: local.name,
          value: local.value,
          type: local.type,
        })),
      };

      return currentSnapshot;
    },

    async eval(request: JvmEvalRequest) {
      if (!currentSnapshot) {
        throw new Error("session.invalid_state: JVM debug session must be paused");
      }

      const evaluation = await issue<EvaluateResponse["body"]>("evaluate", {
        expression: request.expression,
        frameId: currentSnapshot.top_frame.call_frame_id,
      });
      const body = evaluation.response.body ?? {};

      return {
        value: body.result ?? "",
        type: body.type,
      };
    },
  };
}

export type JvmBackendFacade = ReturnType<typeof createJvmBackendFacade>;

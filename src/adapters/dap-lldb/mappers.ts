type DapCapabilities = {
  supportsConfigurationDoneRequest?: boolean;
  supportsEvaluateForHovers?: boolean;
  supportsSetVariable?: boolean;
  supportsStepBack?: boolean;
};

export type LldbLaunchInput = {
  program: string;
  args?: string[];
  cwd?: string;
  stopOnEntry?: boolean;
  env?: Record<string, string>;
};

export type LldbAttachInput = {
  pid?: number;
  program?: string;
  cwd?: string;
  waitFor?: boolean;
};

export type LldbStackFrame = {
  id: number;
  name: string;
  source?: {
    path?: string;
    name?: string;
  };
  line: number;
  column?: number;
};

export type LldbVariable = {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
};

export type LldbPausedSnapshot = {
  state: "paused";
  reason?: string;
  threadId: number;
  frames: LldbStackFrame[];
  locals: LldbVariable[];
};

export type LldbRunningState = {
  state: "running";
  threads: Array<{ id: number; name?: string }>;
};

export type LldbStateResult = LldbPausedSnapshot | LldbRunningState;

export type LldbStackResult = {
  threadId: number;
  frames: LldbStackFrame[];
};

export type LldbVarsResult = {
  frameId: number;
  locals: LldbVariable[];
};

export type LldbEvalResult = {
  frameId: number;
  expression: string;
  result: string;
  type?: string;
  variablesReference?: number;
};

export type LldbSessionDescriptor = {
  kind: "launch" | "attach";
  request: Record<string, unknown>;
  capabilities: {
    supportsConfigurationDoneRequest: boolean;
    supportsEvaluateForHovers: boolean;
    supportsSetVariable: boolean;
    supportsStepBack: boolean;
    notes: string[];
  };
};

export function buildInitializeArguments(): Record<string, unknown> {
  return {
    adapterID: "lldb-dap",
    columnsStartAt1: true,
    linesStartAt1: true,
    pathFormat: "path",
    supportsRunInTerminalRequest: false,
    supportsVariablePaging: true,
    supportsVariableType: true,
  };
}

export function buildLaunchArguments(input: LldbLaunchInput): Record<string, unknown> {
  return {
    program: input.program,
    args: input.args ?? [],
    cwd: input.cwd,
    stopOnEntry: input.stopOnEntry ?? false,
    env: input.env,
  };
}

export function buildAttachArguments(input: LldbAttachInput): Record<string, unknown> {
  return {
    pid: input.pid,
    program: input.program,
    cwd: input.cwd,
    waitFor: input.waitFor ?? false,
  };
}

export function describeCapabilities(capabilities: DapCapabilities = {}): LldbSessionDescriptor["capabilities"] {
  return {
    supportsConfigurationDoneRequest: capabilities.supportsConfigurationDoneRequest ?? false,
    supportsEvaluateForHovers: capabilities.supportsEvaluateForHovers ?? false,
    supportsSetVariable: capabilities.supportsSetVariable ?? false,
    supportsStepBack: capabilities.supportsStepBack ?? false,
    notes: [
      "Swift frames and locals are mapped through DAP stackTrace, scopes, and variables without extra translation.",
      "Rust targets are supported as long as the build carries usable debug info; optimized locals may be missing or synthetic.",
      "Native targets inherit the same DAP mapping and typically expose source paths, stack frames, and locals directly.",
      "The client does not advertise runInTerminal support; launch and attach stay inside the adapter process.",
      "The base facade stays transport-injected; the live stdio launcher is layered separately.",
    ],
  };
}

export function normalizeStackFrame(frame: {
  id?: number;
  name?: string;
  source?: { path?: string; name?: string };
  line?: number;
  column?: number;
}): LldbStackFrame {
  return {
    id: Number(frame.id ?? 0),
    name: frame.name ?? "<anonymous>",
    source: frame.source
      ? {
          path: frame.source.path,
          name: frame.source.name,
        }
      : undefined,
    line: Number(frame.line ?? 0),
    column: frame.column,
  };
}

export function normalizeVariable(variable: {
  name?: string;
  value?: string;
  type?: string;
  variablesReference?: number;
}): LldbVariable {
  return {
    name: variable.name ?? "<anonymous>",
    value: variable.value ?? "",
    type: variable.type,
    variablesReference: Number(variable.variablesReference ?? 0),
  };
}

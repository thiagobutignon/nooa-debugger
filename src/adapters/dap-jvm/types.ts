export type DapCapabilitySet = {
  supportsConfigurationDoneRequest?: boolean;
  supportsEvaluateForHovers?: boolean;
  supportsSetVariable?: boolean;
};

export type DapRequest = {
  seq: number;
  type: "request";
  command: string;
  arguments?: Record<string, unknown>;
};

export type DapResponse<TBody = Record<string, unknown>> = {
  seq: number;
  type: "response";
  request_seq: number;
  success: boolean;
  command: string;
  body?: TBody;
  message?: string;
};

export type DapTranscriptEntry = {
  request: DapRequest;
  response: DapResponse;
};

export type DapStackFrame = {
  id: number;
  name: string;
  sourcePath: string;
  line: number;
  column: number;
};

export type DapScope = {
  name: string;
  variablesReference: number;
};

export type DapVariable = {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
};

export type DapEvaluation = {
  result: string;
  type?: string;
  variablesReference?: number;
};

export type JvmLaunchRequest = {
  mainClass: string;
  classPath: string[];
  args?: string[];
  vmArgs?: string[];
  stopOnEntry?: boolean;
  sourcePaths?: string[];
  projectRoot?: string;
  modulePath?: string[];
  env?: Record<string, string>;
};

export type JvmAttachRequest = {
  host: string;
  port: number;
  sourcePaths?: string[];
  projectRoot?: string;
};

export type JvmPauseRequest = {
  threadId?: number;
};

export type JvmContinueRequest = {
  threadId?: number;
};

export type JvmVarsRequest = {
  frameRef: string;
};

export type JvmEvalRequest = {
  expression: string;
};

export type JvmFrame = {
  frame_ref: string;
  call_frame_id?: number;
  function_name?: string;
  location: {
    file: string;
    line: number;
    column: number;
  };
};

export type JvmLocal = {
  frame_ref: string;
  name: string;
  value: string;
  type?: string;
};

export type JvmPausedSnapshot = {
  state: "paused";
  reason?: string;
  selected_thread_id?: number;
  top_frame: JvmFrame;
  frames: JvmFrame[];
  locals: JvmLocal[];
};

export type JvmRunningState = {
  state: "running";
};

export type JvmCapabilitySummary = {
  launch: true;
  attach: true;
  pause: true;
  continue: true;
  state: true;
  stack: true;
  vars: true;
  evaluate: boolean;
  notes: string[];
  dap: DapCapabilitySet;
};

export type JvmEndpoint = {
  transport: "dap";
  adapter: "dap-jvm";
  mode: "launch" | "attach";
};

export type JvmCommandEntry = {
  request: DapRequest;
  response: DapResponse;
};

export type JvmOperationResult = {
  endpoint: JvmEndpoint;
  capabilities: JvmCapabilitySummary;
  commands: JvmCommandEntry[];
};

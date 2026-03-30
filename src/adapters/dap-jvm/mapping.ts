import type {
  DapCapabilitySet,
  DapScope,
  DapStackFrame,
  DapVariable,
  JvmCapabilitySummary,
  JvmFrame,
  JvmLocal,
  JvmPausedSnapshot,
} from "./types";

function normalizeSourcePath(sourcePath: string | undefined): string {
  return sourcePath ?? "<unknown>";
}

function toFrameRef(index: number): string {
  return `frame-${index}`;
}

function mapFrame(frame: DapStackFrame, index: number): JvmFrame {
  return {
    frame_ref: toFrameRef(index),
    call_frame_id: frame.id,
    function_name: frame.name,
    location: {
      file: normalizeSourcePath(frame.sourcePath),
      line: frame.line,
      column: frame.column,
    },
  };
}

function mapLocals(locals: DapVariable[], frameRef: string): JvmLocal[] {
  return locals.map((local) => ({
    frame_ref: frameRef,
    name: local.name,
    value: local.value,
    type: local.type,
  }));
}

export function toJvmCapabilitySummary(capabilities: DapCapabilitySet): JvmCapabilitySummary {
  return {
    launch: true,
    attach: true,
    pause: true,
    continue: true,
    state: true,
    stack: true,
    vars: true,
    evaluate: Boolean(
      capabilities.supportsEvaluateForHovers
      || capabilities.supportsSetVariable
      || capabilities.supportsConfigurationDoneRequest,
    ),
    notes: [
      "Java and Kotlin share the same DAP surface.",
      "Stack and variable inspection require a paused thread.",
      "This slice is contract-first and does not bundle a local JVM launcher.",
    ],
    dap: capabilities,
  };
}

export function toJvmPausedSnapshot(input: {
  reason?: string;
  threadId?: number;
  frames: DapStackFrame[];
  locals: DapVariable[];
}): JvmPausedSnapshot {
  const frames = input.frames.map(mapFrame);
  const topFrame = frames[0] ?? {
    frame_ref: toFrameRef(0),
    location: {
      file: "<unknown>",
      line: 1,
      column: 1,
    },
  };

  return {
    state: "paused",
    reason: input.reason,
    selected_thread_id: input.threadId,
    top_frame: topFrame,
    frames,
    locals: mapLocals(input.locals, topFrame.frame_ref),
  };
}

export function toJvmRunningState(): { state: "running" } {
  return { state: "running" };
}

export function summarizeJvmCapabilities(capabilities: DapCapabilitySet): JvmCapabilitySummary {
  return toJvmCapabilitySummary(capabilities);
}

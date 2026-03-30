export type SessionState =
  | "created"
  | "running"
  | "paused"
  | "exited"
  | "transport_lost";

export type SessionBridgeHint = {
  host: string;
  port: number;
  token: string;
  bridge_pid?: number;
};

export type SessionLocation = {
  file: string;
  line: number;
  column?: number;
};

export type SessionBreakpoint = {
  breakpoint_id: string;
  file: string;
  line: number;
  engine_breakpoint_id?: string;
};

export type SessionFrame = {
  frame_ref: string;
  call_frame_id?: string;
  function_name?: string;
  location: SessionLocation;
};

export type SessionLocal = {
  frame_ref: string;
  name: string;
  value: string;
  type?: string;
  value_ref?: string;
  object_id?: string;
};

export type PausedSnapshotRecord = {
  paused_ref: string;
  captured_at: string;
  reason?: string;
  location: SessionLocation;
  hit_breakpoints?: string[];
  frames: SessionFrame[];
  locals: SessionLocal[];
  exception?: {
    text?: string;
    value?: string;
  };
  selected_target?: {
    pid?: number;
  };
};

export type SessionRecord = {
  schema_version: 1;
  session_id: string;
  adapter: "bun" | "node";
  runtime: "bun" | "node";
  state: SessionState;
  root_command: string[];
  root_pid?: number;
  target_pid?: number;
  transport_hint?: {
    ws_url?: string;
    host?: string;
    port?: number;
    waiting_for_debugger?: boolean;
    bridge?: SessionBridgeHint;
  };
  breakpoints: SessionBreakpoint[];
  paused_snapshot?: PausedSnapshotRecord;
  current_investigation_id?: string;
  last_known_state?: { reason: string; updated_at: string };
  created_at: string;
  updated_at: string;
};

export type InvestigationRecord = {
  schema_version: 1;
  investigation_id: string;
  session_id?: string;
  created_at: string;
  updated_at: string;
  status: "open" | "closed";
};

export type InvestigationEvent = {
  type: string;
  created_at: string;
  session_id?: string;
  artifact_id?: string;
  data?: Record<string, unknown>;
};

export type ArtifactKind =
  | "session_event"
  | "debug_snapshot"
  | "trace_capture"
  | "profile_capture";

export type ArtifactRecord = {
  schema_version: 1;
  artifact_id: string;
  investigation_id?: string;
  session_id?: string;
  kind: ArtifactKind;
  created_at: string;
  data: Record<string, unknown>;
  blob_ids?: string[];
};

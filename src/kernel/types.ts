export type SessionState =
  | "created"
  | "running"
  | "paused"
  | "exited"
  | "transport_lost";

export type SessionRecord = {
  schema_version: 1;
  session_id: string;
  adapter: "bun";
  runtime: "bun";
  state: SessionState;
  root_command: string[];
  root_pid?: number;
  target_pid?: number;
  transport_hint?: { ws_url?: string; port?: number };
  breakpoints: Array<{ breakpoint_id: string; file: string; line: number }>;
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

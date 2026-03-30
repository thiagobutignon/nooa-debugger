import type { BunBreakpointLocation, BunPausedSnapshot } from "../adapters/bun/session";
import type { NodeBreakpointLocation, NodePausedSnapshot } from "../adapters/node/session";
import type { SessionBridgeHint } from "../kernel/types";

type BridgePausedSnapshot = BunPausedSnapshot | NodePausedSnapshot;
type BridgeBreakpointLocation = BunBreakpointLocation | NodeBreakpointLocation;

export type BridgeReadyFile = SessionBridgeHint & {
  error?: string;
};

export type BridgeRequest =
  | { token: string; action: "ping" }
  | { token: string; action: "status" }
  | { token: string; action: "release_waiting_for_debugger" }
  | { token: string; action: "pause"; timeout_ms?: number }
  | { token: string; action: "wait_for_pause"; timeout_ms?: number }
  | { token: string; action: "resume_and_wait"; timeout_ms?: number }
  | { token: string; action: "set_breakpoint"; file: string; line: number }
  | { token: string; action: "evaluate"; expression: string }
  | { token: string; action: "shutdown" };

export type BridgeOk<T> = {
  ok: true;
  data: T;
};

export type BridgeError = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type BridgeResponse<T = unknown> = BridgeOk<T> | BridgeError;

export type BridgePauseResult =
  | { state: "running" }
  | { state: "paused"; snapshot: BridgePausedSnapshot };

export type BridgeStatusResult = {
  healthy: boolean;
  target_alive: boolean;
  state: "running" | "paused" | "closed";
  snapshot?: BridgePausedSnapshot;
};

export type BridgeBreakpointResult = {
  breakpointId?: string;
  locations: BridgeBreakpointLocation[];
};

export type BridgeEvaluationResult = {
  result: any;
};

import { fileURLToPath } from "node:url";
import { createBunSession, type BunPausedSnapshot } from "../../adapters/bun/session";
import { launchBunTarget } from "../../adapters/bun/launch";
import { createBridgeClient, startSessionBridge, type BridgeClient } from "../../bridge/client";
import { jsonError, jsonSuccess, type JsonFailure, type JsonSuccess } from "../../core/errors";
import { createArtifactStore } from "../../kernel/artifacts/store";
import { getBackendCatalog } from "../../kernel/backends";
import { createId } from "../../kernel/ids";
import { createInvestigationStore } from "../../kernel/investigations/store";
import { createSessionStore } from "../../kernel/sessions/store";
import type { PausedSnapshotRecord, SessionBridgeHint, SessionRecord } from "../../kernel/types";

function isProcessAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPauseTimeoutError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("Timed out waiting for Debugger.paused")
    || (error as Error & { code?: string }).code === "bridge.pause_timeout"
  );
}

type DebugRuntimeClient = Awaited<ReturnType<typeof createBunSession>> | BridgeClient;
type DebugDaemonStatus = {
  running: boolean;
  pid?: number;
  host?: string;
  port?: number;
};

function stores(root: string) {
  return {
    sessions: createSessionStore(root),
    investigations: createInvestigationStore(root),
    artifacts: createArtifactStore(root),
  };
}

function daemonStatusFromBridge(
  bridge: SessionBridgeHint | undefined,
  running: boolean,
): DebugDaemonStatus {
  if (!bridge) {
    return { running };
  }

  return {
    running,
    pid: bridge.bridge_pid,
    host: bridge.host,
    port: bridge.port,
  };
}

async function resolveDaemonStatus(session: SessionRecord): Promise<DebugDaemonStatus | undefined> {
  const bridge = session.transport_hint?.bridge;
  if (!bridge) {
    return undefined;
  }

  try {
    const status = await createBridgeClient(bridge).status();
    return daemonStatusFromBridge(bridge, status.healthy);
  } catch {
    return daemonStatusFromBridge(bridge, false);
  }
}

async function rehydratePausedSnapshotFromBridge(
  sessions: ReturnType<typeof createSessionStore>,
  session: SessionRecord,
): Promise<SessionRecord> {
  if (session.state !== "paused" || session.paused_snapshot || !session.transport_hint?.bridge) {
    return session;
  }

  try {
    const status = await createBridgeClient(session.transport_hint.bridge).status();
    if (!status.target_alive) {
      return markExited(sessions, session, "target_exited");
    }

    if (status.state === "paused" && status.snapshot) {
      return sessions.put({
        ...session,
        state: "paused",
        paused_snapshot: toPausedSnapshotRecord(status.snapshot, session.target_pid),
        last_known_state: {
          reason: "paused_rehydrated_from_bridge",
          updated_at: new Date().toISOString(),
        },
      });
    }

    if (status.state === "running") {
      return sessions.put({
        ...session,
        state: "running",
        paused_snapshot: undefined,
        last_known_state: {
          reason: "bridge_reports_running",
          updated_at: new Date().toISOString(),
        },
      });
    }

    return session;
  } catch {
    return session;
  }
}

function sessionFailure(
  code: string,
  message: string,
  session: SessionRecord,
  recoverable = false,
): JsonFailure {
  return jsonError(code, message, {
    recoverable,
    session_id: session.session_id,
    investigation_id: session.current_investigation_id,
  });
}

async function resolveSession(
  sessions: ReturnType<typeof createSessionStore>,
  sessionId: string | undefined,
): Promise<SessionRecord | JsonFailure> {
  if (!sessionId) {
    return jsonError("session.not_found", "Missing session id", {
      recoverable: true,
    });
  }

  const session = await sessions.get(sessionId);
  if (!session) {
    return jsonError("session.not_found", "Session not found", {
      recoverable: false,
      session_id: sessionId,
    });
  }

  return session;
}

function parseLaunchArgs(args: string[]): { command: string[]; breakOnStart: boolean } {
  const delimiterIndex = args.indexOf("--");
  const command = delimiterIndex >= 0 ? args.slice(delimiterIndex + 1) : [];
  const options = delimiterIndex >= 0 ? args.slice(2, delimiterIndex) : args.slice(2);

  return {
    command,
    breakOnStart: options.includes("--brk"),
  };
}

function parseBreakpointLocation(raw: string | undefined): { file: string; line: number } | undefined {
  if (!raw) return undefined;

  const match = raw.match(/^(.*):(\d+)$/);
  if (!match) {
    return undefined;
  }

  return {
    file: normalizeFilePath(match[1]),
    line: Number(match[2]),
  };
}

function normalizeFilePath(value: string): string {
  if (!value.startsWith("file://")) {
    return value;
  }

  return fileURLToPath(value);
}

function stringifyRuntimeValue(value: {
  value?: unknown;
  description?: string;
  unserializableValue?: string;
  type?: string;
} | undefined): string {
  if (!value) {
    return "";
  }

  if (value.unserializableValue !== undefined) {
    return value.unserializableValue;
  }

  if (value.value === undefined) {
    if (value.type === "undefined") return "undefined";
    if (value.type === "null") return "null";
    return value.description ?? "";
  }

  if (value.value === null) {
    return "null";
  }

  switch (typeof value.value) {
    case "string":
      return value.value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value.value);
    default:
      return value.description ?? JSON.stringify(value.value);
  }
}

function isWaitingForDebuggerStartupPause(
  session: SessionRecord,
  snapshot: BunPausedSnapshot,
): boolean {
  if (snapshot.reason === "Break on start") {
    return true;
  }

  const targetFile = normalizeFilePath(session.root_command.at(-1) ?? "");
  const pausedFile = normalizeFilePath(snapshot.topFrame.location.file ?? "");

  return Boolean(targetFile)
    && pausedFile === targetFile
    && snapshot.topFrame.location.line <= 1;
}

function toPausedSnapshotRecord(
  snapshot: BunPausedSnapshot,
  targetPid?: number,
): PausedSnapshotRecord {
  const frames = snapshot.rawCallFrames.map((frame, index) => ({
    frame_ref: `@f${index}`,
    call_frame_id: frame.callFrameId,
    function_name: frame.functionName,
    location: {
      file: normalizeFilePath(
        frame.url ?? frame.location?.url ?? snapshot.topFrame.location.file ?? "<unknown>",
      ),
      line: (frame.location?.lineNumber ?? -1) + 1,
      column: (frame.location?.columnNumber ?? 0) + 1,
    },
  }));

  return {
    paused_ref: createId("pause"),
    captured_at: new Date().toISOString(),
    reason: snapshot.reason,
    location: {
      file: normalizeFilePath(snapshot.topFrame.location.file ?? "<unknown>"),
      line: snapshot.topFrame.location.line,
      column: snapshot.topFrame.location.column,
    },
    frames,
    locals: snapshot.locals.map((local) => ({
      frame_ref: "@f0",
      name: local.name,
      value: local.value,
      type: local.type,
      object_id: local.objectId,
    })),
    selected_target: {
      pid: targetPid,
    },
  };
}

async function recordInvestigationArtifact(
  investigations: ReturnType<typeof createInvestigationStore>,
  artifacts: ReturnType<typeof createArtifactStore>,
  session: SessionRecord,
  type: string,
  kind: "session_event" | "debug_snapshot",
  data: Record<string, unknown>,
): Promise<string | undefined> {
  if (!session.current_investigation_id) {
    return undefined;
  }

  const artifact = await artifacts.create({
    kind,
    investigation_id: session.current_investigation_id,
    session_id: session.session_id,
    data,
  });

  await investigations.appendEvent(session.current_investigation_id, {
    type,
    created_at: new Date().toISOString(),
    session_id: session.session_id,
    artifact_id: artifact.artifact_id,
    data,
  });

  return artifact.artifact_id;
}

async function reapplyPersistedBreakpoints(
  sessions: ReturnType<typeof createSessionStore>,
  session: SessionRecord,
  live: DebugRuntimeClient,
): Promise<SessionRecord> {
  if (session.breakpoints.length === 0) {
    return session;
  }

  const breakpoints = [];
  for (const breakpoint of session.breakpoints) {
    const rebound = await live.setBreakpoint(`${breakpoint.file}:${breakpoint.line}`);
    breakpoints.push({
      ...breakpoint,
      engine_breakpoint_id: rebound.breakpointId,
    });
  }

  return sessions.put({
    ...session,
    breakpoints,
    last_known_state: {
      reason: "breakpoints_rehydrated",
      updated_at: new Date().toISOString(),
    },
  });
}

async function markExited(
  sessions: ReturnType<typeof createSessionStore>,
  session: SessionRecord,
  reason: string,
): Promise<SessionRecord> {
  return sessions.put({
    ...session,
    state: "exited",
    paused_snapshot: undefined,
    last_known_state: {
      reason,
      updated_at: new Date().toISOString(),
    },
  });
}

async function markTransportLost(
  sessions: ReturnType<typeof createSessionStore>,
  session: SessionRecord,
  reason: string,
): Promise<SessionRecord> {
  return sessions.put({
    ...session,
    state: "transport_lost",
    last_known_state: {
      reason,
      updated_at: new Date().toISOString(),
    },
  });
}

async function connectLiveSession(
  sessions: ReturnType<typeof createSessionStore>,
  session: SessionRecord,
): Promise<
  | {
      session: SessionRecord;
      live: DebugRuntimeClient;
    }
  | {
      session: SessionRecord;
      error: JsonFailure;
    }
> {
  if (session.root_pid && !isProcessAlive(session.root_pid)) {
    const exited = await markExited(sessions, session, "target_exited");
    return {
      session: exited,
      error: sessionFailure("runtime.target_exited", "Debug target has exited", exited),
    };
  }

  const bridgeHint = session.transport_hint?.bridge;
  if (bridgeHint) {
    const live = createBridgeClient(bridgeHint);

    try {
      const status = await live.status();
      if (!status.target_alive) {
        const exited = await markExited(sessions, session, "target_exited");
        return {
          session: exited,
          error: sessionFailure("runtime.target_exited", "Debug target has exited", exited),
        };
      }

      if (!status.healthy) {
        const lost = await markTransportLost(sessions, session, "bridge_unhealthy");
        return {
          session: lost,
          error: sessionFailure(
            "session.transport_lost",
            "Debug bridge is reachable but its live transport is unhealthy",
            lost,
            true,
          ),
        };
      }
      return {
        session,
        live,
      };
    } catch (error) {
      const lost = await markTransportLost(sessions, session, "bridge_connect_failed");
      return {
        session: lost,
        error: sessionFailure(
          "session.transport_lost",
          error instanceof Error ? error.message : "Debug bridge could not be rehydrated",
          lost,
          true,
        ),
      };
    }
  }

  const wsUrl = session.transport_hint?.ws_url;
  if (!wsUrl) {
    const lost = await markTransportLost(sessions, session, "transport_hint_missing");
    return {
      session: lost,
      error: sessionFailure("session.transport_lost", "Debug transport could not be rehydrated", lost, true),
    };
  }

  try {
    return {
      session,
      live: await createBunSession(wsUrl),
    };
  } catch (error) {
    const lost = await markTransportLost(sessions, session, "transport_connect_failed");
    return {
      session: lost,
      error: sessionFailure(
        "session.transport_lost",
        error instanceof Error ? error.message : "Debug transport could not be rehydrated",
        lost,
        true,
      ),
    };
  }
}

function ensurePausedSnapshot(session: SessionRecord): PausedSnapshotRecord | JsonFailure {
  if (session.state === "exited") {
    return sessionFailure("runtime.target_exited", "Debug target has exited", session);
  }

  if (session.state !== "paused") {
    return sessionFailure("session.invalid_state", "Debug session must be paused", session);
  }

  if (!session.paused_snapshot) {
    return sessionFailure("session.stale_snapshot", "Paused snapshot is not available yet", session);
  }

  return session.paused_snapshot;
}

async function resolvePausedSnapshotRecord(
  sessions: ReturnType<typeof createSessionStore>,
  session: SessionRecord,
): Promise<
  | { session: SessionRecord; pausedSnapshot: PausedSnapshotRecord }
  | { session: SessionRecord; error: JsonFailure }
> {
  const refreshed = await rehydratePausedSnapshotFromBridge(sessions, session);
  const pausedSnapshotOrError = ensurePausedSnapshot(refreshed);
  if ("ok" in pausedSnapshotOrError) {
    return {
      session: refreshed,
      error: pausedSnapshotOrError,
    };
  }

  return {
    session: refreshed,
    pausedSnapshot: pausedSnapshotOrError,
  };
}

export async function runDebug(args: string[], cwd: string): Promise<JsonSuccess<unknown> | JsonFailure> {
  const action = args[1];
  const { sessions, investigations, artifacts } = stores(cwd);

  if (action === "backends") {
    return jsonSuccess({
      backends: getBackendCatalog(),
    });
  }

  if (action === "launch") {
    const { command, breakOnStart } = parseLaunchArgs(args);
    if (command.length === 0) {
      return jsonError("runtime.attach_failed", "Missing Bun command after --", {
        recoverable: true,
        suggested_next_commands: ["debug launch -- bun run path/to/file.ts"],
      });
    }
    if (command[0] !== "bun") {
      return jsonError("runtime.unsupported_operation", "Only Bun targets are supported in V1", {
        recoverable: false,
      });
    }

    const launched = await launchBunTarget(command, { breakOnStart });

    const investigation = await investigations.create({});
    let session = await sessions.create({
      adapter: "bun",
      runtime: "bun",
      state: "running",
      root_command: launched.command,
      root_pid: launched.pid,
      target_pid: launched.pid,
      transport_hint: {
        ws_url: launched.ws_url,
        waiting_for_debugger: breakOnStart,
      },
      current_investigation_id: investigation.investigation_id,
    });

    try {
      const bridge = await startSessionBridge({
        root: cwd,
        sessionId: session.session_id,
        wsUrl: launched.ws_url,
        targetPid: launched.pid,
      });

      session = await sessions.put({
        ...session,
        transport_hint: {
          ...session.transport_hint,
          bridge,
        },
      });
    } catch (error) {
      if (isProcessAlive(launched.pid)) {
        process.kill(launched.pid, "SIGTERM");
      }

      return jsonError(
        "runtime.attach_failed",
        error instanceof Error ? error.message : "Debug bridge failed to start",
        {
          recoverable: true,
          session_id: session.session_id,
          investigation_id: investigation.investigation_id,
        },
      );
    }

    const launchArtifactId = await recordInvestigationArtifact(
      investigations,
      artifacts,
      session,
      "debug.launch",
      "session_event",
      {
        event: "debug.launch",
        command: launched.command,
        pid: launched.pid,
        state: breakOnStart ? "waiting_for_debugger" : session.state,
      },
    );

    session = await sessions.put({
      ...session,
      last_known_state: {
        reason: breakOnStart ? "waiting_for_debugger" : "launched",
        updated_at: new Date().toISOString(),
      },
    });

    return jsonSuccess({
      session_id: session.session_id,
      investigation_id: investigation.investigation_id,
      artifact_id: launchArtifactId,
      runtime: "bun",
      state: session.state,
      root_pid: session.root_pid,
      target_pid: session.target_pid,
      command: session.root_command,
      waiting_for_debugger: session.transport_hint?.waiting_for_debugger ?? false,
      daemon: daemonStatusFromBridge(session.transport_hint?.bridge, true),
    });
  }

  if (action === "status") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    let updated =
      sessionOrError.state === "exited" || isProcessAlive(sessionOrError.root_pid)
        ? sessionOrError
        : await markExited(sessions, sessionOrError, "status_refresh");
    updated = await rehydratePausedSnapshotFromBridge(sessions, updated);
    const daemon = await resolveDaemonStatus(updated);

    return jsonSuccess({
      session_id: updated.session_id,
      investigation_id: updated.current_investigation_id,
      runtime: updated.runtime,
      state: updated.state,
      root_pid: updated.root_pid,
      target_pid: updated.target_pid,
      command: updated.root_command,
      daemon,
    });
  }

  if (action === "stop") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    const bridgeHint = sessionOrError.transport_hint?.bridge;
    if (bridgeHint) {
      await createBridgeClient(bridgeHint).shutdown();
    }

    if (sessionOrError.root_pid && isProcessAlive(sessionOrError.root_pid)) {
      process.kill(sessionOrError.root_pid, "SIGTERM");
      await Bun.sleep(50);
    }

    const updated = await sessions.put({
      ...sessionOrError,
      state: "exited",
      paused_snapshot: undefined,
      last_known_state: {
        reason: "stopped",
        updated_at: new Date().toISOString(),
      },
    });

    const artifactId = await recordInvestigationArtifact(
      investigations,
      artifacts,
      updated,
      "debug.stop",
      "session_event",
      {
        event: "debug.stop",
        pid: updated.root_pid,
      },
    );

    return jsonSuccess({
      session_id: updated.session_id,
      investigation_id: updated.current_investigation_id,
      artifact_id: artifactId,
      state: updated.state,
      daemon: daemonStatusFromBridge(sessionOrError.transport_hint?.bridge, false),
    });
  }

  if (action === "break") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    const location = parseBreakpointLocation(args[3]);
    if (!location) {
      return jsonError("refs.invalid", "Missing or invalid breakpoint location", {
        recoverable: true,
        session_id: sessionOrError.session_id,
        investigation_id: sessionOrError.current_investigation_id,
      });
    }

    const liveOrError = await connectLiveSession(sessions, sessionOrError);
    if ("error" in liveOrError) {
      return liveOrError.error;
    }

    let session = liveOrError.session;
    const live = liveOrError.live;

    try {
      const breakpoint = await live.setBreakpoint(`${location.file}:${location.line}`);
      const breakpointId = `BP#${session.breakpoints.length + 1}`;

      session = await sessions.put({
        ...session,
        breakpoints: [
          ...session.breakpoints,
          {
            breakpoint_id: breakpointId,
            file: location.file,
            line: location.line,
            engine_breakpoint_id: breakpoint.breakpointId,
          },
        ],
        last_known_state: {
          reason: "breakpoint_set",
          updated_at: new Date().toISOString(),
        },
      });

      const artifactId = await recordInvestigationArtifact(
        investigations,
        artifacts,
        session,
        "debug.break",
        "session_event",
        {
          event: "debug.break",
          breakpoint_id: breakpointId,
          file: location.file,
          line: location.line,
          engine_breakpoint_id: breakpoint.breakpointId,
        },
      );

      return jsonSuccess({
        session_id: session.session_id,
        investigation_id: session.current_investigation_id,
        artifact_id: artifactId,
        runtime: session.runtime,
        state: session.state,
        breakpoint_ref: breakpointId,
        location,
      });
    } finally {
      await live.close().catch(() => {});
    }
  }

  if (action === "pause") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    if (sessionOrError.state === "exited") {
      return sessionFailure("runtime.target_exited", "Debug target has exited", sessionOrError);
    }

    const liveOrError = await connectLiveSession(sessions, sessionOrError);
    if ("error" in liveOrError) {
      return liveOrError.error;
    }

    let session = liveOrError.session;
    const live = liveOrError.live;

    try {
      const paused = await live.pause(2_000);
      session = await sessions.put({
        ...session,
        state: "paused",
        paused_snapshot: toPausedSnapshotRecord(paused, session.target_pid),
        last_known_state: {
          reason: "pause_requested",
          updated_at: new Date().toISOString(),
        },
      });

      const artifactId = await recordInvestigationArtifact(
        investigations,
        artifacts,
        session,
        "debug.pause",
        "debug_snapshot",
        {
          event: "debug.pause",
          paused_ref: session.paused_snapshot?.paused_ref,
          reason: session.paused_snapshot?.reason,
          location: session.paused_snapshot?.location,
          frame_refs: session.paused_snapshot?.frames.map((frame) => frame.frame_ref),
        },
      );

      return jsonSuccess({
        session_id: session.session_id,
        investigation_id: session.current_investigation_id,
        artifact_id: artifactId,
        runtime: session.runtime,
        state: session.state,
        paused_ref: session.paused_snapshot?.paused_ref,
        location: session.paused_snapshot?.location,
      });
    } catch (error) {
      if (!isProcessAlive(session.root_pid)) {
        const exited = await markExited(sessions, session, "target_exited");
        return sessionFailure("runtime.target_exited", "Debug target has exited", exited);
      }

      return sessionFailure(
        "runtime.attach_failed",
        error instanceof Error ? error.message : "Debug target could not be paused",
        session,
        true,
      );
    } finally {
      await live.close().catch(() => {});
    }
  }

  if (action === "state") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    const pausedOrError = await resolvePausedSnapshotRecord(sessions, sessionOrError);
    if ("error" in pausedOrError) return pausedOrError.error;
    const session = pausedOrError.session;
    const pausedSnapshot = pausedOrError.pausedSnapshot;

    return jsonSuccess({
      session_id: session.session_id,
      investigation_id: session.current_investigation_id,
      runtime: session.runtime,
      state: session.state,
      paused_ref: pausedSnapshot.paused_ref,
      location: pausedSnapshot.location,
      reason: pausedSnapshot.reason,
      hit_breakpoints: pausedSnapshot.hit_breakpoints ?? [],
      frame_refs: pausedSnapshot.frames.map((frame) => frame.frame_ref),
    });
  }

  if (action === "stack") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    const pausedOrError = await resolvePausedSnapshotRecord(sessions, sessionOrError);
    if ("error" in pausedOrError) return pausedOrError.error;
    const session = pausedOrError.session;
    const pausedSnapshot = pausedOrError.pausedSnapshot;

    return jsonSuccess({
      session_id: session.session_id,
      investigation_id: session.current_investigation_id,
      runtime: session.runtime,
      state: session.state,
      paused_ref: pausedSnapshot.paused_ref,
      frames: pausedSnapshot.frames.map((frame) => ({
        frame_ref: frame.frame_ref,
        function: frame.function_name,
        location: frame.location,
      })),
    });
  }

  if (action === "vars") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    const pausedOrError = await resolvePausedSnapshotRecord(sessions, sessionOrError);
    if ("error" in pausedOrError) return pausedOrError.error;
    const session = pausedOrError.session;
    const pausedSnapshot = pausedOrError.pausedSnapshot;

    const frameRef = pausedSnapshot.frames[0]?.frame_ref ?? "@f0";
    const locals = pausedSnapshot.locals
      .filter((local) => local.frame_ref === frameRef)
      .map((local) => ({
        name: local.name,
        value: local.value,
        type: local.type,
      }));

    return jsonSuccess({
      session_id: session.session_id,
      investigation_id: session.current_investigation_id,
      runtime: session.runtime,
      state: session.state,
      paused_ref: pausedSnapshot.paused_ref,
      frame_ref: frameRef,
      locals,
    });
  }

  if (action === "eval") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;

    const expression = args.slice(3).join(" ").trim();
    if (!expression) {
      return jsonError("refs.invalid", "Missing expression", {
        recoverable: true,
        session_id: sessionOrError.session_id,
        investigation_id: sessionOrError.current_investigation_id,
      });
    }

    const pausedOrError = await resolvePausedSnapshotRecord(sessions, sessionOrError);
    if ("error" in pausedOrError) return pausedOrError.error;

    const liveOrError = await connectLiveSession(sessions, pausedOrError.session);
    if ("error" in liveOrError) {
      return liveOrError.error;
    }

    let session = liveOrError.session;
    const live = liveOrError.live;

    try {
      if (!session.transport_hint?.bridge) {
        try {
          const refreshedSnapshot = await live.snapshotPaused(500);
          session = await sessions.put({
            ...session,
            state: "paused",
            paused_snapshot: toPausedSnapshotRecord(refreshedSnapshot, session.target_pid),
            last_known_state: {
              reason: "paused_refresh",
              updated_at: new Date().toISOString(),
            },
          });
        } catch (error) {
          const lost = await markTransportLost(sessions, session, "paused_refresh_failed");
          return sessionFailure(
            "session.transport_lost",
            error instanceof Error ? error.message : "Paused transport could not be refreshed",
            lost,
            true,
          );
        }
      }

      const frame = session.paused_snapshot?.frames[0];
      if (!frame?.call_frame_id) {
        return sessionFailure("session.stale_snapshot", "Paused snapshot is not available yet", session);
      }

      const evaluation = await live.evaluate(expression);
      const result = evaluation.result as {
        value?: unknown;
        description?: string;
        unserializableValue?: string;
        type?: string;
      } | undefined;

      return jsonSuccess({
        session_id: session.session_id,
        investigation_id: session.current_investigation_id,
        runtime: session.runtime,
        state: session.state,
        paused_ref: session.paused_snapshot?.paused_ref,
        frame_ref: frame.frame_ref,
        expression,
        result: {
          value: stringifyRuntimeValue(result),
          type: result?.type,
        },
      });
    } finally {
      await live.close().catch(() => {});
    }
  }

  if (action === "continue") {
    const sessionOrError = await resolveSession(sessions, args[2]);
    if ("ok" in sessionOrError) return sessionOrError;
    const waitingForDebugger = sessionOrError.transport_hint?.waiting_for_debugger === true;

    if (sessionOrError.state === "exited") {
      return sessionFailure("runtime.target_exited", "Debug target has exited", sessionOrError);
    }

    if (
      sessionOrError.state !== "paused"
      && sessionOrError.state !== "running"
      && !waitingForDebugger
    ) {
      return sessionFailure("session.invalid_state", "Debug session must be running or paused", sessionOrError);
    }

    const liveOrError = await connectLiveSession(sessions, sessionOrError);
    if ("error" in liveOrError) {
      return liveOrError.error;
    }

    let session = liveOrError.session;
    const live = liveOrError.live;

    try {
      if (!session.transport_hint?.bridge) {
        session = await reapplyPersistedBreakpoints(sessions, session, live);
      }

      if (waitingForDebugger) {
        await live.releaseWaitingForDebugger();
      }

      let paused: BunPausedSnapshot;

      if (session.state === "paused") {
        if (!session.transport_hint?.bridge) {
          try {
            const refreshedSnapshot = await live.snapshotPaused(500);
            session = await sessions.put({
              ...session,
              state: "paused",
              paused_snapshot: toPausedSnapshotRecord(refreshedSnapshot, session.target_pid),
              last_known_state: {
                reason: "paused_refresh",
                updated_at: new Date().toISOString(),
              },
            });
          } catch {
            // If Bun does not replay the paused event on reattach, continue can still proceed.
          }
        }
        paused = await live.continueUntilPaused(2_000);
      } else {
        paused = await live.snapshotPaused(2_000);
        if (waitingForDebugger && isWaitingForDebuggerStartupPause(session, paused)) {
          paused = await live.continueUntilPaused(2_000);
        }
      }

      session = await sessions.put({
        ...session,
        state: "paused",
        paused_snapshot: toPausedSnapshotRecord(paused, session.target_pid),
        transport_hint: {
          ...session.transport_hint,
          waiting_for_debugger: false,
        },
        last_known_state: {
          reason: "breakpoint_hit",
          updated_at: new Date().toISOString(),
        },
      });

      const artifactId = await recordInvestigationArtifact(
        investigations,
        artifacts,
        session,
        "debug.pause",
        "debug_snapshot",
        {
          event: "debug.pause",
          paused_ref: session.paused_snapshot?.paused_ref,
          reason: session.paused_snapshot?.reason,
          location: session.paused_snapshot?.location,
          frame_refs: session.paused_snapshot?.frames.map((frame) => frame.frame_ref),
        },
      );

      return jsonSuccess({
        session_id: session.session_id,
        investigation_id: session.current_investigation_id,
        artifact_id: artifactId,
        runtime: session.runtime,
        state: session.state,
        paused_ref: session.paused_snapshot?.paused_ref,
        location: session.paused_snapshot?.location,
      });
    } catch (error) {
      if (isPauseTimeoutError(error)) {
        session = await sessions.put({
          ...session,
          state: "running",
          paused_snapshot: undefined,
          transport_hint: {
            ...session.transport_hint,
            waiting_for_debugger: false,
          },
          last_known_state: {
            reason: waitingForDebugger ? "waiting_for_debugger" : "continued",
            updated_at: new Date().toISOString(),
          },
        });

        return jsonSuccess({
          session_id: session.session_id,
          investigation_id: session.current_investigation_id,
          runtime: session.runtime,
          state: session.state,
        });
      }

      if (!isProcessAlive(session.root_pid)) {
        const exited = await markExited(sessions, session, "target_exited");
        return sessionFailure("runtime.target_exited", "Debug target has exited", exited);
      }

      session = await sessions.put({
        ...session,
        state: "running",
        paused_snapshot: undefined,
        transport_hint: {
          ...session.transport_hint,
          waiting_for_debugger: false,
        },
        last_known_state: {
          reason: "continued",
          updated_at: new Date().toISOString(),
        },
      });

      return jsonSuccess({
        session_id: session.session_id,
        investigation_id: session.current_investigation_id,
        runtime: session.runtime,
        state: session.state,
      });
    } finally {
      await live.close().catch(() => {});
    }
  }

  return jsonError("runtime.unsupported_operation", "Unsupported debug action", {
    recoverable: false,
  });
}

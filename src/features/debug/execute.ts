import { join } from "node:path";
import { jsonError, jsonSuccess, type JsonFailure, type JsonSuccess } from "../../core/errors";
import { launchBunTarget } from "../../adapters/bun/launch";
import { createArtifactStore } from "../../kernel/artifacts/store";
import { createInvestigationStore } from "../../kernel/investigations/store";
import { createSessionStore } from "../../kernel/sessions/store";
import type { SessionRecord } from "../../kernel/types";

function isProcessAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stores(root: string) {
  return {
    sessions: createSessionStore(root),
    investigations: createInvestigationStore(root),
    artifacts: createArtifactStore(root),
  };
}

export async function runDebug(args: string[], cwd: string): Promise<JsonSuccess<unknown> | JsonFailure> {
  const action = args[1];
  const { sessions, investigations, artifacts } = stores(cwd);

  if (action === "launch") {
    const delimiterIndex = args.indexOf("--");
    const command = delimiterIndex >= 0 ? args.slice(delimiterIndex + 1) : [];
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

    const launched = await launchBunTarget(command);
    const investigation = await investigations.create({});
    let session = await sessions.create({
      adapter: "bun",
      runtime: "bun",
      state: "running",
      root_command: launched.command,
      root_pid: launched.pid,
      target_pid: launched.pid,
      transport_hint: { ws_url: launched.ws_url },
      current_investigation_id: investigation.investigation_id,
    });

    const artifact = await artifacts.create({
      kind: "session_event",
      investigation_id: investigation.investigation_id,
      session_id: session.session_id,
      data: {
        event: "debug.launch",
        command: launched.command,
        pid: launched.pid,
      },
    });

    await investigations.appendEvent(investigation.investigation_id, {
      type: "debug.launch",
      created_at: new Date().toISOString(),
      session_id: session.session_id,
      artifact_id: artifact.artifact_id,
      data: {
        pid: launched.pid,
        command: launched.command,
      },
    });

    session = await sessions.put({
      ...session,
      current_investigation_id: investigation.investigation_id,
      last_known_state: {
        reason: "launched",
        updated_at: new Date().toISOString(),
      },
    } satisfies SessionRecord);

    return jsonSuccess({
      session_id: session.session_id,
      investigation_id: investigation.investigation_id,
      artifact_id: artifact.artifact_id,
      runtime: "bun",
      state: session.state,
      root_pid: session.root_pid,
      target_pid: session.target_pid,
      command: session.root_command,
    });
  }

  if (action === "status") {
    const sessionId = args[2];
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

    const nextState =
      session.state === "exited"
        ? "exited"
        : isProcessAlive(session.root_pid)
          ? session.state
          : "exited";

    const updated =
      nextState === session.state
        ? session
        : await sessions.put({
            ...session,
            state: nextState,
            last_known_state: {
              reason: "status_refresh",
              updated_at: new Date().toISOString(),
            },
          });

    return jsonSuccess({
      session_id: updated.session_id,
      investigation_id: updated.current_investigation_id,
      runtime: updated.runtime,
      state: updated.state,
      root_pid: updated.root_pid,
      target_pid: updated.target_pid,
      command: updated.root_command,
    });
  }

  if (action === "stop") {
    const sessionId = args[2];
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

    if (session.root_pid && isProcessAlive(session.root_pid)) {
      process.kill(session.root_pid, "SIGTERM");
      await Bun.sleep(50);
    }

    const updated = await sessions.put({
      ...session,
      state: "exited",
      last_known_state: {
        reason: "stopped",
        updated_at: new Date().toISOString(),
      },
    });

    let artifactId: string | undefined;
    if (updated.current_investigation_id) {
      const artifact = await artifacts.create({
        kind: "session_event",
        investigation_id: updated.current_investigation_id,
        session_id: updated.session_id,
        data: {
          event: "debug.stop",
          pid: updated.root_pid,
        },
      });
      artifactId = artifact.artifact_id;
      await investigations.appendEvent(updated.current_investigation_id, {
        type: "debug.stop",
        created_at: new Date().toISOString(),
        session_id: updated.session_id,
        artifact_id: artifact.artifact_id,
        data: {
          pid: updated.root_pid,
        },
      });
    }

    return jsonSuccess({
      session_id: updated.session_id,
      investigation_id: updated.current_investigation_id,
      artifact_id: artifactId,
      state: updated.state,
    });
  }

  return jsonError("runtime.unsupported_operation", "Unsupported debug action", {
    recoverable: false,
  });
}

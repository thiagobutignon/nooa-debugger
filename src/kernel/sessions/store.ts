import { join } from "node:path";
import { createId } from "../ids";
import { readJsonFile, writeJsonAtomically } from "../storage/fs";
import { withFileLock } from "../storage/lock";
import type { SessionRecord } from "../types";

type CreateSessionInput = Pick<
  SessionRecord,
  "adapter" | "runtime" | "state" | "root_command"
> & {
  current_investigation_id?: string;
  root_pid?: number;
  target_pid?: number;
  transport_hint?: SessionRecord["transport_hint"];
  paused_snapshot?: SessionRecord["paused_snapshot"];
};

export function createSessionStore(root: string) {
  const base = join(root, ".nooa-debugger", "sessions");

  function sessionPath(sessionId: string): string {
    return join(base, `${sessionId}.json`);
  }

  function lockPath(sessionId: string): string {
    return join(base, `${sessionId}.lock`);
  }

  return {
    async create(input: CreateSessionInput): Promise<SessionRecord> {
      const now = new Date().toISOString();
      const record: SessionRecord = {
        schema_version: 1,
        session_id: createId("sess"),
        adapter: input.adapter,
        runtime: input.runtime,
        state: input.state,
        root_command: input.root_command,
        root_pid: input.root_pid,
        target_pid: input.target_pid,
        transport_hint: input.transport_hint,
        breakpoints: [],
        paused_snapshot: input.paused_snapshot,
        current_investigation_id: input.current_investigation_id,
        created_at: now,
        updated_at: now,
      };
      await writeJsonAtomically(sessionPath(record.session_id), record);
      return record;
    },

    async get(sessionId: string): Promise<SessionRecord | undefined> {
      return readJsonFile<SessionRecord>(sessionPath(sessionId));
    },

    async put(record: SessionRecord): Promise<SessionRecord> {
      const nextRecord: SessionRecord = {
        ...record,
        updated_at: new Date().toISOString(),
      };
      await withFileLock(lockPath(record.session_id), async () => {
        await writeJsonAtomically(sessionPath(record.session_id), nextRecord);
      });
      return nextRecord;
    },
  };
}

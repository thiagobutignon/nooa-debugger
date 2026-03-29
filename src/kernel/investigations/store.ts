import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createId } from "../ids";
import { ensureDir, readJsonFile, writeJsonAtomically } from "../storage/fs";
import { withFileLock } from "../storage/lock";
import type { InvestigationEvent, InvestigationRecord } from "../types";

export function createInvestigationStore(root: string) {
  const base = join(root, ".nooa-debugger", "investigations");

  function recordPath(investigationId: string): string {
    return join(base, investigationId, "record.json");
  }

  function timelinePath(investigationId: string): string {
    return join(base, investigationId, "timeline.ndjson");
  }

  function lockPath(investigationId: string): string {
    return join(base, investigationId, "timeline.lock");
  }

  return {
    async create(input: { session_id?: string }): Promise<InvestigationRecord> {
      const now = new Date().toISOString();
      const record: InvestigationRecord = {
        schema_version: 1,
        investigation_id: createId("inv"),
        session_id: input.session_id,
        created_at: now,
        updated_at: now,
        status: "open",
      };
      await ensureDir(join(base, record.investigation_id));
      await writeJsonAtomically(recordPath(record.investigation_id), record);
      return record;
    },

    async get(investigationId: string): Promise<InvestigationRecord | undefined> {
      return readJsonFile<InvestigationRecord>(recordPath(investigationId));
    },

    async appendEvent(
      investigationId: string,
      event: InvestigationEvent,
    ): Promise<void> {
      await ensureDir(join(base, investigationId));
      await withFileLock(lockPath(investigationId), async () => {
        await appendFile(
          timelinePath(investigationId),
          `${JSON.stringify(event)}\n`,
          "utf8",
        );
      });
      const current = await this.get(investigationId);
      if (current) {
        await writeJsonAtomically(recordPath(investigationId), {
          ...current,
          updated_at: new Date().toISOString(),
        } satisfies InvestigationRecord);
      }
    },

    async listEvents(investigationId: string): Promise<InvestigationEvent[]> {
      const file = Bun.file(timelinePath(investigationId));
      if (!(await file.exists())) return [];
      const raw = await file.text();
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as InvestigationEvent);
    },
  };
}

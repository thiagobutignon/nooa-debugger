import { join } from "node:path";
import { createId } from "../ids";
import { listJsonFiles, readJsonFile, writeJsonAtomically } from "../storage/fs";
import type { ArtifactKind, ArtifactRecord } from "../types";

type CreateArtifactInput = {
  kind: ArtifactKind;
  investigation_id?: string;
  session_id?: string;
  data: Record<string, unknown>;
  blob_ids?: string[];
};

type ListFilters = {
  investigation_id?: string;
  session_id?: string;
};

export function createArtifactStore(root: string) {
  const base = join(root, ".nooa-debugger", "artifacts");

  function artifactPath(artifactId: string): string {
    return join(base, `${artifactId}.json`);
  }

  return {
    async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
      const record: ArtifactRecord = {
        schema_version: 1,
        artifact_id: createId("art"),
        investigation_id: input.investigation_id,
        session_id: input.session_id,
        kind: input.kind,
        created_at: new Date().toISOString(),
        data: input.data,
        blob_ids: input.blob_ids,
      };
      await writeJsonAtomically(artifactPath(record.artifact_id), record);
      return record;
    },

    async get(artifactId: string): Promise<ArtifactRecord | undefined> {
      return readJsonFile<ArtifactRecord>(artifactPath(artifactId));
    },

    async list(filters: ListFilters = {}): Promise<ArtifactRecord[]> {
      const files = await listJsonFiles(base);
      const items = await Promise.all(
        files.map((file) => readJsonFile<ArtifactRecord>(file)),
      );
      return items.filter((item): item is ArtifactRecord => {
        if (!item) return false;
        if (
          filters.investigation_id &&
          item.investigation_id !== filters.investigation_id
        ) {
          return false;
        }
        if (filters.session_id && item.session_id !== filters.session_id) {
          return false;
        }
        return true;
      });
    },
  };
}

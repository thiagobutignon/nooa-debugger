import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../../src/kernel/artifacts/store";
import { createInvestigationStore } from "../../src/kernel/investigations/store";
import { createSessionStore } from "../../src/kernel/sessions/store";

test("session store persists and reloads session records", async () => {
  const root = await mkdtemp(join(tmpdir(), "nooa-debugger-session-store-"));
  const sessions = createSessionStore(root);
  const session = await sessions.create({
    adapter: "bun",
    runtime: "bun",
    state: "created",
    root_command: ["bun", "run", "tests/fixtures/bun-idle.ts"],
  });

  const reloaded = await sessions.get(session.session_id);
  expect(reloaded?.session_id).toBe(session.session_id);
});

test("investigation store appends NDJSON timeline events", async () => {
  const root = await mkdtemp(join(tmpdir(), "nooa-debugger-investigation-"));
  const investigations = createInvestigationStore(root);
  const record = await investigations.create({});
  await investigations.appendEvent(record.investigation_id, {
    type: "debug.launch",
    created_at: new Date().toISOString(),
  });

  const events = await investigations.listEvents(record.investigation_id);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("debug.launch");
});

test("artifact store lists records by investigation", async () => {
  const root = await mkdtemp(join(tmpdir(), "nooa-debugger-artifact-store-"));
  const artifacts = createArtifactStore(root);
  await artifacts.create({
    kind: "session_event",
    investigation_id: "inv-1",
    data: { ok: true },
  });
  const listed = await artifacts.list({ investigation_id: "inv-1" });
  expect(listed).toHaveLength(1);
  expect(listed[0]?.investigation_id).toBe("inv-1");
});

# NOOA Debugger Foundation And Bun Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap `nooa-debugger` as a Bun project with JSON-only CLI contracts, persistent kernel storage, investigation/artifact/session records, and a real Bun-backed `debug launch|status|stop` slice.

**Architecture:** Start with a thin command surface and a small kernel that owns IDs, storage, sessions, investigations, and artifacts. Implement the first real runtime behavior through a Bun adapter that can launch a debug target, persist a session record, and support later reattach-oriented work without inventing fake abstractions.

**Tech Stack:** Bun 1.3, TypeScript, Bun test, Node/Bun standard library only

---

## File Structure

**Create**

- `package.json` — project manifest and scripts
- `tsconfig.json` — TypeScript compiler configuration for Bun
- `.gitignore` — ignore `.nooa-debugger/`, `node_modules/`, and generated artifacts
- `README.md` — project summary and current command surface
- `index.ts` — CLI entrypoint and command dispatch
- `src/core/command.ts` — shared command types
- `src/core/errors.ts` — JSON error helpers and error codes
- `src/core/json-output.ts` — stable JSON writers
- `src/core/registry.ts` — dynamic feature loader/registry
- `src/kernel/types.ts` — persisted record types for session, investigation, artifact
- `src/kernel/ids.ts` — ID generation helpers
- `src/kernel/storage/fs.ts` — atomic file write, JSON read/write, directory helpers
- `src/kernel/storage/lock.ts` — per-record lock files for short-lived CLI coordination
- `src/kernel/sessions/store.ts` — session persistence and lookup
- `src/kernel/investigations/store.ts` — investigation record and timeline append
- `src/kernel/artifacts/store.ts` — artifact persistence and listing
- `src/adapters/bun/launch.ts` — Bun process launch with inspect flag and transport hint extraction
- `src/features/debug/cli.ts` — `debug launch|status|stop`
- `src/features/debug/execute.ts` — debug subcommand execution
- `src/features/investigation/cli.ts` — `investigation create|show`
- `src/features/artifact/cli.ts` — `artifact get|list`
- `tests/test-utils/temp-project.ts` — helper to create isolated test roots
- `tests/kernel/storage.test.ts` — storage and locking tests
- `tests/kernel/records.test.ts` — session/investigation/artifact store tests
- `tests/features/debug.cli.test.ts` — CLI contract tests for `debug`
- `tests/features/debug.bun.integration.test.ts` — Bun runtime integration tests
- `tests/features/investigation.cli.test.ts` — CLI contract tests for `investigation`
- `tests/features/artifact.cli.test.ts` — CLI contract tests for `artifact`
- `tests/fixtures/bun-idle.ts` — Bun fixture that stays alive long enough for launch/status

**Modify**

- `docs/superpowers/specs/2026-03-28-nooa-debugger-kernel-design.md` — already updated during review incorporation

### Task 1: Bootstrap The Project Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `index.ts`
- Create: `src/core/command.ts`
- Create: `src/core/registry.ts`
- Create: `src/core/json-output.ts`
- Test: `tests/features/bootstrap.test.ts`

- [ ] **Step 1: Write the failing bootstrap test**

```ts
import { expect, test } from "bun:test";
import { main } from "../../index";

test("prints JSON error for unknown command", async () => {
  const writes: string[] = [];
  const exitCodes: number[] = [];

  await main(["unknown"], {
    write: (chunk) => writes.push(chunk),
    setExitCode: (code) => exitCodes.push(code),
    cwd: "/tmp/nooa-debugger-test",
  });

  const payload = JSON.parse(writes.join("").trim());
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("command.unknown");
  expect(exitCodes.at(-1)).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/features/bootstrap.test.ts`
Expected: FAIL because `index.ts` and exported `main` do not exist yet

- [ ] **Step 3: Write minimal project bootstrap files**

```json
{
  "name": "nooa-debugger",
  "private": true,
  "type": "module",
  "module": "index.ts",
  "scripts": {
    "start": "bun run index.ts",
    "test": "bun test",
    "check": "bun test"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": ["bun-types"]
  }
}
```

```ts
export type CommandContext = {
  args: string[];
  cwd: string;
  write: (chunk: string) => void;
  setExitCode: (code: number) => void;
};

export type Command = {
  name: string;
  execute: (context: CommandContext) => Promise<void>;
};
```

```ts
export function writeJson(
  write: (chunk: string) => void,
  payload: unknown,
): void {
  write(`${JSON.stringify(payload, null, 2)}\n`);
}
```

```ts
import type { Command } from "./command";

export async function loadCommands(): Promise<Map<string, Command>> {
  const commands = new Map<string, Command>();
  const debug = (await import("../features/debug/cli")).default;
  const investigation = (await import("../features/investigation/cli")).default;
  const artifact = (await import("../features/artifact/cli")).default;
  commands.set(debug.name, debug);
  commands.set(investigation.name, investigation);
  commands.set(artifact.name, artifact);
  return commands;
}
```

```ts
import { loadCommands } from "./src/core/registry";
import { writeJson } from "./src/core/json-output";

export async function main(
  args = Bun.argv.slice(2),
  deps: Partial<{
    write: (chunk: string) => void;
    setExitCode: (code: number) => void;
    cwd: string;
  }> = {},
) {
  const write = deps.write ?? ((chunk: string) => process.stdout.write(chunk));
  const setExitCode = deps.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  const cwd = deps.cwd ?? process.cwd();

  const commands = await loadCommands();
  const commandName = args[0];
  const command = commandName ? commands.get(commandName) : undefined;

  if (!command) {
    writeJson(write, {
      ok: false,
      error: { code: "command.unknown", message: "Unknown command" },
    });
    setExitCode(1);
    return;
  }

  await command.execute({ args, cwd, write, setExitCode });
}

if (import.meta.path === Bun.main) {
  await main();
}
```

- [ ] **Step 4: Add minimal stubs so the registry imports resolve**

```ts
import type { Command } from "../../core/command";

const command: Command = {
  name: "debug",
  async execute({ write }) {
    write(`${JSON.stringify({ ok: false, error: { code: "debug.unimplemented", message: "Not implemented" } })}\n`);
  },
};

export default command;
```

Repeat the same stub pattern for `investigation` and `artifact`, swapping names and error codes.

- [ ] **Step 5: Run the bootstrap test to verify it passes**

Run: `bun test tests/features/bootstrap.test.ts`
Expected: PASS

### Task 2: Implement Kernel Record Schemas And Safe Persistence

**Files:**
- Create: `src/core/errors.ts`
- Create: `src/kernel/types.ts`
- Create: `src/kernel/ids.ts`
- Create: `src/kernel/storage/fs.ts`
- Create: `src/kernel/storage/lock.ts`
- Test: `tests/kernel/storage.test.ts`
- Test: `tests/kernel/records.test.ts`

- [ ] **Step 1: Write failing storage and schema tests**

```ts
import { expect, test } from "bun:test";
import { createId } from "../../src/kernel/ids";
import { writeJsonAtomically, readJsonFile } from "../../src/kernel/storage/fs";
import { withFileLock } from "../../src/kernel/storage/lock";

test("createId prefixes identifiers", () => {
  expect(createId("sess")).toStartWith("sess-");
});

test("writeJsonAtomically writes readable JSON", async () => {
  const path = `/tmp/nooa-debugger-${Date.now()}.json`;
  await writeJsonAtomically(path, { schema_version: 1, ok: true });
  const value = await readJsonFile<{ ok: boolean }>(path);
  expect(value?.ok).toBe(true);
});

test("withFileLock serializes access for same path", async () => {
  const path = `/tmp/nooa-debugger-lock-${Date.now()}.lock`;
  const events: string[] = [];

  await Promise.all([
    withFileLock(path, async () => {
      events.push("first:start");
      await Bun.sleep(50);
      events.push("first:end");
    }),
    withFileLock(path, async () => {
      events.push("second:start");
      events.push("second:end");
    }),
  ]);

  expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/kernel/storage.test.ts tests/kernel/records.test.ts`
Expected: FAIL because kernel modules do not exist yet

- [ ] **Step 3: Implement the minimal kernel primitives**

```ts
export type SessionState = "created" | "running" | "paused" | "exited" | "transport_lost";

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
```

```ts
export type InvestigationRecord = {
  schema_version: 1;
  investigation_id: string;
  session_id?: string;
  created_at: string;
  updated_at: string;
  status: "open" | "closed";
};

export type ArtifactRecord = {
  schema_version: 1;
  artifact_id: string;
  investigation_id?: string;
  session_id?: string;
  kind: "session_event" | "debug_snapshot" | "trace_capture" | "profile_capture";
  created_at: string;
  data: Record<string, unknown>;
  blob_ids?: string[];
};
```

```ts
export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
```

```ts
import { dirname } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await Bun.write(`${path}/.keep`, "");
  await Bun.file(`${path}/.keep`).delete();
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await Bun.$`mkdir -p ${dirname(path)}`.quiet();
  const tempPath = `${path}.tmp-${crypto.randomUUID()}`;
  await Bun.write(tempPath, JSON.stringify(value, null, 2));
  await Bun.$`mv ${tempPath} ${path}`.quiet();
}

export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return (await file.json()) as T;
}
```

```ts
export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  for (;;) {
    const writer = Bun.file(path);
    if (!(await writer.exists())) {
      await Bun.write(path, `${process.pid}`);
      break;
    }
    await Bun.sleep(10);
  }
  try {
    return await fn();
  } finally {
    await Bun.file(path).delete();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/kernel/storage.test.ts tests/kernel/records.test.ts`
Expected: PASS

### Task 3: Implement Session, Investigation, And Artifact Stores

**Files:**
- Create: `src/kernel/sessions/store.ts`
- Create: `src/kernel/investigations/store.ts`
- Create: `src/kernel/artifacts/store.ts`
- Test: `tests/kernel/records.test.ts`

- [ ] **Step 1: Write failing store tests**

```ts
import { expect, test } from "bun:test";
import { createSessionStore } from "../../src/kernel/sessions/store";
import { createInvestigationStore } from "../../src/kernel/investigations/store";
import { createArtifactStore } from "../../src/kernel/artifacts/store";

test("session store persists and reloads session records", async () => {
  const root = `/tmp/nooa-debugger-store-${Date.now()}`;
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
  const root = `/tmp/nooa-debugger-investigation-${Date.now()}`;
  const investigations = createInvestigationStore(root);
  const record = await investigations.create({});
  await investigations.appendEvent(record.investigation_id, {
    type: "debug.launch",
    created_at: new Date().toISOString(),
  });

  const events = await investigations.listEvents(record.investigation_id);
  expect(events).toHaveLength(1);
});

test("artifact store lists records by investigation", async () => {
  const root = `/tmp/nooa-debugger-artifact-${Date.now()}`;
  const artifacts = createArtifactStore(root);
  await artifacts.create({
    kind: "session_event",
    investigation_id: "inv-1",
    data: { ok: true },
  });
  const listed = await artifacts.list({ investigation_id: "inv-1" });
  expect(listed).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/kernel/records.test.ts`
Expected: FAIL because store modules do not exist yet

- [ ] **Step 3: Implement the minimal stores**

```ts
export function createSessionStore(root: string) {
  const base = `${root}/.nooa-debugger/sessions`;
  return {
    async create(input: Pick<SessionRecord, "adapter" | "runtime" | "state" | "root_command">) {
      const now = new Date().toISOString();
      const record: SessionRecord = {
        schema_version: 1,
        session_id: createId("sess"),
        adapter: input.adapter,
        runtime: input.runtime,
        state: input.state,
        root_command: input.root_command,
        breakpoints: [],
        created_at: now,
        updated_at: now,
      };
      await writeJsonAtomically(`${base}/${record.session_id}.json`, record);
      return record;
    },
    async get(sessionId: string) {
      return readJsonFile<SessionRecord>(`${base}/${sessionId}.json`);
    },
    async put(record: SessionRecord) {
      await writeJsonAtomically(`${base}/${record.session_id}.json`, record);
      return record;
    },
  };
}
```

Implement `createInvestigationStore` and `createArtifactStore` with the same style: small closure-based stores backed by `.nooa-debugger/`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/kernel/records.test.ts`
Expected: PASS

### Task 4: Implement Bun `debug launch|status|stop`

**Files:**
- Create: `src/adapters/bun/launch.ts`
- Create: `src/features/debug/execute.ts`
- Modify: `src/features/debug/cli.ts`
- Test: `tests/features/debug.cli.test.ts`
- Test: `tests/features/debug.bun.integration.test.ts`
- Test: `tests/fixtures/bun-idle.ts`

- [ ] **Step 1: Write the failing CLI and integration tests**

```ts
import { expect, test } from "bun:test";
import { main } from "../../index";

test("debug launch returns session and investigation ids", async () => {
  const writes: string[] = [];
  await main(
    ["debug", "launch", "--", "bun", "run", "tests/fixtures/bun-idle.ts"],
    {
      write: (chunk) => writes.push(chunk),
      cwd: process.cwd(),
    },
  );

  const payload = JSON.parse(writes.join("").trim());
  expect(payload.ok).toBe(true);
  expect(payload.data.session_id).toStartWith("sess-");
  expect(payload.data.investigation_id).toStartWith("inv-");
});
```

```ts
import { expect, test } from "bun:test";
import { main } from "../../index";

test("debug status reloads persisted session", async () => {
  const launchWrites: string[] = [];
  await main(["debug", "launch", "--", "bun", "run", "tests/fixtures/bun-idle.ts"], {
    write: (chunk) => launchWrites.push(chunk),
    cwd: process.cwd(),
  });
  const launchPayload = JSON.parse(launchWrites.join("").trim());

  const statusWrites: string[] = [];
  await main(["debug", "status", launchPayload.data.session_id], {
    write: (chunk) => statusWrites.push(chunk),
    cwd: process.cwd(),
  });
  const statusPayload = JSON.parse(statusWrites.join("").trim());
  expect(statusPayload.data.session_id).toBe(launchPayload.data.session_id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/features/debug.cli.test.ts tests/features/debug.bun.integration.test.ts`
Expected: FAIL because `debug launch|status|stop` are still stubs

- [ ] **Step 3: Implement the Bun launch adapter**

```ts
export async function launchBunTarget(command: string[]) {
  const finalCommand =
    command[0] === "bun" ? ["bun", "--inspect", ...command.slice(1)] : command;
  const proc = Bun.spawn(finalCommand, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const stderrText = await new Response(proc.stderr).text();
  const match = stderrText.match(/ws:\/\/[^\s]+/);

  return {
    pid: proc.pid,
    ws_url: match?.[0],
    command: finalCommand,
    process: proc,
    stderrText,
  };
}
```

In `src/features/debug/execute.ts`, implement:

- `launch`: create session, create investigation, call Bun adapter, update session to `running`, emit investigation event, create `session_event` artifact
- `status`: reload session by ID and return persisted data
- `stop`: send `SIGTERM`, update session to `exited`, append investigation event, create `session_event` artifact

- [ ] **Step 4: Replace the stub CLI with a real command**

Use this shape:

```ts
const command: Command = {
  name: "debug",
  async execute(context) {
    const payload = await runDebug(context);
    context.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (!payload.ok) context.setExitCode(1);
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/features/debug.cli.test.ts tests/features/debug.bun.integration.test.ts`
Expected: PASS

### Task 5: Implement Read Models For `investigation` And `artifact`

**Files:**
- Modify: `src/features/investigation/cli.ts`
- Modify: `src/features/artifact/cli.ts`
- Test: `tests/features/investigation.cli.test.ts`
- Test: `tests/features/artifact.cli.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { expect, test } from "bun:test";
import { main } from "../../index";

test("investigation show returns timeline events", async () => {
  const writes: string[] = [];
  await main(["investigation", "show", "inv-missing"], {
    write: (chunk) => writes.push(chunk),
    cwd: process.cwd(),
  });
  const payload = JSON.parse(writes.join("").trim());
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("session.not_found");
});
```

Replace the missing-ID assertion after wiring real IDs in a second test:

```ts
expect(payload.ok).toBe(true);
expect(payload.data.events.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/features/investigation.cli.test.ts tests/features/artifact.cli.test.ts`
Expected: FAIL because those commands are still stubs

- [ ] **Step 3: Implement the read-only command surface**

Implement:

- `investigation create` → create explicit empty investigation
- `investigation show <investigation-id>` → return record + events
- `artifact list [investigation-id]` → return matching artifact records
- `artifact get <artifact-id>` → return one artifact record

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/features/investigation.cli.test.ts tests/features/artifact.cli.test.ts`
Expected: PASS

### Task 6: Run The Slice Verification Suite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the current slice**

Add a short section describing the currently implemented commands:

```md
## Current Slice

- `debug launch`
- `debug status`
- `debug stop`
- `investigation create`
- `investigation show`
- `artifact list`
- `artifact get`
```

- [ ] **Step 2: Run the full verification suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Run a manual Bun launch smoke test**

Run: `bun run index.ts debug launch -- bun run tests/fixtures/bun-idle.ts`
Expected: JSON payload with `session_id`, `investigation_id`, `runtime: "bun"`

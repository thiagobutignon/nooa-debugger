# JVM DAP Contract-First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated JVM backend slice that models Java/Kotlin debugging through a DAP-oriented facade, fake transport, capability mapping, and AI-first JSON commands without wiring a real launcher.

**Architecture:** Keep the slice self-contained under `src/adapters/dap-jvm/` and `tests/adapters/dap-jvm/`. The backend facade should expose launch/attach/pause/continue/state/stack/vars/eval as data-only operations over a transport abstraction, with a fake transport used in tests to prove the contract and mapping without touching the shared CLI or Bun adapter.

**Tech Stack:** TypeScript, Bun test, JSON-oriented command contracts, DAP-shaped request/response objects

---

### Task 1: Define the JVM DAP contract and fake transport

**Files:**
- Create: `src/adapters/dap-jvm/contract.ts`
- Create: `src/adapters/dap-jvm/fake-transport.ts`
- Test: `tests/adapters/dap-jvm/contract.test.ts`

- [ ] **Step 1: Write the failing contract tests**

```ts
import { expect, test } from "bun:test";
import { createJvmBackendFacade } from "../../../src/adapters/dap-jvm/contract";
import { createFakeDapTransport } from "../../../src/adapters/dap-jvm/fake-transport";

test("maps launch attach pause continue state stack vars and eval into DAP-shaped commands", async () => {
  const transport = createFakeDapTransport();
  const backend = createJvmBackendFacade({ transport });

  const launch = await backend.launch({
    mode: "launch",
    request: { mainClass: "com.example.Main", classPath: ["app.jar"] },
  });

  expect(launch.endpoint.transport).toBe("dap");
  expect(launch.capabilities.pause).toBe(true);
  expect(launch.capabilities.evaluate).toBe(true);
  expect(launch.commands.at(-1)?.request.command).toBe("configurationDone");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/adapters/dap-jvm/contract.test.ts`
Expected: FAIL because the contract facade and fake transport do not exist yet

- [ ] **Step 3: Implement the minimal contract types and fake transport**

Create a transport that records DAP requests and returns canned responses for:

```ts
initialize
launch
attach
configurationDone
pause
continue
stackTrace
scopes
variables
evaluate
```

- [ ] **Step 4: Re-run the contract test**

Run: `bun test tests/adapters/dap-jvm/contract.test.ts`
Expected: PASS

### Task 2: Add capability and AI-first JSON mappings

**Files:**
- Create: `src/adapters/dap-jvm/mapping.ts`
- Create: `tests/adapters/dap-jvm/mapping.test.ts`

- [ ] **Step 1: Write tests for JSON surface mapping**

```ts
import { expect, test } from "bun:test";
import { toJvmJsonCommand, toPausedSnapshot } from "../../../src/adapters/dap-jvm/mapping";

test("maps DAP pause state into launch attach pause continue state stack vars eval JSON fields", () => {
  const snapshot = toPausedSnapshot({
    reason: "breakpoint",
    threadId: 12,
    frames: [{ id: "f1", name: "main", sourcePath: "src/Main.java", line: 27, column: 5 }],
    locals: [{ name: "count", value: "41", type: "int" }],
  });

  expect(snapshot.location.file).toBe("src/Main.java");
  expect(snapshot.frames[0].frame_ref).toBe("frame-0");
  expect(snapshot.locals[0].name).toBe("count");
});
```

- [ ] **Step 2: Run the mapping test to verify it fails**

Run: `bun test tests/adapters/dap-jvm/mapping.test.ts`
Expected: FAIL because the mapping helpers do not exist yet

- [ ] **Step 3: Implement the mapping helpers**

Add functions that translate DAP concepts into the AI-first JSON surface:

```ts
launch -> endpoint + capabilities + command list
attach -> endpoint + capabilities + command list
pause/continue -> paused/running state envelope
state/stack/vars/eval -> stable JSON snapshots from DAP frames and scopes
```

- [ ] **Step 4: Re-run the mapping test**

Run: `bun test tests/adapters/dap-jvm/mapping.test.ts`
Expected: PASS

### Task 3: Document the JVM backend contract

**Files:**
- Create: `docs/reference/2026-03-29-dap-jvm-contract.md`

- [ ] **Step 1: Write the documentation**

Document:

```md
- launch vs attach semantics
- pause / continue behavior
- state / stack / vars / eval mapping
- JVM-specific notes for Java and Kotlin
- DAP capability expectations and limitations
```

- [ ] **Step 2: Review for placeholders and contradictions**

Confirm the doc has no TBD/TODO sections and matches the facade behavior.

### Task 4: Verify and commit

**Files:**
- All files above

- [ ] **Step 1: Run the targeted tests**

Run: `bun test tests/adapters/dap-jvm/contract.test.ts tests/adapters/dap-jvm/mapping.test.ts`
Expected: PASS

- [ ] **Step 2: Commit the JVM slice**

```bash
git add docs/reference/2026-03-29-dap-jvm-contract.md docs/superpowers/plans/2026-03-29-dap-jvm-contract-first.md src/adapters/dap-jvm tests/adapters/dap-jvm
git commit -m "feat(dap-jvm): add contract-first JVM backend slice"
```

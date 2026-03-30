# Node DAP Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated Node/JS/TS backend slice that models AI-first debugging commands with a transport-agnostic DAP client and a prototype backend facade for launch, attach, pause, continue, state, stack, vars, and eval.

**Architecture:** Keep the slice entirely in `src/adapters/dap-node/` so it does not depend on Bun-specific runtime code. The client layer owns request sequencing, response matching, and event dispatch; the backend layer only describes how high-level debugger actions map to DAP requests and capability metadata.

**Tech Stack:** TypeScript, Bun test, JSON-friendly data shapes

---

### Task 1: Add The DAP Protocol And Client Abstraction

**Files:**
- Create: `src/adapters/dap-node/protocol.ts`
- Create: `src/adapters/dap-node/client.ts`
- Test: `tests/adapters/dap-node.client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { createDapClient } from "../../src/adapters/dap-node/client";

test("dap client sends requests and resolves responses by request_seq", async () => {
  // ...
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test ./tests/adapters/dap-node.client.test.ts`
Expected: FAIL because the DAP client and protocol types do not exist yet.

- [ ] **Step 3: Implement the minimal client**

```ts
export type DapTransport = {
  send(message: DapRequestMessage): void;
  close(): void;
  onMessage(listener: (message: DapMessage) => void): () => void;
};
```

Implement request ID tracking, response matching, and helpers for `initialize`, `launch`, `attach`, `pause`, `continue`, `stackTrace`, `scopes`, `variables`, and `evaluate`.

- [ ] **Step 4: Re-run the test**

Run: `bun test ./tests/adapters/dap-node.client.test.ts`
Expected: PASS.

### Task 2: Add The Node Backend Facade And Capability Descriptors

**Files:**
- Create: `src/adapters/dap-node/backend.ts`
- Test: `tests/adapters/dap-node.backend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { createNodeDapBackend } from "../../src/adapters/dap-node/backend";

test("node backend describes AI-first debugger capabilities", () => {
  const backend = createNodeDapBackend();
  expect(backend.describeCapabilities().map((item) => item.name)).toEqual([
    "launch",
    "attach",
    "pause",
    "continue",
    "state",
    "stack",
    "vars",
    "eval",
  ]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test ./tests/adapters/dap-node.backend.test.ts`
Expected: FAIL because the backend facade does not exist yet.

- [ ] **Step 3: Implement the backend facade**

```ts
export function createNodeDapBackend() {
  return {
    describeCapabilities() {
      return [
        { name: "launch", dapMethods: ["initialize", "launch"] },
        { name: "attach", dapMethods: ["initialize", "attach"] },
        { name: "pause", dapMethods: ["pause"] },
        { name: "continue", dapMethods: ["continue"] },
        { name: "state", dapMethods: ["stackTrace", "scopes", "variables"] },
        { name: "stack", dapMethods: ["stackTrace"] },
        { name: "vars", dapMethods: ["scopes", "variables"] },
        { name: "eval", dapMethods: ["evaluate"] },
      ];
    },
  };
}
```

- [ ] **Step 4: Re-run the test**

Run: `bun test ./tests/adapters/dap-node.backend.test.ts`
Expected: PASS.

### Task 3: Document The Slice And Verify The Whole Package

**Files:**
- Create: `docs/reference/2026-03-29-node-dap-slice.md`

- [ ] **Step 1: Write the documentation**

Describe:

- the DAP client abstraction
- the backend facade
- the command-to-DAP mapping for `launch`, `attach`, `pause`, `continue`, `state`, `stack`, `vars`, and `eval`
- the explicit non-goal: no process spawning yet

- [ ] **Step 2: Run the package tests**

Run: `bun test`
Expected: PASS.

- [ ] **Step 3: Commit the slice**

```bash
git add src/adapters/dap-node tests/adapters/dap-node.* docs/reference/2026-03-29-node-dap-slice.md docs/superpowers/plans/2026-03-29-node-dap-slice.md
git commit -m "feat(dap-node): add node DAP backend slice"
```

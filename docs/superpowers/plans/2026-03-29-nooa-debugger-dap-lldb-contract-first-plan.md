# NOOA Debugger LLDB Contract-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated LLDB-family DAP facade that translates the AI-first debug surface into LLDB-dap-shaped requests without starting any subprocesses.

**Architecture:** Keep the slice backend-local under `src/adapters/dap-lldb/`. Model an injected DAP transport, a small facade for launch/attach/pause/continue/state/stack/vars/eval, and a mapper module that turns DAP protocol payloads into stable JSON command results. Tests use a fake transport so the contract is executable without a live LLDB server.

**Tech Stack:** TypeScript, Bun test, DAP-shaped request/response objects, markdown docs

---

### Task 1: Define the LLDB DAP contract surface

**Files:**
- Create: `src/adapters/dap-lldb/protocol.ts`
- Create: `src/adapters/dap-lldb/mappers.ts`
- Create: `src/adapters/dap-lldb/facade.ts`
- Create: `src/adapters/dap-lldb/index.ts`

- [ ] **Step 1: Write the contract types and mapper tests**
- [ ] **Step 2: Run the tests and confirm they fail because the adapter files do not exist**
- [ ] **Step 3: Implement the minimal transport-facing facade and LLDB capability notes**
- [ ] **Step 4: Re-run the tests and confirm they pass**

### Task 2: Lock down launch, attach, pause, continue, state, stack, vars, and eval behavior

**Files:**
- Create: `tests/adapters/dap-lldb.facade.test.ts`

- [ ] **Step 1: Write fake-transport tests for DAP request ordering and normalized JSON outputs**
- [ ] **Step 2: Run the tests and confirm the red state is meaningful**
- [ ] **Step 3: Implement the command mapping and snapshot normalization**
- [ ] **Step 4: Re-run the tests and confirm they pass**

### Task 3: Document the AI-first LLDB mapping and capability caveats

**Files:**
- Create: `docs/reference/dap-lldb.md`

- [ ] **Step 1: Write the launch/attach/pause/continue/state/stack/vars/eval mapping doc**
- [ ] **Step 2: Add LLDB-specific notes for Swift, Rust, and native targets**
- [ ] **Step 3: Review the doc for scope and ambiguity**


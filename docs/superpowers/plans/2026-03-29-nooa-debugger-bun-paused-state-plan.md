# NOOA Debugger Bun Paused State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bun-backed debugger session real by fixing inspector launch robustness, rehydrating live transport, and delivering `break`, `continue`, `state`, `stack`, `vars`, and `eval` with JSON-only paused-state responses.

**Architecture:** Keep the existing kernel/session/investigation/artifact foundation, but replace the fake “running session” assumption with a real Bun inspector transport. The slice is intentionally narrow: one runtime, one live transport path, one paused-state model, and dogfooding-backed evidence that the CLI can pause and inspect an actual Bun process.

**Tech Stack:** Bun 1.3, TypeScript, Bun test, Chrome DevTools Protocol over WebSocket

---

## File Structure

**Create**

- `src/adapters/bun/ports.ts` — free-port allocation for Bun inspector launch
- `src/adapters/bun/cdp.ts` — minimal CDP client for connect/send/receive
- `src/adapters/bun/session.ts` — Bun adapter operations: attach, break, continue, state, stack, vars, eval
- `tests/adapters/bun.launch.test.ts` — tests for inspector launch and port handling
- `tests/adapters/bun.cdp.test.ts` — protocol-level tests where mocking is unavoidable
- `tests/features/debug.paused-state.integration.test.ts` — end-to-end breakpoint and paused-state tests
- `tests/fixtures/bun-breakpoint.ts` — Bun fixture with deterministic breakpoint line and inspectable locals

**Modify**

- `src/adapters/bun/launch.ts`
- `src/features/debug/execute.ts`
- `src/kernel/types.ts`
- `src/kernel/sessions/store.ts`
- `tests/features/debug.cli.test.ts`
- `tests/features/debug.bun.integration.test.ts`
- `README.md`

### Task 1: Reproduce And Lock Down The Inspector Launch Failure

**Files:**
- Create: `tests/adapters/bun.launch.test.ts`
- Modify: `src/adapters/bun/launch.ts`

- [ ] **Step 1: Write a failing test for robust Bun inspector launch**

```ts
test("launchBunTarget allocates a non-fixed inspector port and returns a ws_url", async () => {
  const launched = await launchBunTarget(["bun", "run", fixturePath]);
  expect(launched.command[0]).toBe("bun");
  expect(launched.command.some((part) => part.startsWith("--inspect="))).toBe(true);
  expect(launched.ws_url).toMatch(/^ws:\/\//);
  process.kill(launched.pid, "SIGTERM");
});
```

- [ ] **Step 2: Run test to verify it fails for the right reason**

Run: `bun test tests/adapters/bun.launch.test.ts`
Expected: FAIL because the current launcher uses `--inspect` with Bun's default fixed port and does not capture a usable `ws_url`

- [ ] **Step 3: Implement minimal robust launch**

Create a tiny free-port allocator and inject `--inspect=127.0.0.1:<port>` explicitly. Capture early stderr/stdout and extract the inspector URL before considering launch successful.

- [ ] **Step 4: Re-run the launch test**

Run: `bun test tests/adapters/bun.launch.test.ts`
Expected: PASS

### Task 2: Add A Minimal Bun CDP Client And Session Reattach Path

**Files:**
- Create: `src/adapters/bun/cdp.ts`
- Create: `src/adapters/bun/session.ts`
- Modify: `src/kernel/types.ts`
- Modify: `src/kernel/sessions/store.ts`

- [ ] **Step 1: Write failing tests for attach and command send**

Add tests covering:

- session record stores `transport_hint.ws_url`
- Bun session helper can reconnect using stored `ws_url`
- command send/reply path returns parsed JSON responses

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/adapters/bun.cdp.test.ts tests/kernel/records.test.ts`
Expected: FAIL because CDP transport and richer session metadata do not exist yet

- [ ] **Step 3: Implement the minimal transport**

Implement:

- WebSocket connect with request IDs
- `send(method, params)` helper
- event collection for `Debugger.paused` and `Debugger.scriptParsed`
- reattach helper that turns `transport_hint.ws_url` into a live client

- [ ] **Step 4: Re-run the transport tests**

Run: `bun test tests/adapters/bun.cdp.test.ts tests/kernel/records.test.ts`
Expected: PASS

### Task 3: Deliver Breakpoint + Paused-State Commands

**Files:**
- Modify: `src/features/debug/execute.ts`
- Modify: `tests/features/debug.cli.test.ts`
- Create: `tests/features/debug.paused-state.integration.test.ts`
- Create: `tests/fixtures/bun-breakpoint.ts`

- [ ] **Step 1: Write failing command and integration tests**

Add command tests for:

- `debug break <session-id> <file>:<line>`
- `debug continue <session-id>`
- `debug state <session-id>`
- `debug stack <session-id>`
- `debug vars <session-id>`
- `debug eval <session-id> <expression>`

Add negative-path tests for:

- missing session → `session.not_found`
- command requiring pause while running → `session.invalid_state`
- stale or missing paused snapshot → `session.stale_snapshot`

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/features/debug.cli.test.ts tests/features/debug.paused-state.integration.test.ts`
Expected: FAIL because the command surface is not implemented yet

- [ ] **Step 3: Implement the minimal paused-state flow**

Implement:

- set breakpoint through CDP
- continue until `Debugger.paused`
- store paused snapshot in the session record
- return JSON payloads for `state`, `stack`, `vars`, `eval`
- emit investigation events and artifacts for breakpoint hit and paused-state captures

- [ ] **Step 4: Re-run the paused-state suite**

Run: `bun test tests/features/debug.cli.test.ts tests/features/debug.paused-state.integration.test.ts`
Expected: PASS

### Task 4: Dogfood Against Real Bun Targets And Fix The Gaps

**Files:**
- Modify: `tests/features/debug.bun.integration.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add dogfooding-style integration coverage**

Cover:

- launch a Bun script
- set breakpoint
- continue into pause
- inspect state and vars
- evaluate an expression
- stop session cleanly

- [ ] **Step 2: Run the full suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Run manual dogfooding commands**

Run:

```bash
bun run index.ts debug launch -- bun run tests/fixtures/bun-breakpoint.ts
```

Then use the returned `session_id` to run:

```bash
bun run index.ts debug break <session-id> tests/fixtures/bun-breakpoint.ts:<line>
bun run index.ts debug continue <session-id>
bun run index.ts debug state <session-id>
bun run index.ts debug vars <session-id>
bun run index.ts debug eval <session-id> "tracked + 1"
bun run index.ts debug stop <session-id>
```

Expected: every command returns structured JSON and the paused-state commands show real runtime evidence from the Bun fixture.

- [ ] **Step 4: Update README to reflect the new command slice**

Document the now-supported commands:

- `debug break`
- `debug continue`
- `debug state`
- `debug stack`
- `debug vars`
- `debug eval`

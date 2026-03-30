# Node Runtime Debug Design

**Date:** 2026-03-30
**Status:** Draft approved in conversation, pending file review
**Primary audience:** coding agents consuming a CLI

## Goal

Add a real Node runtime backend to `nooa-debugger` using Node Inspector/CDP directly, while preserving the same agent-first JSON contracts already established for Bun.

This slice is not about introducing a DAP dependency for Node. It is about delivering a working Node debugger now, with a stable AI-first surface that can coexist with Bun and later sit behind a broader multi-runtime kernel.

## Approved Direction

The approved V1 direction for Node is:

- use Node Inspector/CDP directly
- keep the existing unified `debug` command family
- keep JSON-only responses
- preserve short-lived CLI commands over persisted sessions
- reuse the existing kernel for sessions, investigations, artifacts, and paused snapshots
- support `attach` by `ws_url` and `host:port`
- defer `attach --pid` to a later slice

## Scope

### In scope

- `debug launch --runtime node -- <command...>`
- `debug launch --runtime node --brk -- <command...>`
- `debug attach --runtime node --ws-url <url>`
- `debug attach --runtime node --host <host> --port <port>`
- `debug pause`
- `debug continue`
- `debug state`
- `debug stack`
- `debug vars`
- `debug eval`
- `debug break`
- `debug stop`
- persisted Node session records in the shared kernel
- paused snapshot persistence and rehydration between CLI invocations
- investigation events and artifacts for Node sessions

### Out of scope

- `attach --pid`
- worker thread orchestration
- child-process tree attach for Node subprocesses
- sourcemap-heavy debugging behavior
- CPU/heap profiling for Node
- stepping commands beyond the existing Bun-focused surface unless they fall out naturally from the same transport layer

## Product Surface

Node must use the same top-level command family as Bun.

Representative V1 surface:

```text
nooa-debugger debug launch --runtime node -- node app.js
nooa-debugger debug launch --runtime node --brk -- node app.js
nooa-debugger debug attach --runtime node --ws-url ws://127.0.0.1:9229/<id>
nooa-debugger debug attach --runtime node --host 127.0.0.1 --port 9229
nooa-debugger debug pause <session_id>
nooa-debugger debug continue <session_id>
nooa-debugger debug state <session_id>
nooa-debugger debug stack <session_id>
nooa-debugger debug vars <session_id>
nooa-debugger debug eval <session_id> --expression "tracked"
nooa-debugger debug break <session_id> --location app.js:42
nooa-debugger debug stop <session_id>
```

The runtime is selected by session metadata, not by a separate `node` command namespace.

## Architecture

### 1. Shared kernel, runtime-specific backend

The existing kernel remains the source of truth for:

- session persistence
- investigation timeline
- artifact persistence
- paused snapshot caching
- JSON response envelopes
- session lifecycle state

The Node backend plugs into that kernel as another runtime adapter.

### 2. Node backend modules

The Node runtime backend should live under `src/adapters/node/` with these responsibilities:

- `launch.ts`
  - spawn `node --inspect=127.0.0.1:0`
  - support `--inspect-brk=127.0.0.1:0`
  - parse runtime stderr/stdout metadata needed to discover the inspector endpoint
- `discovery.ts`
  - resolve `ws_url` from direct input or `host:port`
  - normalize endpoint hints for attach flows
- `cdp.ts`
  - thin Node Inspector/CDP transport
  - request/response correlation
  - event subscription for pause/resume/script parsing
- `session.ts`
  - map Node CDP into AI-first operations: `pause`, `continue`, `state`, `stack`, `vars`, `eval`, `break`
  - normalize Node paused state to the same JSON shape used by Bun where possible

### 3. Shared JSON shape

The AI-facing output for Node should match Bun as closely as possible for:

- paused state
- stack frames
- local variables
- evaluation results
- breakpoint metadata
- transport health

An agent should not need runtime-specific reasoning for ordinary read/control commands once the session is established.

## Session Model

Node sessions must reuse the shared session record model and add only the runtime-specific fields needed for Inspector transport.

Representative Node session record fields:

- `session_id`
- `adapter = "node"`
- `runtime = "node"`
- `root_command`
- `root_pid`
- `target_pid`
- `transport_hint.ws_url`
- `transport_hint.host`
- `transport_hint.port`
- `current_investigation_id`
- `last_known_state`
- `paused_snapshot`

### Attach model

V1 attach rules:

- `--ws-url` attaches directly to a known inspector WebSocket
- `--host` + `--port` resolve the inspector endpoint before transport creation
- `--pid` is intentionally unsupported in V1

This keeps the attach path explicit, cross-platform, and easy for agents to reason about.

## Investigation And Artifact Model

Node uses the same evidence model as Bun.

Required behavior:

- `debug launch` creates a new investigation by default unless one is supplied
- `debug attach` binds to the provided investigation or the session's current investigation
- state-changing commands append investigation events
- commands that capture fresh runtime evidence emit artifacts
- read-only commands can return persisted evidence without forcing a new artifact unless a new snapshot is taken

Representative Node artifacts:

- launch artifact
- attach artifact
- paused snapshot artifact
- eval artifact
- breakpoint artifact

## Error Contract

The Node slice must use stable machine-readable error codes.

Required V1 codes:

- `session.not_found`
- `session.invalid_state`
- `transport.unreachable`
- `transport.closed`
- `runtime.not_supported`
- `break.invalid_location`
- `snapshot.stale`

Node-specific transport failures may include additional detail in metadata, but they should still map into these stable top-level categories where appropriate.

## Runtime Semantics

### Launch

`debug launch --runtime node` starts a Node process with inspector enabled on an ephemeral localhost port.

The launcher must:

- discover the actual inspector endpoint
- persist `ws_url` in the session record
- leave the target process alive after the CLI process exits
- support both normal start and `--brk`

### Pause / Continue

`pause` and `continue` operate over live Node Inspector transport.

The paused snapshot becomes stale as soon as execution resumes.
If the transport is lost, the command must fail with a structured transport error instead of returning partial evidence.

### Breakpoints

V1 supports file-and-line breakpoints through the Node Inspector runtime.

Breakpoint handling must:

- normalize file locations into a stable stored representation
- persist breakpoint metadata in the session record
- survive short-lived CLI invocations

### Eval

`eval` runs in the currently paused call frame.
The result must be normalized into the same AI-first result structure already used by Bun.

## Testing And Dogfooding

Minimum required verification for the Node slice:

- unit tests for Node launch/discovery/CDP/session layers
- integration test: `launch -> pause -> state -> eval -> stop`
- integration test: `launch --brk -> continue`
- integration test: future callback breakpoint hit
- integration test: attach by `ws_url`
- integration test: paused snapshot rehydration across CLI invocations

Manual dogfooding must confirm that the CLI stays short-lived while the target and debugger session remain usable across separate invocations.

## Non-Goals For This Slice

This design intentionally does not solve:

- Node subprocess tree control
- automatic worker-thread tracking
- advanced sourcemap semantics
- a DAP-based Node backend
- adapter packaging or vendoring for VS Code JavaScript debugger components

Those are later slices.

## Acceptance Criteria

The Node V1 slice is complete when all of the following are true:

- a Node process can be launched and inspected through the unified `debug` CLI
- a running Node session can be attached by `ws_url` or `host:port`
- `pause`, `continue`, `state`, `stack`, `vars`, `eval`, and `break` return stable JSON
- session and snapshot persistence work across short-lived CLI invocations
- investigations and artifacts are produced using the shared kernel
- the Node backend does not require a third-party DAP adapter to function

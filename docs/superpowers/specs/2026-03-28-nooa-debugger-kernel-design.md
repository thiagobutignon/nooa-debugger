# NOOA Debugger Kernel Design

**Date:** 2026-03-28
**Status:** Draft approved in conversation, pending file review
**Primary audience:** coding agents consuming a CLI

## Goal

Create `nooa-debugger`, a Bun-based, agent-first debugging system that feels closer to Xcode Instruments than a traditional human CLI. The product must start with Bun, but the architecture must be multi-runtime from day one so it can grow into TypeScript, JavaScript, Swift, Android, Java, Rust, Go, and related ecosystems without a rewrite.

The CLI is for AI agents, not humans. The base contract is structured machine output.

## Approved Product Direction

The V1 direction is:

- multi-runtime kernel with adapters
- Bun as the first real adapter
- `debug`, `profile`, and `trace` in the first release
- short-lived CLI commands over persistent sessions
- local processes plus subprocess tree targeting
- investigation timeline and atomic artifacts together
- JSON-only primary contract

## Product Shape

The top-level product shape is:

```text
nooa-debugger <command> <subcommand> [args] [flags]
```

V1 command families:

- `debug`: create, control, and inspect live sessions
- `profile`: capture and compare runtime cost evidence
- `trace`: capture compact execution traces and process-tree evidence
- `investigation`: aggregate events and evidence across a debugging workflow
- `artifact`: list and fetch individual evidence objects

Representative V1 surface:

```text
nooa-debugger debug launch|attach|status|stop
nooa-debugger debug break|break-ls|break-rm|run-to|continue|step|pause
nooa-debugger debug state|stack|vars|eval|source|exceptions|targets
nooa-debugger profile capture|diff
nooa-debugger trace capture
nooa-debugger investigation create|show|events|close
nooa-debugger artifact get|list
```

## Architecture

### 1. Single kernel, multiple runtime adapters

The system must have one kernel that owns:

- session lifecycle
- attach and reattach
- process tree discovery
- transport lifecycle
- breakpoint and stepping orchestration
- paused-state caching
- stable short refs for frames, values, and breakpoints
- investigation and artifact recording

Runtimes plug into this kernel through adapters. Bun is the first adapter, not a one-off implementation.

Initial adapter roadmap:

- `bun/` for V1
- `node/` next, sharing the same core contracts where possible
- later: `lldb/`, `jvm/`, `delve/`, Android-focused adapters

### 2. Two planes: control and evidence

The system has two cooperating planes.

**Control plane**

- session registry
- target launcher
- attach resolver
- process tree watcher
- transport manager
- breakpoint and step controller
- paused-state cache
- ref allocator

**Evidence plane**

- investigation timeline
- artifact store
- debug snapshots
- trace captures
- profile captures
- source, stack, variable, and exception evidence

This separation matters because command control and evidence persistence evolve at different rates but must stay interoperable.

## Core State Model

The system must explicitly separate these three states:

1. `session record`
2. `live transport`
3. `paused snapshot`

They are not interchangeable.

### Session record

Persisted metadata describing a session, such as:

- `session_id`
- `adapter`
- `runtime`
- `root_command`
- `root_pid`
- `target_pid`
- `transport_hint`
- `breakpoints`
- `current_investigation_id`
- `last_known_state`

### Live transport

The active runtime connection for the current command invocation. This may need to be reconstructed from the session record, but it is not the same thing as the session record.

### Paused snapshot

The current runtime evidence captured when execution is paused:

- source location
- stack frames
- locals
- exception info
- runtime refs
- selected target process

This snapshot becomes stale as soon as execution resumes.

## Investigation Model

The primary debugging workflow unit is an `investigation`, but every meaningful operation also creates atomic artifacts.

This is intentional. Agents need both views:

- a timeline view for reasoning about a whole debugging session
- artifact-level access for pipelines, prompts, comparisons, and follow-up operations

### Investigation responsibilities

- group related debug/profile/trace events
- preserve temporal order
- link commands, snapshots, errors, and derived artifacts
- make replay and analysis possible later

### Artifact responsibilities

- persist one evidence payload with stable schema
- be individually addressable by `artifact_id`
- support export, retrieval, and comparison

### Relationship

The V1 binding model must be deterministic.

- `debug launch` creates a new `investigation_id` by default unless one is explicitly provided
- `debug attach` requires either an explicit `investigation_id` or binds to the session's `current_investigation_id`
- state-changing `debug` commands must append an investigation event and emit at least one artifact when they materially change runtime state or capture new evidence
- `profile capture` and `trace capture` must always append an investigation event and emit at least one artifact
- read-only commands such as `debug status`, `debug break-ls`, `artifact get`, and `investigation show` do not need to create artifacts unless explicitly asked to snapshot state

This rule exists to prevent orphaned artifacts and incomplete investigation timelines.

## Output Contract

The CLI exists for AI agents. Human-friendly text is not the base contract.

The default and only V1 output contract is structured JSON with stable schemas per command family. Output-mode negotiation is out of scope for V1. Commands should return JSON without requiring `--json`.

Every important response should include navigational identifiers where relevant:

- `session_id`
- `investigation_id`
- `artifact_id`
- `runtime`
- `target`
- `process_tree`
- `created_at`
- `related_artifacts`

Debugger-specific responses may also include:

- `paused_ref`
- `frame_refs`
- `value_refs`
- `breakpoint_refs`

These fields allow an agent to continue a debugging workflow without reparsing free-form prose.

## Session State and Error Contract

Commands must operate against an explicit session state model.

Primary session states:

- `created`: session record exists but transport is not yet connected
- `running`: transport is live and target is executing
- `paused`: transport is live and paused snapshot is available
- `exited`: target exited and transport is closed
- `transport_lost`: session record exists but transport could not be rehydrated

Command preconditions:

- `debug state|stack|vars|eval|source|exceptions` require `paused`
- `debug continue|step|run-to|pause` require a live transport and fail on `created` or `exited`
- `debug break|break-rm|break-ls` require a valid session record; setting/removing breakpoints may work in either `running` or `paused`
- `debug status` must always succeed if the session record exists, even if transport rehydration fails

Required JSON error codes for V1:

- `session.not_found`
- `session.invalid_state`
- `session.transport_lost`
- `session.stale_snapshot`
- `runtime.target_exited`
- `runtime.attach_failed`
- `runtime.unsupported_platform`
- `runtime.unsupported_operation`
- `refs.invalid`
- `storage.conflict`

Every error response must include:

- `code`
- `message`
- `session_id` when known
- `investigation_id` when known
- `recoverable` boolean
- `suggested_next_commands` array when recovery is possible

## Refs

Short refs improve ergonomics for agents and keep command payloads compact.

Examples:

- frames: `@f0`
- values: `@v3`
- breakpoints: `BP#2`

Rules:

- refs are session-local
- refs are ephemeral
- refs are valid only within the current live session state
- persisted artifacts must store normalized values, not only refs

## Repository Shape

The project should mirror the best structural ideas from `nooa-the-pragmatic`, but narrower and more focused:

```text
index.ts
src/
  core/
    command.ts
    registry.ts
    command-builder.ts
    json-output.ts
    errors.ts
  kernel/
    sessions/
    investigations/
    artifacts/
    process-tree/
    refs/
    storage/
  adapters/
    bun/
  features/
    debug/
    profile/
    trace/
    investigation/
    artifact/
docs/
  features/
scripts/
```

The command layer stays thin. Core behavior belongs either in `kernel/` or in runtime `adapters/`.

## Persistent Storage Layout

The system should keep its data under a dedicated workspace directory:

```text
.nooa-debugger/
  sessions/
  investigations/
  artifacts/
  blobs/
  index/
```

Suggested persistence layout:

- `.nooa-debugger/sessions/<session-id>.json`
- `.nooa-debugger/investigations/<investigation-id>/timeline.ndjson`
- `.nooa-debugger/artifacts/<artifact-id>.json`
- `.nooa-debugger/blobs/...`
- `.nooa-debugger/index/...`

### Persistence rules

Every persisted record type must include `schema_version`.

V1 persistence guarantees:

- session and artifact records must be written via atomic temp-file-plus-rename semantics
- investigation timeline appends must be line-oriented NDJSON appends guarded by a per-investigation lock
- session mutation must be guarded by a per-session lock to prevent concurrent short-lived CLI invocations from corrupting state
- blobs must be content-addressed or assigned stable IDs and referenced from artifact metadata
- incompatible future schema changes must fail with a machine-readable migration error rather than silently reading partial state

Migration policy:

- V1 can support only `schema_version: 1`
- future versions must either provide an explicit migrator or reject with `storage.migration_required`

### Why split `artifacts` and `blobs`

The metadata payload should stay small and indexable. Larger raw captures such as profile payloads, source dumps, trace chunks, or binary attachments belong in `blobs/`, referenced from the artifact record.

## Bun V1 Scope

The first real adapter is Bun. It must support real behavior in these areas:

- launch and attach for local Bun processes
- control of pause, continue, step, breakpoint, and eval
- profile capture for Bun scripts and Bun tests
- trace capture with subprocess tree awareness
- target selection when the interesting runtime is not the root process

The Bun adapter should treat `bun run` and `bun test` as different launch shapes inside one adapter, not separate products.

### Bun V1 platform matrix

Supported V1 platforms:

- macOS: first-class support
- Linux: first-class support

Deferred for later:

- Windows native support

Platform notes:

- attach and subprocess discovery depend on OS process inspection primitives and may require different implementations per platform
- V1 tests must pass on macOS and Linux before the adapter is considered stable
- unsupported platforms must fail with `runtime.unsupported_platform` rather than degraded undefined behavior

## V1 Non-Goals

The first release must explicitly not promise:

- Swift, LLDB, Java, Go, Rust, or Android runtime support
- remote or container-first attach as a primary workflow
- a separate daemon process as a required architecture element
- UI or TUI for humans
- hotpatching or runtime mutation as a V1 capability
- magical sourcemap repair

These can come later once the kernel/session model is stable.

## Quality Bar

The V1 quality bar must be operational, not cosmetic.

Required end-to-end outcomes:

1. `debug launch` starts a real Bun-backed session and returns a usable `session_id`
2. `debug break` plus `continue` pauses at a real file and line
3. `debug state`, `vars`, `stack`, and `eval` still work after reattach from a fresh CLI invocation
4. `profile capture` creates usable evidence for both `bun run` and `bun test`
5. `trace capture` records root process, selected target, and subprocess tree evidence
6. one investigation can link multiple debug, profile, and trace artifacts from the same failure or exploratory session

## Testing Strategy

The testing strategy must prioritize runtime truth over mocked confidence.

Test layers:

- unit tests for parsing, ref allocation, and storage behavior
- unit tests for session state transitions
- adapter contract tests
- real Bun integration tests against fixtures

Representative Bun integration scenarios:

1. launch with break-on-start
2. set breakpoint by file and line
3. continue into breakpoint
4. inspect state
5. inspect stack
6. inspect vars
7. evaluate expression
8. reattach from a new CLI process
9. capture profile for `bun run`
10. capture profile for `bun test`
11. capture trace including subprocess discovery
12. recover correctly after transport loss
13. reject invalid refs with stable JSON errors
14. detect stale snapshots after execution resumes
15. handle concurrent CLI invocations against the same session without corrupting state
16. select the intended subprocess when the interesting target is not the root process

## Recommended Delivery Sequence

Build in this order:

1. core CLI contracts and JSON output discipline
2. kernel storage, IDs, and record schemas
3. session registry and reattach model
4. Bun adapter launch and attach
5. `debug launch|status|stop`
6. breakpoint and stepping flow
7. paused-state inspection commands
8. investigation and artifact persistence wiring
9. `trace capture`
10. `profile capture`
11. `profile diff`
12. docs and dogfooding

This sequence gets real debugger value early while preserving the long-term kernel direction.

## Why This Direction

The architectural bet is that debugging for agents should be treated as a platform capability, not a pile of per-runtime tools. The CLI command is short-lived, but the runtime target and investigation context are warm. That operating model is the stable center of the system.

If this holds, Bun is only the first adapter on top of a reusable debugging kernel rather than the first special case in a growing mess.

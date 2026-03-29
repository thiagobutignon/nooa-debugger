# NOOA Debugger

Agent-first debugger kernel for Bun-first runtime investigation.

## Current Slice

- `debug launch`
- `debug pause`
- `debug break`
- `debug continue`
- `debug state`
- `debug stack`
- `debug vars`
- `debug eval`
- `debug status`
- `debug stop`
- `investigation create`
- `investigation show`
- `artifact list`
- `artifact get`

## Bun Status

- Verified: robust Bun inspector launch, persisted `ws_url`, long-lived bridge process per session, real pause-on-demand via `Debugger.pause`, paused-snapshot persistence, and JSON contracts for `pause|state|stack|vars|eval`.
- Verified by tests: adapter/unit coverage for Bun launch, CDP transport, scriptId-to-url rehydration, session attach helpers, and CLI state/error handling.
- Verified by dogfooding on Bun `1.3.10`: `debug launch -> debug pause -> debug state -> debug eval -> debug stop` now works end to end against a live Bun target.
- Still runtime-limited on Bun `1.3.10`: the inspector did not emit a usable `Debugger.paused` event for the short-CLI `Debugger.setBreakpointByUrl` / plain `debugger;` workflow that depends on cold reattach semantics.

The current Bun slice is reliable for agent-first `pause`/inspection flows over a live bridge. Breakpoint-first flows still need deeper reverse-engineering of Bun's runtime/frontend behavior.

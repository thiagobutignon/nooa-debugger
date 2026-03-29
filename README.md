# NOOA Debugger

Agent-first debugger kernel for Bun-first runtime investigation.

## Current Slice

- `debug launch`
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

- Verified: robust Bun inspector launch, persisted `ws_url`, CDP request/response handling, breakpoint metadata persistence, paused-snapshot schema, and JSON contracts for `state|stack|vars|eval`.
- Verified by tests: adapter/unit coverage for Bun launch, CDP transport, session attach helpers, and CLI state/error handling.
- Blocked in live dogfooding on Bun `1.3.10`: the inspector did not emit a usable `Debugger.paused` event for `Debugger.setBreakpointByUrl` or a plain `debugger;` statement in this workflow.
- Additional probe: `Debugger.pause` only produced `Debugger.paused` after a follow-up `Runtime.evaluate("")`, and that pause landed in injected inspector code rather than user frames.

The paused-state command surface is implemented, but end-to-end live Bun pause/breakpoint flows remain runtime-blocked until this inspector behavior is worked around or fixed upstream.

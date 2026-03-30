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
- Verified: the CLI entrypoint is now truly short-lived in real dogfooding. `debug launch` exits cleanly while keeping both the Bun target and the bridge daemon alive via `detached + unref`.
- Verified: `debug launch|status|stop` now surface daemon/bridge state in JSON (`running`, `pid`, `host`, `port`) so short-lived agent calls can reason about transport health explicitly.
- Verified: `debug launch --brk` now releases Bun's waiting state correctly through `Inspector.initialized`, so a later `debug continue` can reach the real user breakpoint instead of getting stuck on startup pause.
- Verified by tests: adapter/unit coverage for Bun launch, CDP transport, scriptId-to-url rehydration, session attach helpers, and CLI state/error handling.
- Verified by dogfooding on Bun `1.3.10`: `debug launch -> debug pause -> debug state -> debug eval -> debug stop`, `debug break -> debug continue`, and `debug launch --brk -> debug break -> debug continue` all work end to end against a live Bun target.
- Refined runtime limit on Bun `1.3.10`: future callback pauses work for both `Debugger.setBreakpointByUrl` and plain `debugger;`, but the inspector still does not emit a usable `Debugger.paused` event for module continuation after top-level `await`.

The current Bun slice is reliable for agent-first pause, breakpoint, and `--brk` flows over a live bridge. The remaining Bun-specific gap is narrower now: top-level-await continuation still needs deeper reverse-engineering.

## DAP Status

- LLDB/native: a real `lldb-dap` stdio session launcher now exists under `src/adapters/dap-lldb/live.ts`. Contract tests run in the default suite, and an opt-in live integration test (`NOOA_RUN_LLDB_LIVE=1`) was dogfooded successfully outside the sandbox with `launch -> pause -> vars -> eval`.
- Node/JS/TS: the local `ms-vscode.js-debug-nightly` extension was assessed and is not a clean standalone DAP daemon. The repo now has shared DAP stdio/process plumbing ready for a real adapter once we choose one.
- JVM: the contract-first backend remains in place, but this machine does not currently have a usable JVM runtime/debug adapter combination for real integration without adding tooling.

## Homunculus Plugin

This repo now vendors a local Claude Code plugin snapshot under `plugins/homunculus/` and exposes a matching marketplace manifest at `.claude-plugin/marketplace.json`.

Use the local checkout as the plugin source, then install `homunculus@homunculus` and run `/homunculus:init` in Claude Code. The vendored snapshot matches upstream `humanplane/homunculus` `2.0.0-alpha`.

# js-debug-nightly Standalone Assessment

**Date:** 2026-03-29

This note captures whether the local `ms-vscode.js-debug-nightly` extension can be reused as a standalone DAP server for the Node slice in `nooa-debugger`.

## Findings

The installed extension at `~/.vscode/extensions/ms-vscode.js-debug-nightly-2026.3.2407` is packaged as a VS Code extension, not as a standalone DAP daemon.

- Its extension entrypoint is `~/.vscode/extensions/ms-vscode.js-debug-nightly-2026.3.2407/src/extension.js` via the `main` field in `package.json`.
- The adapter is created through VS Code debug APIs in the extension host, via `createDebugAdapterDescriptor(...)` in `src/extension.js`.
- The normal transport is a VS Code `DebugAdapterNamedPipeServer`.
- A local TCP fallback exists only when `JS_DEBUG_USE_LOCAL_DAP_PORT` is set, in which case the extension returns `DebugAdapterServer(+port)`.

## Transport

- Default: named pipe
- Optional fallback: localhost TCP port
- Not observed: stdio as a standalone adapter transport

## Risks And Limitations

- The bundle imports and relies on `vscode`, so it is not runnable as an isolated Node process without the extension host.
- The DAP server is not exposed as a documented CLI entrypoint.
- `JS_DEBUG_USE_LOCAL_DAP_PORT` looks like an internal knob, not a supported external contract.
- The shipped `watchdog.js` is an inspector/WebSocket bridge for the target process, not the DAP server itself.

## Recommendation

Do not build `nooa-debugger` around this extension as a standalone adapter process.

Keep the local Node slice as its own backend and protocol layer, and treat `js-debug-nightly` only as a behavior reference for later compatibility checks.

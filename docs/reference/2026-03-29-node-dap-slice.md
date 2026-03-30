# Node DAP Slice

This repository now includes a small Node-oriented debugger backend slice under `src/adapters/dap-node/`.

## Scope

The slice is intentionally library-only:

- a transport-agnostic DAP client abstraction
- a small backend facade that describes AI-first debugger commands
- no real process spawning
- no Bun runtime dependency

## Command Mapping

The backend models the following debugger concepts:

- `launch` -> `initialize` + `launch`
- `attach` -> `initialize` + `attach`
- `pause` -> `pause`
- `continue` -> `continue`
- `state` -> `stackTrace` + `scopes` + `variables`
- `stack` -> `stackTrace`
- `vars` -> `scopes` + `variables`
- `eval` -> `evaluate`

The intent is to keep the surface machine-readable first so an AI agent can reason about debugger actions without hand-written CLI glue.

## Non-Goal

This slice does not start or attach to Node processes yet. It only defines the protocol and the backend mapping layer that a launcher can consume later.

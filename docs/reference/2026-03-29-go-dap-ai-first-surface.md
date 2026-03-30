# Go DAP AI-First Surface

This document defines the standalone Go backend slice under `src/adapters/dap-go/`.
It is intentionally isolated from the Bun implementation and does not start Delve or
manage process lifecycles yet.

## Scope

The slice exposes a small DAP client and a higher-level session facade that maps the
AI-first debugger surface to Delve-compatible DAP requests.

Supported verbs in this round:

- `launch`
- `attach`
- `pause`
- `continue`
- `state`
- `stack`
- `vars`
- `eval`

## Mapping

| AI-first verb | DAP request flow | Normalized output |
| --- | --- | --- |
| `launch` | `launch` | `SessionState` after the session is refreshed |
| `attach` | `attach` | `SessionState` after the session is refreshed |
| `pause` | `pause` with the selected thread id | `SessionState` after refresh |
| `continue` | `continue` with the selected thread id | `SessionState` after refresh |
| `state` | `threads`, then `stackTrace` on the first thread when it is stopped | `SessionState` |
| `stack` | `stackTrace` on the selected thread | `StackResult` |
| `vars` | `scopes`, then `variables` for each scope with a variables reference | `VarsResult` |
| `eval` | `evaluate` using the selected paused frame | `EvalResult` |

## Normalization Rules

- `state` uses the first returned thread as the selected thread.
- If `stackTrace` returns frames for that thread, the session is treated as `paused`.
- If `stackTrace` fails or returns no frames, the session is treated as `running`.
- `stack` and `eval` operate on the currently selected paused thread and frame.
- `vars` flattens scope variables into a single agent-friendly list while preserving scope names.
- `eval` returns a single string value and optional type string, not raw DAP payloads.

## Non-Goals

- launching Delve itself
- spawning or supervising target processes
- breakpoint management
- stepping
- persistent session storage
- shared kernel refactors

## Notes

This slice is a contract layer first. The fake transport tests prove the request/response
shape and the normalization logic without requiring a live Delve binary in CI.

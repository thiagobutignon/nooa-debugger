# JVM DAP Contract-First Slice

This slice defines a JVM backend contract for `nooa-debugger` without wiring in a real local launcher. The goal is to pin down the AI-first JSON surface now so a future JVM launcher or remote adapter can plug into the same facade.

## Scope

The backend is modeled as a DAP-oriented facade for Java and Kotlin targets. It accepts launch or attach intent, speaks in DAP request/response terms internally, and returns JSON-safe results that agents can consume directly.

Supported command mapping:

| AI-first command | DAP request sequence | Result shape |
| --- | --- | --- |
| `launch` | `initialize` -> `launch` -> `configurationDone` | `endpoint`, `capabilities`, `commands` |
| `attach` | `initialize` -> `attach` -> `configurationDone` | `endpoint`, `capabilities`, `commands` |
| `pause` | `pause` -> `stackTrace` -> `scopes` -> `variables` | `state: "paused"` plus paused snapshot |
| `continue` | `continue` | `state: "running"` |
| `state` | cached paused snapshot, if present | `state`, `top_frame`, `frames`, `locals` |
| `stack` | `stackTrace` | refreshed `frames` inside the paused snapshot |
| `vars` | `scopes` -> `variables` | refreshed `locals` inside the paused snapshot |
| `eval` | `evaluate` | `{ value, type }` |

## AI-First JSON Shape

The facade returns data that is already ready for agent consumption:

```json
{
  "endpoint": {
    "transport": "dap",
    "adapter": "dap-jvm",
    "mode": "launch"
  },
  "capabilities": {
    "launch": true,
    "attach": true,
    "pause": true,
    "continue": true,
    "state": true,
    "stack": true,
    "vars": true,
    "evaluate": true,
    "notes": [
      "Java and Kotlin share the same DAP surface.",
      "Stack and variable inspection require a paused thread.",
      "This slice is contract-first and does not bundle a local JVM launcher."
    ]
  },
  "commands": []
}
```

Paused snapshots use stable refs so an agent can chain follow-up commands without parsing prose:

- `top_frame.frame_ref`
- `frames[].frame_ref`
- `locals[].frame_ref`
- `selected_thread_id`

## JVM Notes

Java and Kotlin both fit the same DAP surface here. The difference is in the source and frame details, not in the command model.

- `launch` expects a `mainClass`, `classPath`, optional `vmArgs`, optional `args`, and optional `sourcePaths`.
- `attach` expects a live JVM debug endpoint, typically JDWP over a socket.
- `stack` preserves frame order from the paused thread and keeps the top frame first.
- `vars` resolves locals for a selected frame ref, which keeps the model stable across Java and Kotlin synthetic frames.
- `eval` is intended for paused execution only.

Capability notes for this slice:

- The facade assumes the DAP server advertises `configurationDone` support.
- `evaluate` is treated as available when the DAP server supports hover evaluation, variable assignment, or an equivalent paused-state evaluation path.
- This slice does not implement a launcher or connector for a real JVM process. That belongs in a future adapter-specific execution slice.

## Contract Boundaries

This backend slice is intentionally isolated.

- It does not change the shared CLI wiring.
- It does not add a real JVM launcher.
- It does not assume any shared backend registry beyond the local contract files in `src/adapters/dap-jvm/`.

The next implementation layer can swap the fake transport for a real DAP endpoint without changing the outward JSON contract documented here.

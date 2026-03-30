# LLDB DAP Contract

This slice started as a contract-first facade over an injected `lldb-dap` endpoint.
It now also has a live stdio launcher in [`src/adapters/dap-lldb/live.ts`](/Users/thiagobutignon/dev/nooa-debugger/src/adapters/dap-lldb/live.ts) for local/native dogfooding while keeping the facade transport-injectable and testable.

## Command Mapping

### `launch`

AI-first input:

```json
{
  "program": "/work/app",
  "args": ["--mode", "debug"],
  "cwd": "/work",
  "stopOnEntry": true,
  "env": { "RUST_BACKTRACE": "1" }
}
```

Mapped DAP sequence:

1. `initialize`
2. `launch`
3. `configurationDone`

Notes:
- `program` is the executable or entry script.
- `args` are forwarded unchanged.
- `stopOnEntry` maps to DAP launch behavior, not to a local shell wrapper.
- The live launcher starts `/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap` over stdio by default.
- The current client deliberately does not advertise `runInTerminal`; launch stays inside the adapter process.

### `attach`

AI-first input:

```json
{
  "pid": 1442,
  "cwd": "/work"
}
```

Mapped DAP sequence:

1. `initialize`
2. `attach`
3. `configurationDone`

Use `attach` for live native, Swift, or Rust processes that already have a compatible debug server attached or exposed.

### `pause`

Mapped DAP sequence:

1. `pause`
2. wait for `stopped`
3. `stackTrace`
4. `scopes`
5. `variables`

The paused snapshot becomes the source of truth for `state`, `stack`, `vars`, and `eval`.

### `continue`

Mapped DAP sequence:

1. `continue`
2. wait for `stopped`
3. `stackTrace`
4. `scopes`
5. `variables`

If no stop event arrives, the session is treated as running.

### `state`

If the facade already has a paused snapshot, `state` returns that cached JSON.
Otherwise it falls back to `threads` and reports the session as running.

### `stack`

Returns the paused snapshot's stack frames.
It is a read view over paused state, not a separate debugger transition.

### `vars`

Returns locals for the selected paused frame.
Scope variables are flattened into a stable AI-first list with `name`, `value`, `type`, and `variablesReference`.

### `eval`

Runs DAP `evaluate` against the selected paused frame.
The result is returned as a normalized string plus optional type metadata.

## LLDB-Specific Capability Notes

- Swift targets usually map cleanly through stack frames, scopes, and variables when debug info is present.
- Rust targets depend heavily on the build having usable debuginfo; optimized locals may be omitted or synthetic.
- Native targets use the same mapping and are the least surprising path for this contract.
- This facade intentionally avoids inventing language-specific parsing. The DAP server stays authoritative for source paths, frame names, and variable payloads.
- The slice does not assume step-back, reverse execution, or other advanced debugger behavior.
- Live launch and attach were verified locally outside the sandbox; sandboxed attach on macOS can fail with adapter errors such as `no such process`.

## AI-First JSON Shape

The facade returns normalized JSON that keeps the control flow obvious to agents:

- `launch` and `attach` return the DAP request envelope and capability notes.
- `pause` and `continue` return a paused snapshot or running state.
- `state` returns either cached paused state or a running summary.
- `stack`, `vars`, and `eval` are read operations over the paused snapshot.

This keeps the LLDB-family slice AI-first while the real `lldb-dap` transport stays isolated behind the same facade.

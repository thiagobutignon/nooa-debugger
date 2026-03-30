---
name: nooa-debugger-node
description: Use when debugging Node targets with nooa-debugger; Inspector/CDP launch and attach, paused snapshots, file:line breakpoints, and call-frame evaluation.
---

# nooa-debugger-node

Use this skill when the target runtime is Node in this repository.

## Use the Node control loop

- `debug launch --runtime node -- <command...>`
- `debug launch --runtime node --brk -- <command...>`
- `debug attach --runtime node --ws-url <url>`
- `debug attach --runtime node --host <host> --port <port>`
- `debug pause`, `debug continue`, `debug state`, `debug stack`, `debug vars`, `debug eval`, `debug break`, `debug stop`

## Node-specific rules

- Enable `Runtime` and `Debugger` before relying on paused snapshots.
- Treat the Node bridge as long-lived and the CLI as short-lived.
- Keep `Debugger.paused` handling buffered so a pause can be observed before the agent reads it.
- Resolve script ids with `Debugger.scriptParsed` so paused frames and breakpoints can be mapped back to file URLs.
- Use `ws_url` when it exists; use `host:port` only as an attach hint that must be resolved first.
- Prefer `debug launch --runtime node --brk -- ...` when the agent must set breakpoints before the target executes meaningful module code.

## Evaluation and breakpoints

- `eval` must run in the current paused call frame.
- `break` must normalize `file:line` into the inspector breakpoint request.
- Node breakpoint requests must resolve to inspector file URLs rather than raw filesystem paths.

## What to capture

- paused snapshot with top frame and locals
- raw call frames
- eval result on the current call frame
- breakpoint metadata returned by the inspector

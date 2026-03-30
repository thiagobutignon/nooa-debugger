---
name: nooa-debugger-bun
description: Use when debugging Bun targets with nooa-debugger; launch/attach over Bun Inspector, bridge health, pause/continue, breakpoints, and known Bun-specific limits.
---

# nooa-debugger-bun

Use this skill when the target runtime is Bun and the repo says the Bun slice is verified.

## Use the Bun control loop

- `debug launch` to start the target with the Bun inspector bridge
- `debug pause` to force a paused snapshot
- `debug break` to bind file:line breakpoints
- `debug continue` to resume to the next useful pause
- `debug state`, `debug stack`, `debug vars`, `debug eval` to inspect the paused frame

## Bun-specific rules

- Treat the bridge as long-lived and the CLI as short-lived.
- Prefer the persisted paused snapshot when the target is already paused.
- Use `Inspector.initialized` to release `--brk` startup pause before waiting for the real user breakpoint.
- If the runtime shows a top-level `await` continuation gap, treat that as a Bun limitation unless the repo README says it was fixed.

## What to capture

- `ws_url` and daemon health
- paused snapshot
- breakpoint metadata
- eval result tied to the paused call frame

## What not to assume

- Do not assume every `debugger;` statement is equally reliable in Bun.
- Do not assume a pause failure is a nooa-debugger bug until the Bun runtime behavior has been reproduced with the smallest fixture.

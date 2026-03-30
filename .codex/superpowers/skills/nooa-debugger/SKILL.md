---
name: nooa-debugger
description: Use when investigating code with the nooa-debugger CLI; gives the agent-first loop for launch/attach, pause/continue, state/stack/vars/eval, breakpoint evidence, and runtime selection across Bun and Node.
---

# nooa-debugger

Use this skill when the task is to debug or inspect a program with `nooa-debugger`.

## Pick the runtime skill

- Bun targets: use [nooa-debugger-bun](../nooa-debugger-bun/SKILL.md)
- Node targets: use [nooa-debugger-node](../nooa-debugger-node/SKILL.md)
- Anything else: check [runtime capabilities](references/runtime-capabilities.md) first and do not assume support

## Agent-first loop

1. `debug launch` or `debug attach`
2. `debug pause` or `debug break`
3. `debug state`, `debug stack`, `debug vars`, `debug eval`
4. Capture the smallest useful artifact
5. `debug continue` or `debug stop`

## Output contract

- Prefer JSON-only output.
- Treat session ids, transport hints, paused snapshots, and artifacts as machine-readable evidence.
- Do not optimize for human interactivity; optimize for a controller agent making short-lived CLI calls.

## Evidence rules

- Reuse an existing session when the session record is still valid.
- If a snapshot is stale or the transport is closed, report that failure directly instead of guessing.
- Keep breakpoint, pause, and eval evidence separate unless the command naturally produces a fresh snapshot.

## Current supported runtimes

- Bun
- Node

If a runtime is not listed in the capability note, treat it as unsupported until the repo explicitly says otherwise.

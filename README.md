# NOOA Debugger

Agent-first debugger kernel for CLI-driven investigation. The design goal is to give coding agents a stable, JSON-first control surface for launching, pausing, inspecting, continuing, and capturing debugger state across runtimes.

## Quick Start

```bash
bun install
bun run index.ts debug backends
```

The CLI prints JSON on stdout. A failed command returns a JSON error object and a non-zero exit code.

## CLI Cheat Sheet

### Launch a target

```bash
bun run index.ts debug launch -- bun run tests/fixtures/bun-idle.ts
bun run index.ts debug launch --runtime node -- node tests/fixtures/node-idle.js
bun run index.ts debug launch --runtime node --brk -- node tests/fixtures/node-breakpoint.js
```

### Inspect a session

```bash
bun run index.ts debug status <session_id>
bun run index.ts debug state <session_id>
bun run index.ts debug stack <session_id>
bun run index.ts debug vars <session_id>
bun run index.ts debug eval <session_id> "globalThis.__tracked"
```

### Control execution

```bash
bun run index.ts debug pause <session_id>
bun run index.ts debug continue <session_id>
bun run index.ts debug break <session_id> tests/fixtures/bun-idle.ts:3
bun run index.ts debug stop <session_id>
```

### Investigation and artifacts

```bash
bun run index.ts investigation create
bun run index.ts investigation show <investigation_id>
bun run index.ts artifact list <investigation_id>
bun run index.ts artifact get <artifact_id>
```

## Recommended Agent Flow

1. Launch the target with `debug launch` and capture the returned `session_id`.
2. Read `debug status` or `debug state` before taking action.
3. Use `debug pause`, `debug break`, `debug continue`, `debug stack`, `debug vars`, and `debug eval` to collect evidence.
4. Prefer short, repeatable JSON interactions over interactive debugging.
5. Stop the session with `debug stop` once the investigation is complete.

## Local Storage

The CLI persists state under `.nooa-debugger/` in the current working directory. Session records, investigation timelines, and artifacts are stored there so separate CLI invocations can rehydrate the same debugging state.

## Runtime Notes

- Bun is the primary runtime slice and has the most complete live debugging support in this repo.
- Node is now verified on the same AI-first surface for `launch`, `pause`, `break`, `continue`, `state`, `stack`, `vars`, `eval`, `status`, and `stop`.
- For startup-sensitive Node investigations, prefer `debug launch --runtime node --brk -- ...` so the agent can set breakpoints before releasing execution.
- The CLI is intentionally machine-readable first, so agents can compose it without a human-oriented TUI.

## Vendored Skills

This repository vendors `obra/superpowers` in `.codex/superpowers`, with local discovery mirrored through `.agents/skills/superpowers`.

Use the repo-local skills when you want agent workflow guidance without leaving the checkout. The shortest path is:

- `using-superpowers` for general Codex workflow
- `systematic-debugging` for failures, flaky behavior, and runtime issues
- `subagent-driven-development` for parallel slices
- `test-driven-development` for feature work
- `requesting-code-review` and `receiving-code-review` for review loops

For the install and discovery notes, see [`.codex/README.md`](.codex/README.md).

## Debugger Skills

This repo also vendors debugger-specific skills for `nooa-debugger` itself. They live under `.codex/superpowers/skills/` and are surfaced through the existing `.agents/skills/superpowers` symlink, which points at the vendored skill tree.

Use the runtime-specific skill only when the repo marks that runtime as verified; otherwise follow the capability note in the main skill.

# Runtime Capability Note

Use this note before relying on any runtime-specific debugger skill.

## Current rule

- Verified runtimes in this checkout: Bun, Node.
- If the repo README does not mark a runtime as verified, treat the runtime as unsupported.
- Do not infer support from a design doc, a worktree, or a partial adapter.
- If a runtime is unsupported, capture the smallest repro and stop.

## Adding a new runtime later

1. Add a runtime-specific skill.
2. Add unit tests for transport/session behavior.
3. Add a live dogfood or integration test if the runtime supports it.
4. Update the repo README and this note to mark the runtime as verified.

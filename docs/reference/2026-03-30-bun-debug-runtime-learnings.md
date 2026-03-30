# Bun Debug Runtime Learnings

## Why This Exists

This note captures the architectural learns that only became clear after real CLI dogfooding against Bun `1.3.10`.

## What We Learned

### 1. Short-lived CLI requires detached runtime children

For this project, `debug launch` must behave like an agent call:

- emit JSON
- exit immediately
- leave the target and the bridge alive

`unref()` alone was not enough in real CLI dogfooding. The durable fix was:

- spawn the Bun target as `detached`
- spawn the bridge daemon as `detached`
- `unref()` both children
- explicitly `process.exit(...)` in the CLI entrypoint after output

That combination preserves the long-lived runtime while keeping the CLI itself short-lived.

### 2. Bun `--inspect-brk` needs `Inspector.initialized`

`Runtime.runIfWaitingForDebugger` is not the right handshake for Bun `1.3.10`.

For Bun `--inspect-brk`, the useful handshake is:

- `Inspector.initialized`

Without it, `debug continue` can stay stuck on the startup wait or surface the wrong pause.

### 3. Startup pause is not the user breakpoint

Once `Inspector.initialized` is sent, the next pause can still be the synthetic startup pause at the target entrypoint.

So `debug continue` must distinguish:

- startup pause caused by waiting-for-debugger
- the real pause that the user asked for

In practice, the Bun flow now skips the initial `Break on start` / line-1 pause and waits for the next meaningful pause.

### 4. Bun breakpoints are not broken in general

The earlier conclusion was too broad.

Confirmed working on Bun `1.3.10`:

- `Debugger.pause`
- `Debugger.setBreakpointByUrl` on future callback code
- plain `debugger;` inside future callback code

Confirmed still broken or missing:

- `Debugger.setBreakpointByUrl` on module continuation after top-level `await`
- plain `debugger;` on module continuation after top-level `await`

So the real frontier is not "Bun breakpoints do not work". The frontier is narrower:

- future callback pause works
- top-level-await continuation pause still fails

### 5. Dogfooding found issues tests did not

The in-process integration tests were already strong, but real CLI dogfooding still exposed:

- the CLI process hanging after `launch`
- the need for `detached` children
- the Bun-specific `Inspector.initialized` handshake

That confirms the design rule for `nooa-debugger`:

- integration tests are mandatory
- real CLI dogfooding is also a design instrument, not just final validation

## Practical Consequence

The kernel model is holding:

- persisted session record
- live bridge daemon
- paused runtime snapshot

But Bun adds a runtime-specific constraint on top:

- the bridge must know how to advance from waiting-for-debugger into a real user pause

That is now part of the session lifecycle contract, not an adapter detail to rediscover later.

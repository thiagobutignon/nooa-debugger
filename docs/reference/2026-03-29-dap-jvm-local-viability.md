# JVM Local Viability Check

This note captures the local viability of a JVM backend slice for `nooa-debugger` without installing new tools.

## Findings

### 1. No usable JVM DAP adapter is installed locally

I checked the local VS Code extension profile and found no `vscode-java-debug`, `jdtls`, `vscjava`, or equivalent Java debugger extension.

I also checked the local filesystem for common Java debugger installs and found no `jdtls`, `java-debug`, or similar adapter payloads.

### 2. The local Java toolchain is not actually usable yet

`/usr/bin/java`, `/usr/bin/javac`, and `/usr/bin/jdb` exist, but the machine reports:

- `java -version` -> unable to locate a Java Runtime
- `javac -version` -> unable to locate a Java Runtime
- `/usr/libexec/java_home -V` -> unable to locate a Java Runtime

So the environment has command stubs, but not a functioning JDK/JRE install behind them.

## Technical Conclusion

There is no local JVM DAP adapter path I can safely rely on without installing something new.

For an AI-first architecture, the best minimum path is:

1. Keep the JVM slice as a DAP-oriented facade with an injectable transport.
2. Treat the real adapter as an external DAP endpoint when it is available later.
3. Use JDWP as the runtime-side attachment model if we eventually build our own bridge.
4. Avoid making `jdb` the primary backend abstraction, because it is CLI-driven and would force output parsing instead of a DAP contract.

## What Can Become Real First

The current `src/adapters/dap-jvm/**` slice is already arranged in the right order for a future integration:

- `backend.ts` can switch from fake transport to a real endpoint provider first.
- `mapping.ts` can stay as the stable AI-first normalization layer.
- `types.ts` already holds the contract boundary for launch, attach, pause, continue, state, stack, vars, and eval.
- the fake transport tests can later be replaced or supplemented with a recorded real-session transport test.

The first real integration should be `launch` and `attach`, because they only need endpoint acquisition plus DAP initialization. `state`, `stack`, `vars`, and `eval` are the next easiest because they already map cleanly from paused DAP data. `pause` and `continue` can follow once a real transport is available and thread selection semantics are known.

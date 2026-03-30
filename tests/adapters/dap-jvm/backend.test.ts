import { expect, test } from "bun:test";
import { createJvmBackendFacade } from "../../../src/adapters/dap-jvm/backend";
import { createFakeDapTransport } from "../../../src/adapters/dap-jvm/fake-transport";

test("JVM backend facade maps launch attach pause continue state stack vars and eval over DAP", async () => {
  const transport = createFakeDapTransport({
    capabilities: {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
    },
    stackFrames: [
      {
        id: 7,
        name: "main",
        sourcePath: "src/main/java/com/example/Main.java",
        line: 27,
        column: 5,
      },
    ],
    scopes: [
      {
        name: "Locals",
        variablesReference: 101,
      },
    ],
    variables: [
      {
        name: "count",
        value: "41",
        type: "int",
      },
    ],
    evaluation: {
      result: "42",
      type: "int",
    },
  });

  const backend = createJvmBackendFacade({ transport });

  const launched = await backend.launch({
    mainClass: "com.example.Main",
    classPath: ["app.jar"],
    args: ["--flag"],
    vmArgs: ["-Xmx1g"],
    stopOnEntry: true,
    sourcePaths: ["src/main/java"],
  });

  expect(launched.endpoint.transport).toBe("dap");
  expect(launched.endpoint.adapter).toBe("dap-jvm");
  expect(launched.capabilities.pause).toBe(true);
  expect(launched.capabilities.evaluate).toBe(true);
  expect(launched.capabilities.notes.some((note) => note.includes("Java and Kotlin"))).toBe(true);
  expect(launched.commands.map((entry) => entry.request.command)).toEqual([
    "initialize",
    "launch",
    "configurationDone",
  ]);
  expect(launched.commands[1].request.arguments).toMatchObject({
    mainClass: "com.example.Main",
    classPath: ["app.jar"],
    args: ["--flag"],
    vmArgs: ["-Xmx1g"],
    stopOnEntry: true,
    sourcePaths: ["src/main/java"],
  });

  const attached = await backend.attach({
    host: "127.0.0.1",
    port: 5005,
    sourcePaths: ["src/main/java"],
  });

  expect(attached.commands.map((entry) => entry.request.command)).toEqual([
    "initialize",
    "attach",
    "configurationDone",
  ]);
  expect(attached.commands[1].request.arguments).toMatchObject({
    host: "127.0.0.1",
    port: 5005,
    sourcePaths: ["src/main/java"],
  });

  const paused = await backend.pause({ threadId: 1 });
  expect(paused.state).toBe("paused");
  expect(paused.top_frame.location.file).toBe("src/main/java/com/example/Main.java");
  expect(paused.frames[0].frame_ref).toBe("frame-0");
  expect(paused.locals[0].name).toBe("count");

  const state = await backend.state();
  expect(state.state).toBe("paused");
  expect(state.top_frame.function_name).toBe("main");

  const stack = await backend.stack();
  expect(stack.frames[0].location.file).toBe("src/main/java/com/example/Main.java");

  const vars = await backend.vars({ frameRef: stack.frames[0].frame_ref });
  expect(vars.locals[0].value).toBe("41");

  const evaluation = await backend.eval({ expression: "count + 1" });
  expect(evaluation.value).toBe("42");
  expect(evaluation.type).toBe("int");

  const resumed = await backend.continue({ threadId: 1 });
  expect(resumed.state).toBe("running");

  expect(transport.transcript().map((entry) => entry.command)).toEqual([
    "initialize",
    "launch",
    "configurationDone",
    "initialize",
    "attach",
    "configurationDone",
    "pause",
    "stackTrace",
    "scopes",
    "variables",
    "stackTrace",
    "scopes",
    "variables",
    "evaluate",
    "continue",
  ]);
});

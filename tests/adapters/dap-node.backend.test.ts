import { expect, test } from "bun:test";
import { createNodeDapBackend } from "../../src/adapters/dap-node/backend";

test("node backend describes AI-first debugger capabilities", () => {
  const backend = createNodeDapBackend();

  expect(backend.describeCapabilities()).toEqual([
    {
      name: "launch",
      description: "Initialize and launch a Node debug session through DAP.",
      dapMethods: ["initialize", "launch"],
      requiresPausedState: false,
    },
    {
      name: "attach",
      description: "Initialize and attach to an existing Node debug session through DAP.",
      dapMethods: ["initialize", "attach"],
      requiresPausedState: false,
    },
    {
      name: "pause",
      description: "Pause execution in the attached Node runtime.",
      dapMethods: ["pause"],
      requiresPausedState: false,
    },
    {
      name: "continue",
      description: "Resume execution in the attached Node runtime.",
      dapMethods: ["continue"],
      requiresPausedState: false,
    },
    {
      name: "state",
      description: "Collect the current paused state with stack, scopes, and variables.",
      dapMethods: ["stackTrace", "scopes", "variables"],
      requiresPausedState: true,
    },
    {
      name: "stack",
      description: "Collect the current paused stack trace.",
      dapMethods: ["stackTrace"],
      requiresPausedState: true,
    },
    {
      name: "vars",
      description: "Collect the current paused locals and scopes.",
      dapMethods: ["scopes", "variables"],
      requiresPausedState: true,
    },
    {
      name: "eval",
      description: "Evaluate an expression in the current paused frame.",
      dapMethods: ["evaluate"],
      requiresPausedState: true,
    },
  ]);
});

test("node backend plans map command concepts to DAP methods", () => {
  const backend = createNodeDapBackend();

  expect(
    backend.launch({
      program: "app.ts",
      args: ["--flag"],
      cwd: "/work",
    }),
  ).toEqual({
    runtime: "node",
    command: "launch",
    ai_json: {
      command: "launch",
      input: {
        program: "app.ts",
        args: ["--flag"],
        cwd: "/work",
      },
    },
    dap: {
      methods: ["initialize", "launch"],
      steps: [
        {
          command: "initialize",
          arguments: {
            adapterID: "node",
            linesStartAt1: true,
            columnsStartAt1: true,
            pathFormat: "path",
          },
        },
        {
          command: "launch",
          arguments: {
            program: "app.ts",
            args: ["--flag"],
            cwd: "/work",
          },
        },
      ],
    },
  });

  expect(backend.state({ threadId: 7 })).toEqual({
    runtime: "node",
    command: "state",
    ai_json: {
      command: "state",
      input: { threadId: 7 },
    },
    dap: {
      methods: ["stackTrace", "scopes", "variables"],
      steps: [
        {
          command: "stackTrace",
          arguments: { threadId: 7 },
        },
        {
          command: "scopes",
          arguments: { frameId: "<top-frame-id>" },
          dependsOn: ["stackTrace"],
        },
        {
          command: "variables",
          arguments: { variablesReference: "<scope-variables-reference>" },
          dependsOn: ["scopes"],
        },
      ],
    },
  });

  expect(backend["continue"]({ threadId: 7 })).toEqual({
    runtime: "node",
    command: "continue",
    ai_json: {
      command: "continue",
      input: { threadId: 7 },
    },
    dap: {
      methods: ["continue"],
      steps: [
        {
          command: "continue",
          arguments: { threadId: 7 },
        },
      ],
    },
  });
});

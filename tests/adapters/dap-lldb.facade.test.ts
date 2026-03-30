import { expect, test } from "bun:test";
import { createLldbFacade } from "../../src/adapters/dap-lldb/facade";
import type { DapEvent, DapTransport } from "../../src/adapters/dap-lldb/protocol";

function createFakeTransport(options: {
  responses?: Record<string, unknown | ((arguments_: Record<string, unknown> | undefined) => unknown)>;
  events?: DapEvent[];
}) {
  const requests: Array<{ command: string; arguments?: Record<string, unknown> }> = [];
  const events = [...(options.events ?? [])];

  const transport: DapTransport = {
    requests,
    async request(command, arguments_) {
      requests.push({ command, arguments: arguments_ });
      const response = options.responses?.[command];

      if (typeof response === "function") {
        return response(arguments_);
      }

      if (response !== undefined) {
        return response;
      }

      throw new Error(`No fake response configured for ${command}`);
    },
    async nextEvent(predicate) {
      if (events.length === 0) {
        return undefined;
      }

      if (!predicate) {
        return events.shift();
      }

      const index = events.findIndex((event) => predicate(event));
      if (index < 0) {
        return undefined;
      }

      return events.splice(index, 1)[0];
    },
    async close() {},
  };

  return { transport, requests, events };
}

test("LLDB launch and attach map to DAP initialize plus launch or attach requests", async () => {
  const fake = createFakeTransport({
    responses: {
      initialize: {
        supportsConfigurationDoneRequest: true,
        supportsEvaluateForHovers: true,
        supportsSetVariable: true,
        supportsStepBack: false,
      },
      launch: {},
      attach: {},
      configurationDone: {},
    },
  });

  const facade = createLldbFacade(fake.transport);
  const launchResult = await facade.launch({
    program: "/work/app",
    args: ["--mode", "debug"],
    cwd: "/work",
    stopOnEntry: true,
    env: { RUST_BACKTRACE: "1" },
  });
  const attachResult = await facade.attach({
    pid: 1442,
    cwd: "/work",
  });

  expect(fake.requests.map((entry) => entry.command)).toEqual([
    "initialize",
    "launch",
    "configurationDone",
    "initialize",
    "attach",
    "configurationDone",
  ]);
  expect(fake.requests[1]?.arguments).toMatchObject({
    program: "/work/app",
    args: ["--mode", "debug"],
    cwd: "/work",
    stopOnEntry: true,
    env: { RUST_BACKTRACE: "1" },
  });
  expect(fake.requests[4]?.arguments).toMatchObject({
    pid: 1442,
    cwd: "/work",
  });
  expect(launchResult.kind).toBe("launch");
  expect(attachResult.kind).toBe("attach");
  expect(launchResult.capabilities.notes.join("\n")).toContain("Swift");
  expect(launchResult.capabilities.notes.join("\n")).toContain("Rust");
  expect(launchResult.capabilities.notes.join("\n")).toContain("Native");
});

test("LLDB pause and continue normalize a stopped DAP session into JSON state", async () => {
  let stackTraceCalls = 0;
  const fake = createFakeTransport({
    responses: {
      initialize: {
        supportsConfigurationDoneRequest: true,
        supportsEvaluateForHovers: true,
        supportsSetVariable: true,
      },
      launch: {},
      configurationDone: {},
      pause: {},
      continue: {},
      stackTrace: () => {
        stackTraceCalls += 1;
        if (stackTraceCalls === 1) {
          return {
            stackFrames: [
              {
                id: 701,
                name: "main",
                source: { path: "/tmp/main.swift" },
                line: 12,
                column: 5,
              },
              {
                id: 702,
                name: "helper",
                source: { path: "/tmp/main.swift" },
                line: 4,
                column: 1,
              },
            ],
            totalFrames: 2,
          };
        }

        return {
          stackFrames: [
            {
              id: 801,
              name: "main",
              source: { path: "/tmp/main.swift" },
              line: 27,
              column: 3,
            },
          ],
          totalFrames: 1,
        };
      },
      scopes: {
        scopes: [
          { name: "Locals", variablesReference: 11, expensive: false },
          { name: "Arguments", variablesReference: 12, expensive: false },
        ],
      },
      variables: ({ variablesReference }) => {
        if (variablesReference === 11) {
          return {
            variables: [
              { name: "tracked", value: "41", type: "Int" },
              { name: "message", value: "\"hello\"", type: "String" },
            ],
          };
        }

        if (variablesReference === 12) {
          return {
            variables: [{ name: "argc", value: "1", type: "Int" }],
          };
        }

        return { variables: [] };
      },
      evaluate: ({ expression }) => ({
        result: expression === "tracked + 1" ? "42" : "unexpected",
        type: "Int",
      }),
    },
    events: [
      {
        event: "stopped",
        body: {
          reason: "breakpoint",
          threadId: 7,
          allThreadsStopped: true,
        },
      },
      {
        event: "stopped",
        body: {
          reason: "step",
          threadId: 7,
          allThreadsStopped: true,
        },
      },
    ],
  });

  const facade = createLldbFacade(fake.transport);
  const paused = await facade.pause({ threadId: 7 });
  const stack = await facade.stack();
  const vars = await facade.vars();
  const evaluated = await facade.eval({ expression: "tracked + 1" });
  const continued = await facade.continue({ threadId: 7 });

  expect(paused.state).toBe("paused");
  expect(paused.reason).toBe("breakpoint");
  expect(paused.threadId).toBe(7);
  expect(paused.frames[0]).toMatchObject({
    id: 701,
    name: "main",
    source: { path: "/tmp/main.swift" },
    line: 12,
    column: 5,
  });
  expect(paused.locals).toEqual([
    { name: "tracked", value: "41", type: "Int", variablesReference: 0 },
    { name: "message", value: "\"hello\"", type: "String", variablesReference: 0 },
    { name: "argc", value: "1", type: "Int", variablesReference: 0 },
  ]);
  expect(stack.frames).toEqual(paused.frames);
  expect(vars.frameId).toBe(701);
  expect(vars.locals.map((entry) => entry.name)).toEqual(["tracked", "message", "argc"]);
  expect(evaluated.expression).toBe("tracked + 1");
  expect(evaluated.result).toBe("42");
  expect(continued.state).toBe("paused");
  expect(continued.reason).toBe("step");
  expect(continued.frames[0]?.id).toBe(801);
  expect(fake.requests.map((entry) => entry.command)).toEqual([
    "pause",
    "stackTrace",
    "scopes",
    "variables",
    "variables",
    "evaluate",
    "continue",
    "stackTrace",
    "scopes",
    "variables",
    "variables",
  ]);
});

test("LLDB state falls back to running when no stopped event is available", async () => {
  const fake = createFakeTransport({
    responses: {
      initialize: {
        supportsConfigurationDoneRequest: true,
      },
      launch: {},
      configurationDone: {},
      threads: {
        threads: [
          { id: 9, name: "main-thread" },
        ],
      },
    },
  });

  const facade = createLldbFacade(fake.transport);
  await facade.launch({
    program: "/work/app",
  });

  const state = await facade.state();
  expect(state.state).toBe("running");
  expect(state.threads).toEqual([{ id: 9, name: "main-thread" }]);
  expect(fake.requests.map((entry) => entry.command)).toEqual([
    "initialize",
    "launch",
    "configurationDone",
    "threads",
  ]);
});

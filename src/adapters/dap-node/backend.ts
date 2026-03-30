export type NodeCommandName =
  | "launch"
  | "attach"
  | "pause"
  | "continue"
  | "state"
  | "stack"
  | "vars"
  | "eval";

export type NodeCapability = {
  name: NodeCommandName;
  description: string;
  dapMethods: string[];
  requiresPausedState: boolean;
};

export type NodeDapStep = {
  command: string;
  arguments?: Record<string, unknown>;
  dependsOn?: string[];
};

export type NodeCommandPlan = {
  runtime: "node";
  command: NodeCommandName;
  ai_json: {
    command: NodeCommandName;
    input: Record<string, unknown>;
  };
  dap: {
    methods: string[];
    steps: NodeDapStep[];
  };
};

export type NodeLaunchInput = {
  program: string;
  args?: string[];
  cwd?: string;
  stopOnEntry?: boolean;
  env?: Record<string, string>;
};

export type NodeAttachInput = {
  host?: string;
  port?: number;
  processId?: number;
  cwd?: string;
};

export type NodePauseInput = {
  threadId?: number;
};

export type NodeContinueInput = {
  threadId?: number;
};

export type NodeStateInput = {
  threadId: number;
};

export type NodeStackInput = {
  threadId: number;
};

export type NodeVarsInput = {
  threadId?: number;
  frameId?: number | string;
  variablesReference?: number | string;
};

export type NodeEvalInput = {
  expression: string;
  frameId?: number | string;
  context?: string;
};

function plan(
  command: NodeCommandName,
  input: Record<string, unknown>,
  methods: string[],
  steps: NodeDapStep[],
): NodeCommandPlan {
  return {
    runtime: "node",
    command,
    ai_json: {
      command,
      input,
    },
    dap: {
      methods,
      steps,
    },
  };
}

function capability(
  name: NodeCommandName,
  description: string,
  dapMethods: string[],
  requiresPausedState: boolean,
): NodeCapability {
  return {
    name,
    description,
    dapMethods,
    requiresPausedState,
  };
}

export function createNodeDapBackend() {
  return {
    describeCapabilities(): NodeCapability[] {
      return [
        capability(
          "launch",
          "Initialize and launch a Node debug session through DAP.",
          ["initialize", "launch"],
          false,
        ),
        capability(
          "attach",
          "Initialize and attach to an existing Node debug session through DAP.",
          ["initialize", "attach"],
          false,
        ),
        capability(
          "pause",
          "Pause execution in the attached Node runtime.",
          ["pause"],
          false,
        ),
        capability(
          "continue",
          "Resume execution in the attached Node runtime.",
          ["continue"],
          false,
        ),
        capability(
          "state",
          "Collect the current paused state with stack, scopes, and variables.",
          ["stackTrace", "scopes", "variables"],
          true,
        ),
        capability(
          "stack",
          "Collect the current paused stack trace.",
          ["stackTrace"],
          true,
        ),
        capability(
          "vars",
          "Collect the current paused locals and scopes.",
          ["scopes", "variables"],
          true,
        ),
        capability(
          "eval",
          "Evaluate an expression in the current paused frame.",
          ["evaluate"],
          true,
        ),
      ];
    },

    launch(input: NodeLaunchInput): NodeCommandPlan {
      return plan(
        "launch",
        input,
        ["initialize", "launch"],
        [
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
            arguments: input,
          },
        ],
      );
    },

    attach(input: NodeAttachInput): NodeCommandPlan {
      return plan(
        "attach",
        input,
        ["initialize", "attach"],
        [
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
            command: "attach",
            arguments: input,
          },
        ],
      );
    },

    pause(input: NodePauseInput = {}): NodeCommandPlan {
      return plan("pause", input, ["pause"], [
        {
          command: "pause",
          arguments: input,
        },
      ]);
    },

    ["continue"](input: NodeContinueInput = {}): NodeCommandPlan {
      return plan("continue", input, ["continue"], [
        {
          command: "continue",
          arguments: input,
        },
      ]);
    },

    state(input: NodeStateInput): NodeCommandPlan {
      return plan(
        "state",
        input,
        ["stackTrace", "scopes", "variables"],
        [
          {
            command: "stackTrace",
            arguments: {
              threadId: input.threadId,
            },
          },
          {
            command: "scopes",
            arguments: {
              frameId: "<top-frame-id>",
            },
            dependsOn: ["stackTrace"],
          },
          {
            command: "variables",
            arguments: {
              variablesReference: "<scope-variables-reference>",
            },
            dependsOn: ["scopes"],
          },
        ],
      );
    },

    stack(input: NodeStackInput): NodeCommandPlan {
      return plan("stack", input, ["stackTrace"], [
        {
          command: "stackTrace",
          arguments: {
            threadId: input.threadId,
          },
        },
      ]);
    },

    vars(input: NodeVarsInput): NodeCommandPlan {
      return plan(
        "vars",
        input,
        ["scopes", "variables"],
        [
          {
            command: "scopes",
            arguments: {
              frameId: input.frameId ?? "<top-frame-id>",
            },
          },
          {
            command: "variables",
            arguments: {
              variablesReference:
                input.variablesReference ?? "<scope-variables-reference>",
            },
            dependsOn: ["scopes"],
          },
        ],
      );
    },

    eval(input: NodeEvalInput): NodeCommandPlan {
      return plan("eval", input, ["evaluate"], [
        {
          command: "evaluate",
          arguments: {
            expression: input.expression,
            frameId: input.frameId ?? "<top-frame-id>",
            context: input.context ?? "repl",
          },
        },
      ]);
    },
  };
}

export type NodeDapBackend = ReturnType<typeof createNodeDapBackend>;

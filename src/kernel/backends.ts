export type BackendId =
  | "bun-inspector"
  | "dap-node"
  | "dap-go"
  | "dap-lldb"
  | "dap-jvm";

export type BackendProtocol = "bun-inspector" | "dap";
export type BackendStatus = "available" | "contract_only" | "planned";
export type CapabilityState = "available" | "partial" | "planned";

export type BackendCapabilityMap = {
  launch: CapabilityState;
  attach: CapabilityState;
  pause: CapabilityState;
  continue: CapabilityState;
  state: CapabilityState;
  stack: CapabilityState;
  vars: CapabilityState;
  eval: CapabilityState;
  break: CapabilityState;
};

export type BackendDescriptor = {
  backend_id: BackendId;
  adapter: string;
  protocol: BackendProtocol;
  status: BackendStatus;
  runtimes: string[];
  languages: string[];
  capabilities: BackendCapabilityMap;
  notes?: string[];
};

const AVAILABLE: CapabilityState = "available";
const PARTIAL: CapabilityState = "partial";
const PLANNED: CapabilityState = "planned";

const BACKEND_CATALOG: BackendDescriptor[] = [
  {
    backend_id: "bun-inspector",
    adapter: "bun",
    protocol: "bun-inspector",
    status: "available",
    runtimes: ["bun"],
    languages: ["javascript", "typescript"],
    capabilities: {
      launch: AVAILABLE,
      attach: PLANNED,
      pause: AVAILABLE,
      continue: AVAILABLE,
      state: AVAILABLE,
      stack: AVAILABLE,
      vars: AVAILABLE,
      eval: AVAILABLE,
      break: PARTIAL,
    },
    notes: [
      "Future callback breakpoints and debugger statements are working on Bun 1.3.10.",
      "Module continuation after top-level await still has runtime-specific pause gaps.",
    ],
  },
  {
    backend_id: "dap-node",
    adapter: "dap-node",
    protocol: "dap",
    status: "contract_only",
    runtimes: ["node"],
    languages: ["javascript", "typescript"],
    capabilities: {
      launch: PLANNED,
      attach: PLANNED,
      pause: PLANNED,
      continue: PLANNED,
      state: PLANNED,
      stack: PLANNED,
      vars: PLANNED,
      eval: PLANNED,
      break: PLANNED,
    },
    notes: [
      "Contract-first DAP client and backend facade are implemented.",
      "Real process launch and attach are not wired into the shared CLI yet.",
    ],
  },
  {
    backend_id: "dap-go",
    adapter: "dap-go",
    protocol: "dap",
    status: "contract_only",
    runtimes: ["go"],
    languages: ["go"],
    capabilities: {
      launch: PLANNED,
      attach: PLANNED,
      pause: PLANNED,
      continue: PLANNED,
      state: PLANNED,
      stack: PLANNED,
      vars: PLANNED,
      eval: PLANNED,
      break: PLANNED,
    },
    notes: [
      "Contract-first Go session facade and DAP client are implemented.",
      "Real Delve process launch and shared CLI wiring are still follow-up work.",
    ],
  },
  {
    backend_id: "dap-lldb",
    adapter: "dap-lldb",
    protocol: "dap",
    status: "contract_only",
    runtimes: ["lldb"],
    languages: ["swift", "rust", "c", "cpp", "objective-c"],
    capabilities: {
      launch: PLANNED,
      attach: PLANNED,
      pause: PLANNED,
      continue: PLANNED,
      state: PLANNED,
      stack: PLANNED,
      vars: PLANNED,
      eval: PLANNED,
      break: PLANNED,
    },
    notes: [
      "Contract-first LLDB facade is implemented over an injected DAP transport.",
      "Real lldb-dap process launch and shared CLI wiring are still follow-up work.",
    ],
  },
  {
    backend_id: "dap-jvm",
    adapter: "dap-jvm",
    protocol: "dap",
    status: "contract_only",
    runtimes: ["jvm"],
    languages: ["java", "kotlin"],
    capabilities: {
      launch: PLANNED,
      attach: PLANNED,
      pause: PLANNED,
      continue: PLANNED,
      state: PLANNED,
      stack: PLANNED,
      vars: PLANNED,
      eval: PARTIAL,
      break: PLANNED,
    },
    notes: [
      "Contract-first JVM facade and fake transport are implemented.",
      "A real JVM launcher or JDWP bridge is still a follow-up.",
    ],
  },
];

export function getBackendCatalog(): BackendDescriptor[] {
  return BACKEND_CATALOG.map((backend) => ({
    ...backend,
    runtimes: [...backend.runtimes],
    languages: [...backend.languages],
    capabilities: { ...backend.capabilities },
    notes: backend.notes ? [...backend.notes] : undefined,
  }));
}

export function getBackendDescriptor(backendId: BackendId): BackendDescriptor | undefined {
  return getBackendCatalog().find((backend) => backend.backend_id === backendId);
}

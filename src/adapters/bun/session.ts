import { fileURLToPath } from "node:url";
import { createBunCdpClient } from "./cdp";

type InspectorRemoteObject = {
  type?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
  objectId?: string;
};

type InspectorPropertyDescriptor = {
  name?: string;
  value?: InspectorRemoteObject;
  get?: unknown;
  set?: unknown;
  enumerable?: boolean;
};

type InspectorScope = {
  type?: string;
  object?: {
    objectId?: string;
  };
};

type InspectorCallFrame = {
  callFrameId?: string;
  functionName?: string;
  url?: string;
  location?: {
    scriptId?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  scopeChain?: InspectorScope[];
};

type InspectorPausedEvent = {
  method: "Debugger.paused";
  params?: {
    reason?: string;
    callFrames?: InspectorCallFrame[];
  };
};

export type BunBreakpointLocation = {
  scriptId?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};

export type BunPausedSnapshot = {
  reason?: string;
  topFrame: {
    callFrameId?: string;
    functionName?: string;
    location: {
      scriptId?: string;
      file?: string;
      line: number;
      column: number;
    };
  };
  locals: Array<{ name: string; value: string; type?: string; objectId?: string }>;
  rawCallFrames: InspectorCallFrame[];
};

export type BunSession = {
  setBreakpoint(fileLine: string): Promise<{
    breakpointId?: string;
    locations: BunBreakpointLocation[];
  }>;
  ping(): Promise<void>;
  releaseWaitingForDebugger(): Promise<void>;
  pause(timeoutMs?: number): Promise<BunPausedSnapshot>;
  continueUntilPaused(timeoutMs?: number): Promise<BunPausedSnapshot>;
  snapshotPaused(timeoutMs?: number): Promise<BunPausedSnapshot>;
  evaluate(expression: string): Promise<any>;
  close(): Promise<void>;
};

function parseFileLine(fileLine: string): { filePath: string; line: number } {
  const match = fileLine.match(/^(.*):(\d+)$/);
  if (!match) {
    throw new Error(`Invalid breakpoint location: ${fileLine}`);
  }

  return {
    filePath: match[1],
    line: Number(match[2]),
  };
}

function toInspectorUrl(filePath: string): string {
  return normalizeInspectorFile(filePath) ?? filePath;
}

function normalizeInspectorFile(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  if (!url.startsWith("file://")) {
    return url;
  }

  return fileURLToPath(url);
}

function stringifyRemoteObject(remote?: InspectorRemoteObject): string {
  if (!remote) {
    return "";
  }

  if (remote.unserializableValue !== undefined) {
    return remote.unserializableValue;
  }

  if (remote.value === undefined) {
    if (remote.type === "undefined") return "undefined";
    if (remote.type === "null") return "null";
    return remote.description ?? "";
  }

  if (remote.value === null) {
    return "null";
  }

  switch (typeof remote.value) {
    case "string":
      return remote.value;
    case "number":
    case "boolean":
    case "bigint":
      return String(remote.value);
    default:
      return remote.description ?? JSON.stringify(remote.value);
  }
}

async function captureSnapshot(
  client: ReturnType<typeof createBunCdpClient>,
  paused: InspectorPausedEvent,
  scriptUrls: Map<string, string>,
): Promise<BunPausedSnapshot> {
  const callFrames = paused.params?.callFrames ?? [];
  const topFrame = callFrames[0];
  const localScope = topFrame?.scopeChain?.find((scope) => scope.type === "local");
  const locals: Array<{ name: string; value: string; type?: string; objectId?: string }> = [];

  if (localScope?.object?.objectId) {
    const response = (await client.send("Runtime.getProperties", {
      objectId: localScope.object.objectId,
      ownProperties: true,
    })) as { result?: { result?: InspectorPropertyDescriptor[] } };

    for (const descriptor of response.result?.result ?? []) {
      if (!descriptor.name) continue;
      if (descriptor.get || descriptor.set) continue;
      locals.push({
        name: descriptor.name,
        value: stringifyRemoteObject(descriptor.value),
        type: descriptor.value?.type,
        objectId: descriptor.value?.objectId,
      });
    }
  }

  return {
    reason: paused.params?.reason,
    topFrame: {
      callFrameId: topFrame?.callFrameId,
      functionName: topFrame?.functionName,
      location: {
        scriptId: topFrame?.location?.scriptId,
        file: normalizeInspectorFile(
          topFrame?.url
          ?? topFrame?.location?.url
          ?? scriptUrls.get(topFrame?.location?.scriptId ?? ""),
        ),
        line: (topFrame?.location?.lineNumber ?? -1) + 1,
        column: (topFrame?.location?.columnNumber ?? 0) + 1,
      },
    },
    locals,
    rawCallFrames: callFrames,
  };
}

export async function createBunSession(wsUrl: string): Promise<BunSession> {
  const client = createBunCdpClient(wsUrl);
  const scriptUrls = new Map<string, string>();
  let currentSnapshot: BunPausedSnapshot | undefined;

  client.onEvent((event) => {
    if (event?.method !== "Debugger.scriptParsed") {
      return;
    }

    const scriptId = event.params?.scriptId;
    const url = normalizeInspectorFile(event.params?.sourceURL ?? event.params?.url);
    if (!scriptId || !url) {
      return;
    }

    scriptUrls.set(scriptId, url);
  });

  await client.send("Runtime.enable");
  await client.send("Debugger.enable");
  await client.send("Debugger.setBreakpointsActive", { active: true }).catch(() => {});
  await client.send("Debugger.setPauseOnDebuggerStatements", { enabled: true }).catch(() => {});

  return {
    async ping() {
      await client.send("Debugger.setBreakpointsActive", { active: true });
    },

    async releaseWaitingForDebugger() {
      await client.send("Inspector.initialized").catch(() => {});
    },

    async setBreakpoint(fileLine: string) {
      const { filePath, line } = parseFileLine(fileLine);
      const response = (await client.send("Debugger.setBreakpointByUrl", {
        url: toInspectorUrl(filePath),
        lineNumber: line - 1,
        columnNumber: 0,
      })) as {
        result?: {
          breakpointId?: string;
          locations?: BunBreakpointLocation[];
        };
      };

      return {
        breakpointId: response.result?.breakpointId,
        locations: response.result?.locations ?? [],
      };
    },

    async pause(timeoutMs = 2_000) {
      await client.send("Debugger.pause");
      const paused = (await client.waitForPaused(timeoutMs)) as InspectorPausedEvent;
      currentSnapshot = await captureSnapshot(client, paused, scriptUrls);
      return currentSnapshot;
    },

    async continueUntilPaused(timeoutMs = 2_000) {
      await client.send("Debugger.resume");
      const paused = (await client.waitForPaused(timeoutMs)) as InspectorPausedEvent;
      currentSnapshot = await captureSnapshot(client, paused, scriptUrls);
      return currentSnapshot;
    },

    async snapshotPaused(timeoutMs = 2_000) {
      const paused = (await client.waitForPaused(timeoutMs)) as InspectorPausedEvent;
      currentSnapshot = await captureSnapshot(client, paused, scriptUrls);
      return currentSnapshot;
    },

    async evaluate(expression: string) {
      if (!currentSnapshot?.topFrame.callFrameId) {
        throw new Error("No paused frame available for evaluation");
      }

      const response = await client.send("Debugger.evaluateOnCallFrame", {
        callFrameId: currentSnapshot.topFrame.callFrameId,
        expression,
        returnByValue: true,
      });

      return response.result ?? response;
    },

    close() {
      return client.close();
    },
  };
}

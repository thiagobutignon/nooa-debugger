import { fileURLToPath, pathToFileURL } from "node:url";
import { createNodeCdpClient } from "./cdp";

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
    hitBreakpoints?: string[];
  };
};

type InspectorEvaluationResponse = {
  result?: InspectorRemoteObject;
  exceptionDetails?: {
    text?: string;
  };
};

export type NodeBreakpointLocation = {
  scriptId?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};

export type NodePausedSnapshot = {
  reason?: string;
  hitBreakpoints?: string[];
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

export type NodeSessionState =
  | { state: "running" }
  | { state: "paused"; snapshot: NodePausedSnapshot };

export type NodeSession = {
  ping(): Promise<void>;
  releaseWaitingForDebugger(): Promise<void>;
  pause(timeoutMs?: number): Promise<NodePausedSnapshot>;
  snapshotPaused(timeoutMs?: number): Promise<NodePausedSnapshot>;
  continue(): Promise<void>;
  state(): Promise<NodeSessionState>;
  stack(): Promise<InspectorCallFrame[]>;
  vars(): Promise<Array<{ name: string; value: string; type?: string; objectId?: string }>>;
  eval(expression: string): Promise<{ result?: InspectorRemoteObject }>;
  break(fileLine: string): Promise<{
    breakpointId?: string;
    locations: NodeBreakpointLocation[];
  }>;
  close(): Promise<void>;
};

function sessionError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Error {
  const error = new Error(message) as Error & Record<string, unknown>;
  error.code = code;

  for (const [key, value] of Object.entries(details ?? {})) {
    error[key] = value;
  }

  return error;
}

function parseFileLine(fileLine: string): { filePath: string; line: number } {
  const match = fileLine.match(/^(.*):(\d+)$/);
  if (!match) {
    throw sessionError("break.invalid_location", `Invalid breakpoint location: ${fileLine}`);
  }

  return {
    filePath: match[1],
    line: Number(match[2]),
  };
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

function toInspectorUrl(filePath: string): string {
  if (filePath.startsWith("file://")) {
    return filePath;
  }

  return pathToFileURL(filePath).href;
}

function extractBreakpointFile(hitBreakpointId?: string): string | undefined {
  if (!hitBreakpointId) {
    return undefined;
  }

  const match = hitBreakpointId.match(/^\d+:\d+:\d+:(.+)$/);
  if (!match) {
    return undefined;
  }

  return normalizeInspectorFile(match[1]);
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

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === "function";
}

async function openNodeInspectorSocket(wsUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(wsUrl);

  if (socket.readyState === WebSocket.OPEN) {
    return socket;
  }

  return new Promise<WebSocket>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = () => {
      cleanup();
      reject(
        sessionError("transport.unreachable", `Failed to connect to Node inspector at ${wsUrl}`),
      );
    };
    const onClose = () => {
      cleanup();
      reject(
        sessionError("transport.unreachable", `Node inspector closed before opening at ${wsUrl}`),
      );
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

async function captureSnapshot(
  client: ReturnType<typeof createNodeCdpClient>,
  paused: InspectorPausedEvent,
  scriptUrls: Map<string, string>,
): Promise<NodePausedSnapshot> {
  const callFrames = paused.params?.callFrames ?? [];
  const topFrame = callFrames[0];
  const localScope = topFrame?.scopeChain?.find((scope) => scope.type === "local");
  const locals: Array<{ name: string; value: string; type?: string; objectId?: string }> = [];
  const hitBreakpoints = paused.params?.hitBreakpoints ?? [];
  const breakpointFile = hitBreakpoints
    .map((entry) => extractBreakpointFile(entry))
    .find((entry) => Boolean(entry));

  if (localScope?.object?.objectId) {
    const response = (await client.send("Runtime.getProperties", {
      objectId: localScope.object.objectId,
      ownProperties: true,
    })) as { result?: InspectorPropertyDescriptor[] };

    for (const descriptor of response.result ?? []) {
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
    hitBreakpoints,
    topFrame: {
      callFrameId: topFrame?.callFrameId,
      functionName: topFrame?.functionName,
      location: {
        scriptId: topFrame?.location?.scriptId,
        file: normalizeInspectorFile(
          topFrame?.url
          || topFrame?.location?.url
          || scriptUrls.get(topFrame?.location?.scriptId ?? "")
          || breakpointFile
        ),
        line: (topFrame?.location?.lineNumber ?? -1) + 1,
        column: (topFrame?.location?.columnNumber ?? 0) + 1,
      },
    },
    locals,
    rawCallFrames: callFrames,
  };
}

function ensureSessionOpen(closed: boolean) {
  if (!closed) {
    return;
  }

  throw sessionError("transport.closed", "Node inspector session is closed");
}

function ensureCurrentSnapshot(snapshot: NodePausedSnapshot | undefined): NodePausedSnapshot {
  if (snapshot) {
    return snapshot;
  }

  throw sessionError("snapshot.stale", "Paused snapshot is not available yet");
}

async function captureBufferedPausedIfAny(
  client: ReturnType<typeof createNodeCdpClient>,
  scriptUrls: Map<string, string>,
): Promise<NodePausedSnapshot | undefined> {
  const paused = client.takeBufferedPaused() as InspectorPausedEvent | undefined;
  if (!paused) {
    return undefined;
  }

  return captureSnapshot(client, paused, scriptUrls);
}

export async function createNodeSession(input: {
  wsUrl: string;
  createSocket?: (wsUrl: string) => Promise<WebSocket> | WebSocket;
}): Promise<NodeSession> {
  const createdSocket = input.createSocket
    ? input.createSocket(input.wsUrl)
    : openNodeInspectorSocket(input.wsUrl);
  const socket = isPromiseLike(createdSocket)
    ? await createdSocket
    : createdSocket;
  const client = createNodeCdpClient(socket);
  const scriptUrls = new Map<string, string>();
  let currentSnapshot: NodePausedSnapshot | undefined;
  let closed = false;
  const markClosed = () => {
    closed = true;
    currentSnapshot = undefined;
  };

  socket.addEventListener("close", markClosed);

  const removeListener = client.onEvent((event) => {
    if (event?.method === "Debugger.scriptParsed") {
      const scriptId = event.params?.scriptId;
      const url = normalizeInspectorFile(event.params?.sourceURL ?? event.params?.url);
      if (!scriptId || !url) {
        return;
      }

      scriptUrls.set(scriptId, url);
      return;
    }

    if (event?.method === "Debugger.resumed") {
      currentSnapshot = undefined;
      client.clearBufferedPaused();
    }
  });

  async function ensureSnapshotAvailable() {
    ensureSessionOpen(closed);
    if (!currentSnapshot) {
      currentSnapshot = await captureBufferedPausedIfAny(client, scriptUrls);
    }

    return ensureCurrentSnapshot(currentSnapshot);
  }

  try {
    const runtimeEnabled = client.send("Runtime.enable");
    const debuggerEnabled = client.send("Debugger.enable");
    await Promise.all([runtimeEnabled, debuggerEnabled]);
  } catch (error) {
    closed = true;
    removeListener();
    await client.close().catch(() => {});
    throw error;
  }

  return {
    async ping() {
      ensureSessionOpen(closed);
      await client.send("Runtime.enable");
    },

    async releaseWaitingForDebugger() {
      ensureSessionOpen(closed);
      await client.send("Runtime.runIfWaitingForDebugger").catch(() => {});
    },

    async pause(timeoutMs = 2_000) {
      ensureSessionOpen(closed);
      if (currentSnapshot) {
        return currentSnapshot;
      }

      const buffered = await captureBufferedPausedIfAny(client, scriptUrls);
      if (buffered) {
        currentSnapshot = buffered;
        return currentSnapshot;
      }

      await client.send("Debugger.pause");
      const paused = (await client.waitForPaused(timeoutMs)) as InspectorPausedEvent;
      currentSnapshot = await captureSnapshot(client, paused, scriptUrls);
      return currentSnapshot;
    },

    async snapshotPaused(timeoutMs = 2_000) {
      ensureSessionOpen(closed);
      if (currentSnapshot) {
        return currentSnapshot;
      }

      const buffered = await captureBufferedPausedIfAny(client, scriptUrls);
      if (buffered) {
        currentSnapshot = buffered;
        return currentSnapshot;
      }

      const paused = (await client.waitForPaused(timeoutMs)) as InspectorPausedEvent;
      currentSnapshot = await captureSnapshot(client, paused, scriptUrls);
      return currentSnapshot;
    },

    async continue() {
      ensureSessionOpen(closed);
      await client.send("Debugger.resume");
      currentSnapshot = undefined;
      client.clearBufferedPaused();
    },

    async state() {
      ensureSessionOpen(closed);
      const snapshot = await captureBufferedPausedIfAny(client, scriptUrls);
      if (snapshot) {
        currentSnapshot = snapshot;
      }

      if (!currentSnapshot) {
        return { state: "running" } as const;
      }

      return {
        state: "paused" as const,
        snapshot: currentSnapshot,
      };
    },

    async stack() {
      return (await ensureSnapshotAvailable()).rawCallFrames;
    },

    async vars() {
      return (await ensureSnapshotAvailable()).locals;
    },

    async eval(expression: string) {
      ensureSessionOpen(closed);
      let snapshot = currentSnapshot;
      if (!snapshot) {
        snapshot = await captureBufferedPausedIfAny(client, scriptUrls);
        if (snapshot) {
          currentSnapshot = snapshot;
        }
      }
      snapshot = ensureCurrentSnapshot(snapshot);
      const callFrameId = snapshot.topFrame.callFrameId;
      if (!callFrameId) {
        throw sessionError("snapshot.stale", "Paused frame is missing callFrameId");
      }

      const response = (await client.send("Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression,
        returnByValue: true,
      })) as InspectorEvaluationResponse;

      if (response.exceptionDetails) {
        throw sessionError(
          "runtime.evaluation_failed",
          response.exceptionDetails.text
            ?? response.result?.description
            ?? "Evaluation failed in Node inspector",
          {
            result: response.result,
            exception_details: response.exceptionDetails,
          },
        );
      }

      return {
        result: response.result,
      };
    },

    async break(fileLine: string) {
      ensureSessionOpen(closed);
      const { filePath, line } = parseFileLine(fileLine);
      const response = (await client.send("Debugger.setBreakpointByUrl", {
        url: toInspectorUrl(filePath),
        lineNumber: line - 1,
        columnNumber: 0,
      })) as {
        breakpointId?: string;
        locations?: NodeBreakpointLocation[];
      };

      return {
        breakpointId: response.breakpointId,
        locations: response.locations ?? [],
      };
    },

    async close() {
      if (closed) {
        return;
      }

      markClosed();
      socket.removeEventListener("close", markClosed);
      removeListener();
      await client.close();
    },
  };
}

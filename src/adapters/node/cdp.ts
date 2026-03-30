type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type BufferedResponse =
  | { kind: "result"; value: any }
  | { kind: "error"; error: unknown };

type PausedEvent = {
  method: "Debugger.paused";
  params?: Record<string, unknown>;
};

type PendingPausedWaiter = {
  resolve: (value: PausedEvent) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type EventListener = (event: any) => void;

function machineError(
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

function connectionError(code: "transport.unreachable" | "transport.closed", message: string): Error {
  return machineError(code, message);
}

function invalidStateError(message: string, cdpError?: unknown): Error {
  return machineError("session.invalid_state", message, {
    detail_code: "node.inspector.request_failed",
    cdp_error: cdpError,
  });
}

function decodeMessage(data: string | Uint8Array | ArrayBuffer): string {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }

  return new TextDecoder().decode(data);
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN || socket.readyState === 1;
}

function isClosed(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.CLOSED || socket.readyState === 3;
}

export function createNodeCdpClient(socket: WebSocket): {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
  waitForPaused(timeoutMs?: number): Promise<PausedEvent>;
  takeBufferedPaused(): PausedEvent | undefined;
  clearBufferedPaused(): void;
  onEvent(listener: EventListener): () => void;
} {
  const pendingRequests = new Map<number, PendingRequest>();
  const bufferedResponses = new Map<number, BufferedResponse>();
  const pausedEvents: PausedEvent[] = [];
  const pausedWaiters: PendingPausedWaiter[] = [];
  const eventListeners = new Set<EventListener>();

  let nextId = 1;
  let closed = isClosed(socket);
  let readySettled = false;
  let closedSettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveClosed!: () => void;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  function settleReadySuccess() {
    if (readySettled) return;
    readySettled = true;
    resolveReady();
  }

  function settleReadyFailure(error: Error) {
    if (readySettled) return;
    readySettled = true;
    rejectReady(error);
  }

  function settleClosed() {
    if (closedSettled) return;
    closedSettled = true;
    resolveClosed();
  }

  function rejectPendingRequests(error: Error) {
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  function rejectPausedWaiters(error: Error) {
    for (const waiter of pausedWaiters.splice(0)) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(error);
    }
  }

  function resolvePausedEvent(event: PausedEvent) {
    const waiter = pausedWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(event);
      return;
    }

    pausedEvents.push(event);
  }

  function drainBufferedResponse(id: number) {
    const buffered = bufferedResponses.get(id);
    if (!buffered) {
      return;
    }

    bufferedResponses.delete(id);
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(id);
    if (buffered.kind === "error") {
      pending.reject(
        invalidStateError(
          (buffered.error as { message?: string })?.message
            ?? "Node inspector request failed",
          buffered.error,
        ),
      );
      return;
    }

    pending.resolve(buffered.value);
  }

  if (closed) {
    const error = connectionError("transport.closed", "Node inspector connection is closed");
    settleReadyFailure(error);
    settleClosed();
  } else if (isOpen(socket)) {
    settleReadySuccess();
  }

  socket.addEventListener("open", () => {
    settleReadySuccess();
  });

  socket.addEventListener("message", (event) => {
    let payload: any;

    try {
      payload = JSON.parse(decodeMessage(event.data as string | Uint8Array | ArrayBuffer));
    } catch {
      return;
    }

    if (typeof payload?.id === "number") {
      const pending = pendingRequests.get(payload.id);
      if (!pending) {
        bufferedResponses.set(
          payload.id,
          payload.error
            ? { kind: "error", error: payload.error }
            : { kind: "result", value: payload.result },
        );
        return;
      }

      pendingRequests.delete(payload.id);
      if (payload.error) {
        pending.reject(
          invalidStateError(
            payload.error.message ?? "Node inspector request failed",
            payload.error,
          ),
        );
        return;
      }

      pending.resolve(payload.result);
      return;
    }

    for (const listener of eventListeners) {
      listener(payload);
    }

    if (payload?.method === "Debugger.paused") {
      resolvePausedEvent(payload as PausedEvent);
    }
  });

  socket.addEventListener("error", () => {
    const error = connectionError(
      readySettled ? "transport.closed" : "transport.unreachable",
      readySettled
        ? "Node inspector connection error"
        : "Failed to connect to Node inspector",
    );

    if (!readySettled) {
      settleReadyFailure(error);
    }

    rejectPendingRequests(error);
    rejectPausedWaiters(error);
  });

  socket.addEventListener("close", () => {
    closed = true;
    const error = connectionError("transport.closed", "Node inspector connection closed");
    if (!readySettled) {
      settleReadyFailure(error);
    }
    rejectPendingRequests(error);
    rejectPausedWaiters(error);
    settleClosed();
  });

  return {
    async send(method, params) {
      if (!readySettled) {
        await ready;
      }

      if (closed) {
        throw connectionError("transport.closed", "Node inspector connection is closed");
      }

      const id = nextId++;
      const response = new Promise<any>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
      });

      socket.send(
        JSON.stringify(
          params === undefined ? { id, method } : { id, method, params },
        ),
      );

      drainBufferedResponse(id);
      return response;
    },

    async close() {
      if (closed) {
        settleClosed();
        await closedPromise;
        return;
      }

      socket.close();

      if (isClosed(socket)) {
        closed = true;
        settleClosed();
      }

      await closedPromise;
    },

    waitForPaused(timeoutMs = 2_000) {
      if (pausedEvents.length > 0) {
        return Promise.resolve(pausedEvents.shift()!);
      }

      return new Promise<PausedEvent>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const index = pausedWaiters.findIndex((waiter) => waiter.timeoutId === timeoutId);
          if (index >= 0) {
            pausedWaiters.splice(index, 1);
          }

          reject(
            machineError(
              "session.invalid_state",
              `Timed out waiting for Debugger.paused after ${timeoutMs}ms`,
              {
                detail_code: "node.inspector.pause_timeout",
              },
            ),
          );
        }, timeoutMs);

        pausedWaiters.push({ resolve, reject, timeoutId });
      });
    },

    takeBufferedPaused() {
      return pausedEvents.shift();
    },

    clearBufferedPaused() {
      pausedEvents.length = 0;
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
  };
}

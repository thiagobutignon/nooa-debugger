type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type PausedEvent = {
  method: "Debugger.paused";
  params?: Record<string, unknown>;
};

type PendingPausedWaiter = {
  resolve: (value: PausedEvent) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

function createConnectionError(message: string): Error {
  return new Error(message);
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

export function createBunCdpClient(wsUrl: string): {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
  waitForPaused(timeoutMs?: number): Promise<PausedEvent>;
} {
  const socket = new WebSocket(wsUrl);
  const pendingRequests = new Map<number, PendingRequest>();
  const pausedEvents: PausedEvent[] = [];
  const pausedWaiters: PendingPausedWaiter[] = [];

  let nextId = 1;
  let closed = false;
  let opened = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveClosed!: () => void;
  let readySettled = false;
  let closedSettled = false;

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

  function failConnection(error: Error) {
    if (!opened) {
      settleReadyFailure(error);
    }
    rejectPendingRequests(error);
    rejectPausedWaiters(error);
  }

  socket.addEventListener("open", () => {
    opened = true;
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
        return;
      }

      pendingRequests.delete(payload.id);
      if (payload.error) {
        const error = createConnectionError(
          payload.error.message ?? "Bun inspector returned an error",
        );
        (error as Error & { cdp_error?: unknown }).cdp_error = payload.error;
        pending.reject(error);
        return;
      }

      pending.resolve(payload);
      return;
    }

    if (payload?.method === "Debugger.paused") {
      resolvePausedEvent(payload as PausedEvent);
    }
  });

  socket.addEventListener("error", () => {
    failConnection(createConnectionError("Failed to connect to Bun inspector"));
  });

  socket.addEventListener("close", () => {
    closed = true;
    if (!opened) {
      settleReadyFailure(createConnectionError("Bun inspector connection closed before opening"));
    }
    rejectPendingRequests(createConnectionError("Bun inspector connection closed"));
    rejectPausedWaiters(createConnectionError("Bun inspector connection closed"));
    settleClosed();
  });

  return {
    async send(method, params) {
      await ready;
      if (closed) {
        throw createConnectionError("Bun inspector connection is closed");
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

      return response;
    },

    async close() {
      if (!closed) {
        closed = true;
        socket.close();
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
            createConnectionError(
              `Timed out waiting for Debugger.paused after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);

        pausedWaiters.push({ resolve, reject, timeoutId });
      });
    },
  };
}

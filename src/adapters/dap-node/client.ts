import {
  createDapRequest,
  isDapEvent,
  isDapResponse,
  type DapEventMessage,
  type DapMessage,
  type DapTransport,
} from "./protocol";

type PendingRequest = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

function createClientError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export type DapClient = {
  request<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  onEvent<TBody = unknown>(
    event: string,
    listener: (message: DapEventMessage<TBody>["body"]) => void,
  ): () => void;
  initialize<T = unknown>(args: Record<string, unknown>): Promise<T>;
  launch<T = unknown>(args: Record<string, unknown>): Promise<T>;
  attach<T = unknown>(args: Record<string, unknown>): Promise<T>;
  pause<T = unknown>(args?: Record<string, unknown>): Promise<T>;
  ["continue"]<T = unknown>(args?: Record<string, unknown>): Promise<T>;
  stackTrace<T = unknown>(args: Record<string, unknown>): Promise<T>;
  scopes<T = unknown>(args: Record<string, unknown>): Promise<T>;
  variables<T = unknown>(args: Record<string, unknown>): Promise<T>;
  evaluate<T = unknown>(args: Record<string, unknown>): Promise<T>;
  dispose(): Promise<void>;
};

export function createDapClient(transport: DapTransport): DapClient {
  let seq = 0;
  const pending = new Map<number, PendingRequest>();
  const eventListeners = new Map<string, Set<(body: unknown) => void>>();

  const unsubscribe = transport.onMessage((message: DapMessage) => {
    if (isDapResponse(message)) {
      const request = pending.get(message.request_seq);
      if (!request) {
        return;
      }

      pending.delete(message.request_seq);

      if (!message.success) {
        request.reject(
          createClientError(
            "dap.request_failed",
            message.message ?? `DAP request failed for ${request.command}`,
          ),
        );
        return;
      }

      request.resolve(message.body);
      return;
    }

    if (isDapEvent(message)) {
      const listeners = eventListeners.get(message.event);
      if (!listeners) {
        return;
      }

      for (const listener of listeners) {
        listener(message.body);
      }
    }
  });

  function request<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const nextSeq = ++seq;
    const message = createDapRequest(nextSeq, command, args);

    return new Promise<T>((resolve, reject) => {
      pending.set(nextSeq, {
        command,
        resolve: (value) => resolve(value as T),
        reject,
      });

      Promise.resolve(transport.send(message)).catch((error) => {
        pending.delete(nextSeq);
        reject(
          createClientError(
            "dap.transport_error",
            error instanceof Error ? error.message : "Failed to send DAP request",
          ),
        );
      });
    });
  }

  function onEvent<TBody = unknown>(
    event: string,
    listener: (body: TBody) => void,
  ): () => void {
    const listeners = eventListeners.get(event) ?? new Set<(body: unknown) => void>();
    listeners.add(listener as (body: unknown) => void);
    eventListeners.set(event, listeners);

    return () => {
      const current = eventListeners.get(event);
      current?.delete(listener as (body: unknown) => void);
      if (current && current.size === 0) {
        eventListeners.delete(event);
      }
    };
  }

  async function dispose(): Promise<void> {
    unsubscribe();

    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(createClientError("dap.closed", "DAP client closed"));
    }
    pending.clear();

    await Promise.resolve(transport.close());
  }

  return {
    request,
    onEvent,
    initialize(args) {
      return request("initialize", args);
    },
    launch(args) {
      return request("launch", args);
    },
    attach(args) {
      return request("attach", args);
    },
    pause(args = {}) {
      return request("pause", args);
    },
    ["continue"](args = {}) {
      return request("continue", args);
    },
    stackTrace(args) {
      return request("stackTrace", args);
    },
    scopes(args) {
      return request("scopes", args);
    },
    variables(args) {
      return request("variables", args);
    },
    evaluate(args) {
      return request("evaluate", args);
    },
    dispose,
  };
}

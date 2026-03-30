export type NodeInspectorEndpoint = {
  wsUrl: string;
  host: string;
  port: number;
};

function transportError(message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = "transport.unreachable";
  return error;
}

export async function fetchNodeInspectorWebSocketUrl(host: string, port: number): Promise<string> {
  try {
    const response = await fetch(`http://${host}:${port}/json/version`);

    if (!response.ok) {
      throw transportError(`transport.unreachable: failed to resolve inspector endpoint at ${host}:${port}`);
    }

    const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (!payload.webSocketDebuggerUrl) {
      throw transportError(`transport.unreachable: missing webSocketDebuggerUrl for ${host}:${port}`);
    }

    return payload.webSocketDebuggerUrl;
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "transport.unreachable") {
      throw error;
    }

    const message = error instanceof Error ? error.message : "unknown fetch failure";
    throw transportError(
      `transport.unreachable: failed to resolve inspector endpoint at ${host}:${port}: ${message}`,
    );
  }
}

export async function resolveNodeInspectorEndpoint(input: {
  wsUrl?: string;
  host?: string;
  port?: number;
}): Promise<NodeInspectorEndpoint> {
  if (input.wsUrl) {
    try {
      const url = new URL(input.wsUrl);
      if (!url.hostname || !url.port) {
        throw transportError("transport.unreachable: invalid ws_url");
      }

      return {
        wsUrl: input.wsUrl,
        host: url.hostname,
        port: Number(url.port),
      };
    } catch {
      throw transportError("transport.unreachable: invalid ws_url");
    }
  }

  if (input.host && input.port) {
    const wsUrl = await fetchNodeInspectorWebSocketUrl(input.host, input.port);

    return {
      wsUrl,
      host: input.host,
      port: input.port,
    };
  }

  throw transportError("transport.unreachable: missing ws_url or host/port");
}

import { Buffer } from "node:buffer";

export type DapRequestMessage = {
  seq: number;
  type: "request";
  command: string;
  arguments?: Record<string, unknown>;
};

export type DapResponseMessage<TBody = unknown> = {
  seq: number;
  type: "response";
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: TBody;
};

export type DapEventMessage<TBody = unknown> = {
  seq: number;
  type: "event";
  event: string;
  body?: TBody;
};

export type DapMessage = DapRequestMessage | DapResponseMessage | DapEventMessage;

export type DapTransport = {
  send(message: DapRequestMessage): void | Promise<void>;
  close(): void | Promise<void>;
  onMessage(listener: (message: DapMessage) => void): () => void;
};

type StdioDapTransportOptions = {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  close?: () => void | Promise<void>;
};

export function createDapRequest(
  seq: number,
  command: string,
  arguments_: Record<string, unknown> | undefined,
): DapRequestMessage {
  return {
    seq,
    type: "request",
    command,
    arguments: arguments_,
  };
}

export function isDapResponse(message: DapMessage): message is DapResponseMessage {
  return message.type === "response";
}

export function isDapEvent(message: DapMessage): message is DapEventMessage {
  return message.type === "event";
}

async function writeFrame(
  stream: NodeJS.WritableStream,
  payload: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(payload, (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function parseHeader(buffer: Buffer): { contentLength: number; headerLength: number } | undefined {
  const separator = buffer.indexOf("\r\n\r\n");
  if (separator < 0) {
    return undefined;
  }

  const header = buffer.subarray(0, separator).toString("utf8");
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new Error("Invalid DAP header: missing Content-Length");
  }

  return {
    contentLength: Number(match[1]),
    headerLength: separator + 4,
  };
}

export function createStdioDapTransport(options: StdioDapTransportOptions): DapTransport {
  let buffer = Buffer.alloc(0);
  const listeners = new Set<(message: DapMessage) => void>();

  const drain = () => {
    while (true) {
      const header = parseHeader(buffer);
      if (!header) {
        return;
      }

      const totalLength = header.headerLength + header.contentLength;
      if (buffer.length < totalLength) {
        return;
      }

      const payload = buffer.subarray(header.headerLength, totalLength).toString("utf8");
      buffer = buffer.subarray(totalLength);

      const message = JSON.parse(payload) as DapMessage;
      for (const listener of listeners) {
        listener(message);
      }
    }
  };

  const onData = (chunk: string | Buffer) => {
    const nextChunk = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    buffer = Buffer.concat([buffer, nextChunk]);
    drain();
  };

  options.stdout.on("data", onData);

  return {
    async send(message) {
      const payload = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
      await writeFrame(options.stdin, `${header}${payload}`);
    },
    onMessage(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      options.stdout.off("data", onData);
      options.stdin.end();
      options.stdout.destroy();
      await options.close?.();
    },
  };
}

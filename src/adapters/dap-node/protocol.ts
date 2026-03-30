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

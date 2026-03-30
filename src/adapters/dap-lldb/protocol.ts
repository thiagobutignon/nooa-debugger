export type DapEvent = {
  event: string;
  body?: Record<string, unknown>;
};

export type DapTransport = {
  request<TResponse = unknown>(
    command: string,
    arguments_?: Record<string, unknown>,
  ): Promise<TResponse>;
  nextEvent(predicate?: (event: DapEvent) => boolean): Promise<DapEvent | undefined>;
  close(): Promise<void>;
};


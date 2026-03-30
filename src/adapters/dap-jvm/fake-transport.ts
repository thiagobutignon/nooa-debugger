import type {
  DapCapabilitySet,
  DapEvaluation,
  DapRequest,
  DapResponse,
  DapScope,
  DapStackFrame,
  DapVariable,
} from "./types";

export type FakeDapTransportOptions = {
  capabilities?: DapCapabilitySet;
  stackFrames?: DapStackFrame[];
  scopes?: DapScope[];
  variables?: DapVariable[];
  evaluation?: DapEvaluation;
};

export type FakeDapTransport = {
  send<TBody = Record<string, unknown>>(request: DapRequest): Promise<DapResponse<TBody>>;
  transcript(): DapRequest[];
};

function buildResponse<TBody>(
  request: DapRequest,
  body?: TBody,
): DapResponse<TBody> {
  return {
    seq: request.seq,
    type: "response",
    request_seq: request.seq,
    success: true,
    command: request.command,
    body,
  };
}

export function createFakeDapTransport(
  options: FakeDapTransportOptions = {},
): FakeDapTransport {
  const transcript: DapRequest[] = [];
  const capabilities: DapCapabilitySet = {
    supportsConfigurationDoneRequest: true,
    ...options.capabilities,
  };

  return {
    async send<TBody = Record<string, unknown>>(request: DapRequest): Promise<DapResponse<TBody>> {
      transcript.push(request);

      switch (request.command) {
        case "initialize":
          return buildResponse(request, { capabilities }) as DapResponse<TBody>;
        case "stackTrace":
          return buildResponse(request, { stackFrames: options.stackFrames ?? [] }) as DapResponse<TBody>;
        case "scopes":
          return buildResponse(request, { scopes: options.scopes ?? [] }) as DapResponse<TBody>;
        case "variables":
          return buildResponse(request, { variables: options.variables ?? [] }) as DapResponse<TBody>;
        case "evaluate":
          return buildResponse(request, {
            result: options.evaluation?.result ?? "",
            type: options.evaluation?.type,
            variablesReference: options.evaluation?.variablesReference,
          }) as DapResponse<TBody>;
        default:
          return buildResponse(request, {}) as DapResponse<TBody>;
      }
    },

    transcript() {
      return transcript.slice();
    },
  };
}

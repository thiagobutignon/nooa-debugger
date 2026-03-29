export type JsonSuccess<T> = {
  ok: true;
  data: T;
};

export type JsonFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    session_id?: string;
    investigation_id?: string;
    suggested_next_commands?: string[];
  };
};

type JsonErrorOptions = {
  recoverable?: boolean;
  session_id?: string;
  investigation_id?: string;
  suggested_next_commands?: string[];
};

export function jsonSuccess<T>(data: T): JsonSuccess<T> {
  return { ok: true, data };
}

export function jsonError(
  code: string,
  message: string,
  options: JsonErrorOptions = {},
): JsonFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      recoverable: options.recoverable ?? false,
      session_id: options.session_id,
      investigation_id: options.investigation_id,
      suggested_next_commands: options.suggested_next_commands,
    },
  };
}

export function writeJson<T>(write: (chunk: string) => void, payload: T): void {
  write(`${JSON.stringify(payload, null, 2)}\n`);
}

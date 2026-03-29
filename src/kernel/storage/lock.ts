import { open, unlink } from "node:fs/promises";

export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  timeoutMs = 2_000,
): Promise<T> {
  const startedAt = Date.now();

  for (;;) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(`${process.pid}`);
      await handle.close();
      try {
        return await fn();
      } finally {
        await unlink(path).catch(() => {});
      }
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) {
        throw error;
      }
      await Bun.sleep(10);
    }
  }
}

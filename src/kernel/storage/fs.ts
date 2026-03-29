import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJsonAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(dirname(path));
  const tempPath = `${path}.tmp-${crypto.randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    await access(path, constants.F_OK);
  } catch {
    return undefined;
  }

  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function listJsonFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(path, entry.name))
      .sort();
  } catch {
    return [];
  }
}

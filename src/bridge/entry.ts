#!/usr/bin/env bun
import { writeJsonAtomically } from "../kernel/storage/fs";
import { startBridgeServer } from "./server";

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      continue;
    }

    values[key.slice(2)] = value;
  }

  return values;
}

const args = parseArgs(Bun.argv.slice(2));
const wsUrl = args["ws-url"];
const readyPath = args["ready-path"];

if (!wsUrl || !readyPath) {
  process.exit(1);
}

try {
  await startBridgeServer({
    wsUrl,
    readyPath,
  });
} catch (error) {
  await writeJsonAtomically(readyPath, {
    host: "127.0.0.1",
    port: 0,
    token: "",
    bridge_pid: process.pid,
    error: error instanceof Error ? error.message : "Debug bridge failed to start",
  });
  process.exit(1);
}


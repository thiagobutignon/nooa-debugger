import { expect, test } from "bun:test";
import { main } from "../../index";

test("debug backends returns the backend capability catalog", async () => {
  const writes: string[] = [];

  await main(["debug", "backends"], {
    write: (chunk) => writes.push(chunk),
    cwd: process.cwd(),
  });

  const payload = JSON.parse(writes.join("").trim());
  expect(payload.ok).toBe(true);
  expect(payload.data.backends.some((backend: { backend_id: string }) => backend.backend_id === "bun-inspector")).toBe(true);
  expect(payload.data.backends.some((backend: { backend_id: string; protocol: string }) => backend.backend_id === "dap-node" && backend.protocol === "dap")).toBe(true);
});

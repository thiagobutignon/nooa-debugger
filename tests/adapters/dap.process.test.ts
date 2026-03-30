import { expect, test } from "bun:test";
import { createDapClient } from "../../src/adapters/dap-node/client";

const ECHO_SERVER = `
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  while (true) {
    const separator = buffer.indexOf("\\r\\n\\r\\n");
    if (separator < 0) break;
    const header = buffer.subarray(0, separator).toString("utf8");
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) throw new Error("missing Content-Length");
    const size = Number(match[1]);
    const frameEnd = separator + 4 + size;
    if (buffer.length < frameEnd) break;
    const payload = JSON.parse(buffer.subarray(separator + 4, frameEnd).toString("utf8"));
    buffer = buffer.subarray(frameEnd);
    const response = JSON.stringify({
      seq: 1,
      type: "response",
      request_seq: payload.seq,
      success: true,
      command: payload.command,
      body: { echoedCommand: payload.command },
    });
    process.stdout.write(\`Content-Length: \${Buffer.byteLength(response, "utf8")}\\r\\n\\r\\n\${response}\`);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

test("spawnDapProcess exchanges DAP requests and responses over child stdio", async () => {
  const { spawnDapProcess } = await import("../../src/adapters/dap/process");
  const child = spawnDapProcess({
    command: "node",
    args: ["-e", ECHO_SERVER],
  });
  const client = createDapClient(child.transport);

  const response = await client.initialize({
    adapterID: "node",
  });

  expect(response).toEqual({
    echoedCommand: "initialize",
  });

  await client.dispose();
  const exitCode = await child.waitForExit();

  expect(exitCode).toBe(0);
  expect(child.stderr()).toBe("");
});

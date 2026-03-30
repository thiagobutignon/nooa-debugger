import { expect, test } from "bun:test";
import { createFakeDapTransport } from "../../../src/adapters/dap-jvm/fake-transport";

test("fake DAP transport records requests and returns initialized capabilities", async () => {
  const transport = createFakeDapTransport({
    capabilities: {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
    },
  });

  const response = await transport.send({
    seq: 1,
    type: "request",
    command: "initialize",
    arguments: { adapterID: "jvm" },
  });

  expect(response.success).toBe(true);
  expect(response.body?.capabilities?.supportsConfigurationDoneRequest).toBe(true);
  expect(response.body?.capabilities?.supportsEvaluateForHovers).toBe(true);
  expect(transport.transcript()).toEqual([
    {
      seq: 1,
      type: "request",
      command: "initialize",
      arguments: { adapterID: "jvm" },
    },
  ]);
});

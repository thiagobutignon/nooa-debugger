import { expect, test } from "bun:test";
import { getBackendCatalog, getBackendDescriptor } from "../../src/kernel/backends";

test("backend catalog lists bun and DAP backend families", () => {
  const catalog = getBackendCatalog();
  expect(catalog.map((backend) => backend.backend_id)).toEqual([
    "bun-inspector",
    "dap-node",
    "dap-go",
    "dap-lldb",
    "dap-jvm",
  ]);
});

test("backend descriptors expose protocol family and capability state", () => {
  const bun = getBackendDescriptor("bun-inspector");
  expect(bun?.protocol).toBe("bun-inspector");
  expect(bun?.status).toBe("available");
  expect(bun?.capabilities.continue).toBe("available");

  const node = getBackendDescriptor("dap-node");
  expect(node?.protocol).toBe("dap");
  expect(node?.status).toBe("contract_only");
  expect(node?.notes?.some((note) => note.includes("backend facade"))).toBe(true);

  const lldb = getBackendDescriptor("dap-lldb");
  expect(lldb?.protocol).toBe("dap");
  expect(lldb?.status).toBe("contract_only");
  expect(lldb?.notes?.some((note) => note.includes("LLDB facade"))).toBe(true);
  expect(lldb?.languages).toContain("swift");
  expect(lldb?.languages).toContain("rust");

  const go = getBackendDescriptor("dap-go");
  expect(go?.status).toBe("contract_only");
  expect(go?.notes?.some((note) => note.includes("Go session facade"))).toBe(true);
});

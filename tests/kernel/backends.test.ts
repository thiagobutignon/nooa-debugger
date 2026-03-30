import { expect, test } from "bun:test";
import { getBackendCatalog, getBackendDescriptor } from "../../src/kernel/backends";

test("backend catalog lists bun and planned dap families", () => {
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

  const lldb = getBackendDescriptor("dap-lldb");
  expect(lldb?.protocol).toBe("dap");
  expect(lldb?.status).toBe("planned");
  expect(lldb?.languages).toContain("swift");
  expect(lldb?.languages).toContain("rust");
});

import { expect, test } from "bun:test";
import { toJvmPausedSnapshot } from "../../../src/adapters/dap-jvm/mapping";

test("maps DAP stack frames and locals into an AI-first paused snapshot", () => {
  const snapshot = toJvmPausedSnapshot({
    reason: "breakpoint",
    threadId: 17,
    frames: [
      {
        id: 99,
        name: "main",
        sourcePath: "src/main/java/com/example/Main.java",
        line: 27,
        column: 5,
      },
      {
        id: 100,
        name: "helper",
        sourcePath: "src/main/java/com/example/Helper.java",
        line: 12,
        column: 1,
      },
    ],
    locals: [
      {
        name: "count",
        value: "41",
        type: "int",
      },
      {
        name: "message",
        value: "hello",
        type: "java.lang.String",
      },
    ],
  });

  expect(snapshot.reason).toBe("breakpoint");
  expect(snapshot.selected_thread_id).toBe(17);
  expect(snapshot.top_frame.function_name).toBe("main");
  expect(snapshot.top_frame.location.file).toBe("src/main/java/com/example/Main.java");
  expect(snapshot.frames[0].frame_ref).toBe("frame-0");
  expect(snapshot.frames[1].frame_ref).toBe("frame-1");
  expect(snapshot.locals).toEqual([
    {
      frame_ref: "frame-0",
      name: "count",
      value: "41",
      type: "int",
    },
    {
      frame_ref: "frame-0",
      name: "message",
      value: "hello",
      type: "java.lang.String",
    },
  ]);
});

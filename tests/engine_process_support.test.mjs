import test from "node:test";
import assert from "node:assert/strict";

import { isIgnorableStdinError, runChild } from "../src/engine_process_support.mjs";

test("stdin broken pipe 错误会被识别为可忽略错误", () => {
  assert.equal(isIgnorableStdinError({ code: "EPIPE", message: "write EPIPE" }), true);
  assert.equal(isIgnorableStdinError({ code: "ERR_STREAM_DESTROYED", message: "Cannot call write after a stream was destroyed" }), true);
  assert.equal(isIgnorableStdinError({ code: "EPERM", message: "permission denied" }), false);
});

test("runChild 在子进程提前关闭 stdin 时不会因 EPIPE 崩溃", async (t) => {
  if (process.platform === "win32") {
    t.skip("该回归主要覆盖 Linux/macOS CI 上的 EPIPE 场景。");
    return;
  }

  const result = await runChild("sh", ["-lc", "exec 0<&-; exit 0"], {
    stdin: "hello from helloloop",
  });

  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.code, "number");
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});

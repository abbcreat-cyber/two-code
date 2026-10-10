import test from "node:test";
import assert from "node:assert/strict";
import { formatSessionDuration } from "./formatSessionDuration.js";

test("duration rounds before splitting minutes and keeps unknown duration unavailable", () => {
  assert.equal(formatSessionDuration(null, true), "—");
  assert.equal(formatSessionDuration(0, true), "0.0秒");
  assert.equal(formatSessionDuration(59940, true), "59.9秒");
  assert.equal(formatSessionDuration(59950, true), "1分0秒");
  assert.equal(formatSessionDuration(119600, true), "2分0秒");
  assert.equal(formatSessionDuration(119600, false), "2m 0s");
});

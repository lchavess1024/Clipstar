import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedInputType, mergeTextAtSelection } from "../../extension/lib/text.js";

test("inserts text at a selection without losing surrounding content", () => {
  assert.deepEqual(mergeTextAtSelection("Hello brave world", 6, 11, "Clipstar"), {
    value: "Hello Clipstar world",
    cursor: 14
  });
});

test("clamps invalid selection positions", () => {
  assert.deepEqual(mergeTextAtSelection("abc", -20, 99, "x"), {
    value: "x",
    cursor: 1
  });
  assert.deepEqual(mergeTextAtSelection("abc", undefined, undefined, "x"), {
    value: "abcx",
    cursor: 4
  });
});

test("excludes number and non-text input types", () => {
  assert.equal(isSupportedInputType("text"), true);
  assert.equal(isSupportedInputType("email"), true);
  assert.equal(isSupportedInputType("number"), false);
  assert.equal(isSupportedInputType("date"), false);
});

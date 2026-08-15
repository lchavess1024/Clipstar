import test from "node:test";
import assert from "node:assert/strict";
import { createMutationQueue } from "../../extension/lib/mutation-queue.js";
import { cleanStore } from "../../extension/lib/store.js";

test("overlapping writers are serialized and a stale revision cannot overwrite data", async () => {
  let current = cleanStore({ folders: [], snippets: [] });
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const queue = createMutationQueue({
    load: async () => structuredClone(current),
    save: async (next) => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await delay(10);
      current = structuredClone(next);
      activeWrites -= 1;
      return structuredClone(current);
    }
  });

  const first = queue.enqueue(newClip("First", "One"), 0);
  const stale = queue.enqueue(newClip("Stale", "Two"), 0);

  const saved = await first;
  await assert.rejects(stale, (error) => {
    assert.equal(error.code, "CONFLICT");
    assert.equal(error.currentRevision, 1);
    return true;
  });
  await queue.idle();

  assert.equal(saved.revision, 1);
  assert.deepEqual(current.snippets.map((snippet) => snippet.title), ["First"]);
  assert.equal(maximumActiveWrites, 1);
});

test("the queue continues after a conflict and preserves sequential changes", async () => {
  let current = cleanStore({ folders: [], snippets: [] });
  const queue = createMutationQueue({
    load: async () => structuredClone(current),
    save: async (next) => {
      await delay(2);
      current = structuredClone(next);
      return structuredClone(current);
    }
  });

  const first = queue.enqueue(newClip("First", "One"), 0);
  const second = queue.enqueue(newClip("Second", "Two"), 1);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.revision, 1);
  assert.equal(secondResult.revision, 2);
  assert.deepEqual(current.snippets.map((snippet) => snippet.title), ["First", "Second"]);
});

function newClip(title, body) {
  return { kind: "upsertSnippet", payload: { title, body, folderId: "" } };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

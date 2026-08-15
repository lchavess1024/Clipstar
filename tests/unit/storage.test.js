import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_SNIPPET_KEYS,
  LEGACY_STORE_KEYS,
  STORAGE_KEY
} from "../../extension/lib/constants.js";
import { loadStore, saveStore } from "../../extension/lib/storage.js";

test("migrates a valid legacy clip list before removing only its source key", async () => {
  const legacyKey = LEGACY_SNIPPET_KEYS[0];
  const storage = fakeStorage({
    [legacyKey]: [{
      id: "old-clip",
      title: "Legacy clip",
      body: "Preserved text",
      category: "Support"
    }]
  });

  const store = await loadStore(storage);

  assert.equal(store.snippets.length, 1);
  assert.equal(store.snippets[0].body, "Preserved text");
  assert.equal(storage.values[STORAGE_KEY].snippets.length, 1);
  assert.deepEqual(storage.removed, [legacyKey]);
});

test("does not write or delete an oversized legacy clip list", async () => {
  const legacyKey = LEGACY_SNIPPET_KEYS[0];
  const legacyClips = Array.from({ length: 501 }, (_, index) => ({
    id: `old-${index}`,
    title: `Legacy ${index}`,
    body: "Preserve me"
  }));
  const storage = fakeStorage({ [legacyKey]: legacyClips });

  await assert.rejects(() => loadStore(storage), /could not migrate it safely.*500 clips/i);
  assert.equal(storage.setCalls, 0);
  assert.deepEqual(storage.removed, []);
  assert.equal(storage.values[legacyKey].length, 501);
});

test("does not delete legacy keys when a current collection already exists", async () => {
  const legacyKey = LEGACY_STORE_KEYS[0];
  const current = {
    version: 1,
    revision: 3,
    folders: [],
    snippets: [{ id: "current", title: "Current", body: "Keep", folderId: "" }]
  };
  const storage = fakeStorage({
    [STORAGE_KEY]: current,
    [legacyKey]: { version: 1, revision: 0, folders: [], snippets: [] }
  });

  const store = await loadStore(storage);

  assert.equal(store.revision, 3);
  assert.deepEqual(storage.removed, []);
  assert.ok(storage.values[legacyKey]);
});

test("migrates an empty legacy list without adding the welcome clip", async () => {
  const legacyKey = LEGACY_SNIPPET_KEYS[0];
  const storage = fakeStorage({ [legacyKey]: [] });

  const store = await loadStore(storage);

  assert.equal(store.snippets.length, 0);
  assert.deepEqual(storage.removed, [legacyKey]);
});

test("preserves an unreadable current store instead of replacing it", async () => {
  const corrupt = { unexpected: "valuable raw data" };
  const storage = fakeStorage({ [STORAGE_KEY]: corrupt });

  await assert.rejects(() => loadStore(storage), (error) => {
    assert.equal(error.code, "CORRUPT_STORE");
    return true;
  });
  assert.equal(storage.setCalls, 0);
  assert.deepEqual(storage.values[STORAGE_KEY], corrupt);
});

test("saveStore normalizes and persists a valid collection", async () => {
  const storage = fakeStorage({});
  const saved = await saveStore({
    version: 1,
    revision: 1,
    folders: [],
    snippets: [{ id: "clip", title: " Saved ", body: "Text", folderId: "" }]
  }, storage);

  assert.equal(storage.setCalls, 1);
  assert.equal(saved.snippets[0].title, "Saved");
  assert.deepEqual(storage.values[STORAGE_KEY], saved);
});

function fakeStorage(initialValues) {
  const storage = {
    values: structuredClone(initialValues),
    removed: [],
    setCalls: 0,
    async get() {
      return structuredClone(storage.values);
    },
    async set(update) {
      storage.setCalls += 1;
      Object.assign(storage.values, structuredClone(update));
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      storage.removed.push(...list);
      for (const key of list) delete storage.values[key];
    }
  };
  return storage;
}

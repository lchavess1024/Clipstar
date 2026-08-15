import test from "node:test";
import assert from "node:assert/strict";
import {
  StoreError,
  applyMutation,
  cleanStore,
  createDefaultStore,
  mergeStores,
  migrateLegacySnippets,
  parseImportPayload,
  assertStoreWithinLimit,
  makeExportPayload,
  serializedBytes
} from "../../extension/lib/store.js";
import { LIMITS } from "../../extension/lib/constants.js";

test("creates a valid first-run store", () => {
  const store = createDefaultStore("2026-08-14T00:00:00.000Z");
  assert.equal(store.version, 1);
  assert.equal(store.revision, 0);
  assert.equal(store.snippets.length, 1);
  assert.match(store.snippets[0].body, /local extension storage/i);
});

test("normalizes malformed records, duplicate IDs, cycles, and excessive depth", () => {
  const ids = sequence("generated-folder", "generated-snippet");
  const store = cleanStore(
    {
      folders: [
        null,
        { id: "root", name: " Root ", parentId: "" },
        { id: "child", name: "Child", parentId: "root" },
        { id: "grandchild", name: "Grandchild", parentId: "child" },
        { id: "cycle-a", name: "A", parentId: "cycle-b" },
        { id: "cycle-b", name: "B", parentId: "cycle-a" },
        { id: "child", name: "Duplicate", parentId: "root" }
      ],
      snippets: [
        null,
        { id: "clip", title: "Valid", body: "Text", folderId: "grandchild" },
        { id: "clip", title: "Duplicate", body: "More", folderId: "missing" },
        { id: "empty", title: "Empty", body: "   " }
      ]
    },
    { idFactory: ids, now: "2026-08-14T00:00:00.000Z" }
  );

  assert.equal(store.folders.length, 6);
  assert.equal(store.snippets.length, 2);
  assert.equal(store.folders.find((folder) => folder.id === "grandchild").parentId, "root");
  assert.equal(store.folders.find((folder) => folder.id === "cycle-a").parentId, "");
  assert.equal(store.folders.find((folder) => folder.id === "cycle-b").parentId, "");
  assert.equal(new Set(store.folders.map((folder) => folder.id)).size, store.folders.length);
  assert.equal(new Set(store.snippets.map((snippet) => snippet.id)).size, store.snippets.length);
  assert.equal(store.snippets.find((snippet) => snippet.title === "Duplicate").folderId, "");
});

test("merging an ID collision never reparents an existing folder", () => {
  const current = cleanStore({
    folders: [
      { id: "root", name: "Current root", parentId: "" },
      { id: "current-child", name: "Current child", parentId: "root" }
    ],
    snippets: []
  });
  const incoming = cleanStore({
    folders: [
      { id: "root", name: "Imported root", parentId: "" },
      { id: "imported-child", name: "Imported child", parentId: "root" }
    ],
    snippets: [{ id: "imported-clip", title: "Imported", body: "Hello", folderId: "root" }]
  });

  const merged = mergeStores(current, incoming, {
    idFactory: sequence("new-imported-root"),
    now: "2026-08-14T00:00:00.000Z"
  });

  assert.equal(merged.folders.find((folder) => folder.id === "current-child").parentId, "root");
  assert.equal(merged.folders.find((folder) => folder.name === "Imported child").parentId, "new-imported-root");
  assert.equal(merged.snippets[0].folderId, "new-imported-root");
});

test("migrates legacy category and child-folder clips", () => {
  const migrated = migrateLegacySnippets(
    [
      {
        id: "legacy-clip",
        title: "Reset response",
        body: "Done",
        category: "Support",
        childFolder: "Identity"
      }
    ],
    {
      idFactory: sequence("support", "identity"),
      now: "2026-08-14T00:00:00.000Z"
    }
  );

  assert.equal(migrated.folders.length, 2);
  assert.equal(migrated.folders.find((folder) => folder.id === "identity").parentId, "support");
  assert.equal(migrated.snippets[0].folderId, "identity");
});

test("serial mutations preserve both writers' changes", () => {
  const empty = cleanStore({ folders: [], snippets: [] });
  const first = applyMutation(
    empty,
    { kind: "upsertSnippet", payload: { title: "First", body: "One", folderId: "" } },
    { idFactory: sequence("first-id"), now: "2026-08-14T00:00:00.000Z" }
  );
  const second = applyMutation(
    first,
    { kind: "upsertSnippet", payload: { title: "Second", body: "Two", folderId: "" } },
    { idFactory: sequence("second-id"), now: "2026-08-14T00:00:01.000Z" }
  );

  assert.deepEqual(second.snippets.map((snippet) => snippet.title), ["First", "Second"]);
  assert.equal(second.revision, 2);
});

test("folder deletion moves affected clips to standalone", () => {
  const initial = cleanStore({
    folders: [
      { id: "root", name: "Root", parentId: "" },
      { id: "child", name: "Child", parentId: "root" }
    ],
    snippets: [
      { id: "root-clip", title: "Root clip", body: "A", folderId: "root" },
      { id: "child-clip", title: "Child clip", body: "B", folderId: "child" }
    ]
  });
  const next = applyMutation(
    initial,
    { kind: "deleteFolder", payload: { id: "root" } },
    { now: "2026-08-14T00:00:00.000Z" }
  );

  assert.equal(next.folders.length, 0);
  assert.ok(next.snippets.every((snippet) => snippet.folderId === ""));
});

test("rejects malformed imports and incomplete clips", () => {
  assert.throws(() => parseImportPayload({ hello: "world" }), StoreError);
  assert.throws(
    () => applyMutation(cleanStore({ folders: [], snippets: [] }), {
      kind: "upsertSnippet",
      payload: { title: "Missing body", body: "" }
    }),
    /both a label and body/i
  );
});

test("rejects an import that would silently exceed collection limits", () => {
  const current = cleanStore({
    folders: [],
    snippets: Array.from({ length: 500 }, (_, index) => ({
      id: `current-${index}`,
      title: `Current ${index}`,
      body: "Saved"
    }))
  });
  const incoming = cleanStore({
    folders: [],
    snippets: [{ id: "incoming", title: "Incoming", body: "New" }]
  });

  assert.throws(() => mergeStores(current, incoming), /500-clip limit/i);
});

test("a maximum-size valid store still fits the raw import-file allowance", () => {
  const snippets = Array.from({ length: 84 }, (_, index) => ({
    id: `boundary-${index}`,
    title: `Boundary ${index}`,
    body: index < 83 ? "x".repeat(LIMITS.bodyLength) : "x",
    folderId: "",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z"
  }));
  const store = cleanStore({ folders: [], snippets }, { now: "2026-08-14T00:00:00.000Z" });
  const remainingBytes = LIMITS.storeBytes - serializedBytes(store) - 100;
  assert.ok(remainingBytes > 0 && remainingBytes < LIMITS.bodyLength);
  store.snippets.at(-1).body += "x".repeat(remainingBytes);
  assertStoreWithinLimit(store);

  const exportText = JSON.stringify(makeExportPayload(store, "2026-08-14T00:00:00.000Z"), null, 2);
  const exportBytes = new TextEncoder().encode(exportText).byteLength;

  assert.ok(exportBytes > LIMITS.storeBytes);
  assert.ok(exportBytes <= LIMITS.importBytes);
  assert.equal(parseImportPayload(JSON.parse(exportText)).snippets.length, 84);
});

function sequence(...values) {
  let index = 0;
  return () => values[index++] || `generated-${index}`;
}

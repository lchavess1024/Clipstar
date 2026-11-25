import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, STORAGE_KEY } from "../../extension/lib/constants.js";
import { insertClipInPage } from "../../extension/lib/insert.js";
import { cleanStore } from "../../extension/lib/store.js";

test("context menu uses native separators between sections without leading or trailing lines", async (t) => {
  const menus = [];
  let store;
  let onMessage;
  let onMenuClick;
  let onExecuteScript;
  const unusedEvent = { addListener() {} };
  const chrome = {
    runtime: {
      id: "clipstar-test",
      onInstalled: unusedEvent,
      onStartup: unusedEvent,
      onMessage: { addListener(listener) { onMessage = listener; } }
    },
    storage: {
      onChanged: unusedEvent,
      local: { async get() { return { [STORAGE_KEY]: store }; } }
    },
    contextMenus: {
      onClicked: { addListener(listener) { onMenuClick = listener; } },
      removeAll(done) {
        menus.length = 0;
        done();
      },
      create(properties, done) {
        assert.ok(!menus.some(({ id }) => id === properties.id), `Duplicate menu ID ${properties.id}`);
        menus.push(properties);
        done();
      }
    },
    scripting: {
      async executeScript(properties) {
        onExecuteScript(properties);
        return [{ result: { ok: true } }];
      }
    },
    action: {
      async setBadgeText() {},
      async setTitle() {}
    }
  };
  globalThis.chrome = chrome;
  t.after(() => { delete globalThis.chrome; });
  await import("../../extension/background.js");

  async function rebuild(collection) {
    store = cleanStore(collection);
    const result = await new Promise((resolve) => {
      assert.equal(onMessage({ type: "MENUS_REBUILD" }, { id: chrome.runtime.id }, resolve), true);
    });
    assert.deepEqual(result, { ok: true });
  }

  function assertMenu(parentId, expected) {
    const items = menus.filter((item) => item.parentId === parentId);
    assert.deepEqual(items.map(({ id, type }) => ({ id, type: type ?? "normal" })), expected);
  }

  await t.test("separates standalone clips, folders, direct clips, and subfolders", async () => {
    await rebuild({
      folders: [
        { id: "replies", name: "Replies" },
        { id: "notes", name: "Notes" },
        { id: "followups", name: "Follow-ups", parentId: "replies" },
        { id: "greetings", name: "Greetings", parentId: "replies" },
        { id: "archive", name: "Archive", parentId: "notes" },
        { id: "drafts", name: "Drafts", parentId: "notes" }
      ],
      snippets: [
        { id: "standalone", title: "Standalone clip", body: "Root" },
        { id: "reply", title: "Sample reply", body: "Hello", folderId: "replies" },
        { id: "followup", title: "Sample follow-up", body: "Thanks", folderId: "followups" }
      ]
    });

    assertMenu("clipstar-root", [
      { id: "clipstar-open", type: "normal" },
      { id: "clipstar-separator", type: "separator" },
      { id: "snippet:standalone", type: "normal" },
      { id: "clipstar-folders-separator", type: "separator" },
      { id: "folder:replies", type: "normal" },
      { id: "folder:notes", type: "normal" }
    ]);
    assertMenu("folder:replies", [
      { id: "snippet:reply", type: "normal" },
      { id: "separator:replies", type: "separator" },
      { id: "folder:followups", type: "normal" },
      { id: "folder:greetings", type: "normal" }
    ]);
    assertMenu("folder:notes", [
      { id: "folder:archive", type: "normal" },
      { id: "folder:drafts", type: "normal" }
    ]);
    assertMenu("folder:followups", [{ id: "snippet:followup", type: "normal" }]);
    assertMenu("folder:greetings", [{ id: "empty:greetings", type: "normal" }]);
  });

  await t.test("groups folder-only items in their saved order", async () => {
    await rebuild({
      folders: [
        { id: "first", name: "First", position: 1 },
        { id: "second", name: "Second", position: 0 }
      ],
      snippets: []
    });

    assertMenu("clipstar-root", [
      { id: "clipstar-open", type: "normal" },
      { id: "clipstar-separator", type: "separator" },
      { id: "folder:second", type: "normal" },
      { id: "folder:first", type: "normal" }
    ]);
  });

  await t.test("puts pinned clips in their own alphabetized section", async () => {
    await rebuild({
      folders: [{ id: "replies", name: "Replies" }],
      snippets: [
        { id: "grouped", title: "Zebra", body: "Hello", folderId: "replies", pinned: true },
        { id: "pinned", title: "Apple", body: "Hello", pinned: true },
        { id: "standalone", title: "Standalone clip", body: "Root" }
      ]
    });

    assertMenu("clipstar-root", [
      { id: "clipstar-open", type: "normal" },
      { id: "clipstar-separator", type: "separator" },
      { id: "pinned-snippet:pinned", type: "normal" },
      { id: "pinned-snippet:grouped", type: "normal" },
      { id: "clipstar-standalone-separator", type: "separator" },
      { id: "snippet:standalone", type: "normal" },
      { id: "clipstar-folders-separator", type: "separator" },
      { id: "folder:replies", type: "normal" }
    ]);
    assertMenu("folder:replies", [{ id: "snippet:grouped", type: "normal" }]);
    assert.equal(menus.find(({ id }) => id === "pinned-snippet:grouped").title, "★ Zebra");
  });

  await t.test("keeps all folders and clips visible when pins fill the quick-access section", async () => {
    await rebuild({
      folders: Array.from({ length: LIMITS.folderCount }, (_, index) => ({
        id: `folder-${index}`, name: `Folder ${index}`
      })),
      snippets: Array.from({ length: LIMITS.snippetCount }, (_, index) => ({
        id: `clip-${index}`,
        title: `Clip ${String(index).padStart(3, "0")}`,
        body: "Hello",
        folderId: index === LIMITS.snippetCount - 1 ? "" : "folder-0",
        pinned: true
      }))
    });

    assert.ok(menus.length < 1000);
    assert.equal(menus.filter(({ id }) => id.startsWith("pinned-snippet:")).length, LIMITS.menuPinCount);
    assert.equal(menus.filter(({ id }) => id.startsWith("folder:")).length, LIMITS.folderCount);
    assert.equal(menus.filter(({ id }) => id.startsWith("snippet:")).length, LIMITS.snippetCount);
    assert.ok(menus.some(({ id, parentId }) => id === `snippet:clip-${LIMITS.snippetCount - 1}`
      && parentId === "clipstar-root"));
  });

  await t.test("inserts the same clip from its pinned entry and its folder", async () => {
    await rebuild({
      folders: [{ id: "replies", name: "Replies" }],
      snippets: [{ id: "reply", title: "Greeting", body: "Hello", folderId: "replies", pinned: true }]
    });

    assertMenu("clipstar-root", [
      { id: "clipstar-open", type: "normal" },
      { id: "clipstar-separator", type: "separator" },
      { id: "pinned-snippet:reply", type: "normal" },
      { id: "clipstar-folders-separator", type: "separator" },
      { id: "folder:replies", type: "normal" }
    ]);
    for (const id of ["pinned-snippet:reply", "snippet:reply"]) {
      const execution = new Promise((resolve) => { onExecuteScript = resolve; });
      onMenuClick({ menuItemId: id, frameId: 3 }, { id: 12 });
      assert.deepEqual(await execution, {
        target: { tabId: 12, frameIds: [3] },
        world: "MAIN",
        func: insertClipInPage,
        args: ["Hello", "Greeting"]
      });
    }
  });

  await t.test("keeps the empty root menu free of separators", async () => {
    await rebuild({ folders: [], snippets: [] });

    assertMenu("clipstar-root", [
      { id: "clipstar-open", type: "normal" },
      { id: "clipstar-empty", type: "normal" }
    ]);
  });
});

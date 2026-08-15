import { APP_NAME, STORAGE_KEY } from "./lib/constants.js";
import { copyClipInPage, insertClipInPage, showClipstarToast } from "./lib/insert.js";
import { createMutationQueue } from "./lib/mutation-queue.js";
import { loadStore, saveStore } from "./lib/storage.js";

const ROOT_MENU_ID = "clipstar-root";
const OPEN_MENU_ID = "clipstar-open";
const SEPARATOR_ID = "clipstar-separator";
const mutationQueue = createMutationQueue({ load: loadStore, save: saveStore });
let menuRebuildRequested = false;
let activeMenuRebuild = null;

chrome.runtime.onInstalled.addListener(() => initialize().catch(reportBackgroundError));
chrome.runtime.onStartup.addListener(() => initialize().catch(reportBackgroundError));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return false;

  if (message.type === "STORE_GET") {
    mutationQueue.idle()
      .then(() => loadStore())
      .then((store) => sendResponse({ ok: true, store }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message.type === "STORE_MUTATE") {
    mutationQueue.enqueue(message.mutation, message.expectedRevision)
      .then((store) => sendResponse({ ok: true, store }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message.type === "MENUS_REBUILD") {
    scheduleMenuRebuild()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    scheduleMenuRebuild().catch(reportBackgroundError);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch(reportBackgroundError);
});

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await loadStore();
  await scheduleMenuRebuild();
}

function scheduleMenuRebuild() {
  menuRebuildRequested = true;
  if (!activeMenuRebuild) {
    activeMenuRebuild = (async () => {
      while (menuRebuildRequested) {
        menuRebuildRequested = false;
        await rebuildContextMenus();
      }
    })().finally(() => {
      activeMenuRebuild = null;
    });
  }
  return activeMenuRebuild;
}

async function rebuildContextMenus() {
  const store = await loadStore();
  await removeAllMenus();
  await createMenu({ id: ROOT_MENU_ID, title: APP_NAME, contexts: ["editable"] });
  await createMenu({
    id: OPEN_MENU_ID,
    parentId: ROOT_MENU_ID,
    title: `Open ${APP_NAME}`,
    contexts: ["editable"]
  });

  const standalone = store.snippets
    .filter((snippet) => !snippet.folderId)
    .sort(sortByPositionThenTitle);
  const rootFolders = store.folders
    .filter((folder) => !folder.parentId)
    .sort(sortByPositionThenName);

  if (standalone.length || rootFolders.length) {
    await createMenu({
      id: SEPARATOR_ID,
      parentId: ROOT_MENU_ID,
      type: "separator",
      contexts: ["editable"]
    });
  }
  for (const snippet of standalone) await createSnippetMenu(snippet, ROOT_MENU_ID);
  for (const folder of rootFolders) await createFolderMenu(folder, ROOT_MENU_ID, store);
  if (!standalone.length && !rootFolders.length) {
    await createMenu({
      id: "clipstar-empty",
      parentId: ROOT_MENU_ID,
      title: "No clips saved",
      enabled: false,
      contexts: ["editable"]
    });
  }
}

async function createFolderMenu(folder, parentMenuId, store) {
  const menuId = `folder:${folder.id}`;
  await createMenu({
    id: menuId,
    parentId: parentMenuId,
    title: menuTitle(folder.name, "Untitled folder"),
    contexts: ["editable"]
  });

  const directSnippets = store.snippets
    .filter((snippet) => snippet.folderId === folder.id)
    .sort(sortByPositionThenTitle);
  const childFolders = store.folders
    .filter((child) => child.parentId === folder.id)
    .sort(sortByPositionThenName);
  for (const snippet of directSnippets) await createSnippetMenu(snippet, menuId);

  for (const child of childFolders) {
    const childMenuId = `folder:${child.id}`;
    await createMenu({
      id: childMenuId,
      parentId: menuId,
      title: menuTitle(child.name, "Untitled subfolder"),
      contexts: ["editable"]
    });
    const childSnippets = store.snippets
      .filter((snippet) => snippet.folderId === child.id)
      .sort(sortByPositionThenTitle);
    if (!childSnippets.length) {
      await createMenu({
        id: `empty:${child.id}`,
        parentId: childMenuId,
        title: "No clips",
        enabled: false,
        contexts: ["editable"]
      });
    }
    for (const snippet of childSnippets) await createSnippetMenu(snippet, childMenuId);
  }

  if (!directSnippets.length && !childFolders.length) {
    await createMenu({
      id: `empty:${folder.id}`,
      parentId: menuId,
      title: "No clips",
      enabled: false,
      contexts: ["editable"]
    });
  }
}

async function createSnippetMenu(snippet, parentId) {
  await createMenu({
    id: `snippet:${snippet.id}`,
    parentId,
    title: menuTitle(snippet.title, "Untitled clip"),
    contexts: ["editable"]
  });
}

async function handleMenuClick(info, tab) {
  if (!tab?.id) return;
  const menuId = String(info.menuItemId || "");
  if (menuId === OPEN_MENU_ID) return openManager();
  if (!menuId.startsWith("snippet:")) return;

  const store = await loadStore();
  const snippet = store.snippets.find((item) => item.id === menuId.slice("snippet:".length));
  if (!snippet) return markInsertionFailure(tab.id, "That clip no longer exists.");
  const frameId = Number.isInteger(info.frameId) ? info.frameId : 0;

  try {
    const execution = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      world: "MAIN",
      func: insertClipInPage,
      args: [snippet.body, snippet.title]
    });
    const result = execution[0]?.result;
    if (result?.ok || result?.copied) return clearInsertionFailure(tab.id);

    const copyExecution = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      world: "ISOLATED",
      func: copyClipInPage,
      args: [snippet.body]
    });
    if (copyExecution[0]?.result) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        world: "MAIN",
        func: showClipstarToast,
        args: ["This field is not supported. Clip copied instead.", false]
      });
      return clearInsertionFailure(tab.id);
    }
    await markInsertionFailure(tab.id, "Clipstar could not insert or copy this clip.");
  } catch (error) {
    await markInsertionFailure(
      tab.id,
      "Chrome does not allow extensions to edit this page. Try a regular website field."
    );
    throw error;
  }
}

async function openManager() {
  try {
    if (chrome.action.openPopup) {
      await chrome.action.openPopup();
      return;
    }
  } catch (_) {
    // Older Chrome versions fall back to a dedicated extension window.
  }
  await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?mode=window"),
    type: "popup",
    width: 500,
    height: 720,
    focused: true
  });
}

async function markInsertionFailure(tabId, message) {
  await Promise.allSettled([
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#9f1239" }),
    chrome.action.setBadgeText({ tabId, text: "!" }),
    chrome.action.setTitle({ tabId, title: `${APP_NAME}: ${message}` })
  ]);
}

async function clearInsertionFailure(tabId) {
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: APP_NAME })
  ]);
}

function removeAllMenus() {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function createMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function menuTitle(value, fallback) {
  const text = String(value || fallback).trim() || fallback;
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function sortByPositionThenName(a, b) {
  return sortByPosition(a, b) || String(a.name || "").localeCompare(String(b.name || ""));
}

function sortByPositionThenTitle(a, b) {
  return sortByPosition(a, b) || String(a.title || "").localeCompare(String(b.title || ""));
}

function sortByPosition(a, b) {
  return (Number(a.position) || 0) - (Number(b.position) || 0);
}

function errorResponse(error) {
  const response = {
    ok: false,
    error: String(error?.message || "Clipstar could not complete that request."),
    code: String(error?.code || "UNKNOWN")
  };
  if (Number.isInteger(error?.currentRevision)) response.currentRevision = error.currentRevision;
  return response;
}

function reportBackgroundError(error) {
  console.error(`${APP_NAME}:`, error);
}

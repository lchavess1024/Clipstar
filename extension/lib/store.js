import { APP_NAME, LIMITS, STORE_VERSION } from "./constants.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class StoreError extends Error {
  constructor(message, code = "INVALID_STORE") {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

export function createDefaultStore(now = new Date().toISOString()) {
  return {
    version: STORE_VERSION,
    revision: 0,
    folders: [],
    snippets: [{
      id: "welcome-clip",
      title: "Welcome to Clipstar",
      folderId: "",
      body: [
        "Welcome to Clipstar.",
        "",
        "Create clips and folders from the toolbar popup, then right-click inside a supported text field to insert a saved clip.",
        "",
        "Your clips stay in Chrome's local extension storage. Clipstar has no account, analytics, or external server."
      ].join("\n"),
      position: 0,
      createdAt: now,
      updatedAt: now
    }]
  };
}

export function isStoreShape(value) {
  return Boolean(isRecord(value) && Array.isArray(value.folders) && Array.isArray(value.snippets));
}

export function cleanStore(value, options = {}) {
  const idFactory = options.idFactory || createId;
  const now = options.now || new Date().toISOString();
  const source = isStoreShape(value) ? value : { folders: [], snippets: [] };
  const folderRows = source.folders.filter(isRecord).slice(0, LIMITS.folderCount);
  const usedFolderIds = new Set();
  const folderIdMap = new Map();

  const folders = folderRows.map((folder, index) => {
    const originalId = asString(folder.id);
    const id = uniqueId(originalId, usedFolderIds, idFactory);
    if (originalId && !folderIdMap.has(originalId)) folderIdMap.set(originalId, id);
    return {
      id,
      name: boundedLabel(folder.name, "Untitled folder", LIMITS.folderNameLength),
      parentId: asString(folder.parentId),
      position: finiteNumber(folder.position, index),
      createdAt: validTimestamp(folder.createdAt, now),
      updatedAt: validTimestamp(folder.updatedAt, now)
    };
  });

  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const requestedParents = new Map();
  for (const folder of folders) {
    const mappedParent = folderIdMap.get(folder.parentId) || folder.parentId;
    requestedParents.set(
      folder.id,
      mappedParent && folderById.has(mappedParent) && mappedParent !== folder.id ? mappedParent : ""
    );
  }
  for (const folder of folders) folder.parentId = rootParentFor(folder.id, requestedParents);

  const usedSnippetIds = new Set();
  const snippets = source.snippets
    .filter(isRecord)
    .filter((snippet) => typeof snippet.body === "string" && snippet.body.trim())
    .slice(0, LIMITS.snippetCount)
    .map((snippet, index) => {
      const requestedFolderId = asString(snippet.folderId);
      const mappedFolderId = folderIdMap.get(requestedFolderId) || requestedFolderId;
      return {
        id: uniqueId(asString(snippet.id), usedSnippetIds, idFactory),
        title: boundedLabel(snippet.title, "Untitled clip", LIMITS.titleLength),
        folderId: folderById.has(mappedFolderId) ? mappedFolderId : "",
        body: asString(snippet.body).slice(0, LIMITS.bodyLength),
        position: finiteNumber(snippet.position, index),
        createdAt: validTimestamp(snippet.createdAt, now),
        updatedAt: validTimestamp(snippet.updatedAt, now)
      };
    });

  return {
    version: STORE_VERSION,
    revision: Math.max(0, Math.trunc(finiteNumber(source.revision, 0))),
    folders,
    snippets
  };
}

export function migrateLegacySnippets(value, options = {}) {
  if (!Array.isArray(value)) throw new StoreError("The legacy backup does not contain a clip list.");
  assertLegacyImport(value);
  const idFactory = options.idFactory || createId;
  const now = options.now || new Date().toISOString();
  const folders = [];
  const folderByPath = new Map();

  function getFolder(name, parentId = "") {
    const cleanName = boundedLabel(name, "", LIMITS.folderNameLength);
    if (!cleanName) return "";
    const path = `${parentId}/${cleanName.toLocaleLowerCase()}`;
    if (folderByPath.has(path)) return folderByPath.get(path);
    if (folders.length >= LIMITS.folderCount) {
      throw new StoreError(
        `Legacy data contains more than ${LIMITS.folderCount} folders and cannot be migrated without losing organization.`,
        "MIGRATION_LIMIT"
      );
    }
    const id = idFactory();
    folders.push({ id, name: cleanName, parentId, position: folders.length, createdAt: now, updatedAt: now });
    folderByPath.set(path, id);
    return id;
  }

  const snippets = value
    .filter(isRecord)
    .filter((snippet) => typeof snippet.body === "string" && snippet.body.trim())
    .slice(0, LIMITS.snippetCount)
    .map((snippet, index) => {
      const parentId = getFolder(snippet.parentFolder ?? snippet.category ?? "");
      const childId = parentId && snippet.childFolder ? getFolder(snippet.childFolder, parentId) : "";
      return {
        id: asString(snippet.id) || idFactory(),
        title: boundedLabel(snippet.title, "Untitled clip", LIMITS.titleLength),
        folderId: childId || parentId,
        body: asString(snippet.body).slice(0, LIMITS.bodyLength),
        position: index,
        createdAt: validTimestamp(snippet.createdAt, now),
        updatedAt: validTimestamp(snippet.updatedAt, now)
      };
    });

  return cleanStore({ version: STORE_VERSION, revision: 0, folders, snippets }, { idFactory, now });
}

export function parseImportPayload(value, options = {}) {
  if (isStoreShape(value)) {
    assertModernImport(value);
    return cleanStore(value, options);
  }
  if (Array.isArray(value)) {
    assertLegacyImport(value);
    return migrateLegacySnippets(value, options);
  }
  if (isRecord(value) && Array.isArray(value.snippets)) {
    assertLegacyImport(value.snippets);
    return migrateLegacySnippets(value.snippets, options);
  }
  throw new StoreError("This file is not a Clipstar JSON backup.", "INVALID_IMPORT");
}

export function mergeStores(currentValue, incomingValue, options = {}) {
  const idFactory = options.idFactory || createId;
  const now = options.now || new Date().toISOString();
  const current = cleanStore(currentValue, { idFactory, now });
  const incoming = cleanStore(incomingValue, { idFactory, now });
  if (current.folders.length + incoming.folders.length > LIMITS.folderCount) {
    throw new StoreError(`This import would exceed Clipstar's ${LIMITS.folderCount}-folder limit.`);
  }
  if (current.snippets.length + incoming.snippets.length > LIMITS.snippetCount) {
    throw new StoreError(`This import would exceed Clipstar's ${LIMITS.snippetCount}-clip limit.`);
  }
  const usedFolderIds = new Set(current.folders.map((folder) => folder.id));
  const folderIdMap = new Map();
  for (const folder of incoming.folders) {
    folderIdMap.set(folder.id, uniqueId(folder.id, usedFolderIds, idFactory));
  }
  const importedFolders = incoming.folders.map((folder) => ({
    ...folder,
    id: folderIdMap.get(folder.id),
    parentId: folder.parentId ? folderIdMap.get(folder.parentId) || "" : ""
  }));
  const usedSnippetIds = new Set(current.snippets.map((snippet) => snippet.id));
  const importedSnippets = incoming.snippets.map((snippet) => ({
    ...snippet,
    id: uniqueId(snippet.id, usedSnippetIds, idFactory),
    folderId: snippet.folderId ? folderIdMap.get(snippet.folderId) || "" : ""
  }));

  return cleanStore({
    version: STORE_VERSION,
    revision: current.revision,
    folders: [...current.folders, ...importedFolders],
    snippets: [...current.snippets, ...importedSnippets]
  }, { idFactory, now });
}

export function applyMutation(value, mutation, options = {}) {
  if (!isRecord(mutation) || typeof mutation.kind !== "string") {
    throw new StoreError("The requested change is invalid.", "INVALID_MUTATION");
  }
  const idFactory = options.idFactory || createId;
  const now = options.now || new Date().toISOString();
  const store = cleanStore(value, { idFactory, now });
  let next;

  switch (mutation.kind) {
    case "upsertSnippet":
      next = upsertSnippet(store, mutation.payload, idFactory, now);
      break;
    case "deleteSnippet":
      next = deleteSnippet(store, mutation.payload);
      break;
    case "moveSnippet":
      next = moveSnippet(store, mutation.payload, now);
      break;
    case "upsertFolder":
      next = upsertFolder(store, mutation.payload, idFactory, now);
      break;
    case "deleteFolder":
      next = deleteFolder(store, mutation.payload, now);
      break;
    case "importStore":
      next = mergeStores(store, parseImportPayload(mutation.payload, { idFactory, now }), { idFactory, now });
      break;
    default:
      throw new StoreError("Clipstar does not recognize that change.", "UNKNOWN_MUTATION");
  }
  next.revision = store.revision + 1;
  assertStoreWithinLimit(next);
  return next;
}

export function assertStoreWithinLimit(store) {
  const bytes = serializedBytes(store);
  if (bytes > LIMITS.storeBytes) {
    throw new StoreError(
      `Clipstar storage is full (${(bytes / (1024 * 1024)).toFixed(1)} MB). Export a backup and remove unused clips.`,
      "STORE_TOO_LARGE"
    );
  }
  return bytes;
}

export function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function makeExportPayload(store, exportedAt = new Date().toISOString()) {
  const cleaned = cleanStore(store, { now: exportedAt });
  return {
    app: APP_NAME,
    formatVersion: STORE_VERSION,
    exportedAt,
    folders: cleaned.folders,
    snippets: cleaned.snippets
  };
}

function upsertSnippet(store, payload, idFactory, now) {
  if (!isRecord(payload)) throw new StoreError("Clip details are missing.");
  const rawTitle = asString(payload.title);
  const rawBody = asString(payload.body);
  const title = boundedLabel(rawTitle, "", LIMITS.titleLength);
  const body = rawBody.slice(0, LIMITS.bodyLength);
  const folderId = asString(payload.folderId);
  const requestedId = asString(payload.id);
  if (!title || !body.trim()) throw new StoreError("A clip needs both a label and body.");
  if (rawTitle.trim().length > LIMITS.titleLength) throw new StoreError(`Clip labels can be at most ${LIMITS.titleLength} characters.`);
  if (rawBody.length > LIMITS.bodyLength) throw new StoreError(`Clip bodies can be at most ${LIMITS.bodyLength.toLocaleString()} characters.`);
  if (folderId && !store.folders.some((folder) => folder.id === folderId)) {
    throw new StoreError("The selected folder no longer exists.");
  }
  const existing = requestedId ? store.snippets.find((snippet) => snippet.id === requestedId) : null;
  if (existing) {
    return {
      ...store,
      snippets: store.snippets.map((snippet) => snippet.id === existing.id
        ? { ...snippet, title, body, folderId, updatedAt: now }
        : snippet)
    };
  }
  if (store.snippets.length >= LIMITS.snippetCount) {
    throw new StoreError(`Clipstar supports up to ${LIMITS.snippetCount} clips.`);
  }
  const usedIds = new Set(store.snippets.map((snippet) => snippet.id));
  return {
    ...store,
    snippets: [...store.snippets, {
      id: uniqueId("", usedIds, idFactory),
      title,
      folderId,
      body,
      position: store.snippets.length,
      createdAt: now,
      updatedAt: now
    }]
  };
}

function deleteSnippet(store, payload) {
  const id = isRecord(payload) ? asString(payload.id) : "";
  if (!id || !store.snippets.some((snippet) => snippet.id === id)) {
    throw new StoreError("That clip no longer exists.");
  }
  return { ...store, snippets: store.snippets.filter((snippet) => snippet.id !== id) };
}

function moveSnippet(store, payload, now) {
  if (!isRecord(payload)) throw new StoreError("Move details are missing.");
  const id = asString(payload.id);
  const folderId = asString(payload.folderId);
  if (folderId && !store.folders.some((folder) => folder.id === folderId)) {
    throw new StoreError("The target folder no longer exists.");
  }
  if (!store.snippets.some((snippet) => snippet.id === id)) throw new StoreError("That clip no longer exists.");
  return {
    ...store,
    snippets: store.snippets.map((snippet) => snippet.id === id
      ? { ...snippet, folderId, updatedAt: now }
      : snippet)
  };
}

function upsertFolder(store, payload, idFactory, now) {
  if (!isRecord(payload)) throw new StoreError("Folder details are missing.");
  const rawName = asString(payload.name);
  const name = boundedLabel(rawName, "", LIMITS.folderNameLength);
  const parentId = asString(payload.parentId);
  const requestedId = asString(payload.id);
  const existing = requestedId ? store.folders.find((folder) => folder.id === requestedId) : null;
  if (!name) throw new StoreError("A folder needs a name.");
  if (rawName.trim().length > LIMITS.folderNameLength) throw new StoreError(`Folder names can be at most ${LIMITS.folderNameLength} characters.`);
  if (parentId) {
    const parent = store.folders.find((folder) => folder.id === parentId);
    if (!parent) throw new StoreError("The selected parent folder no longer exists.");
    if (parent.parentId) throw new StoreError("Only one subfolder level is supported.");
    if (parent.id === existing?.id) throw new StoreError("A folder cannot contain itself.");
  }
  if (existing) {
    if (parentId && store.folders.some((folder) => folder.parentId === existing.id)) {
      throw new StoreError("A folder with subfolders cannot become a subfolder.");
    }
    return {
      ...store,
      folders: store.folders.map((folder) => folder.id === existing.id
        ? { ...folder, name, parentId, updatedAt: now }
        : folder)
    };
  }
  if (store.folders.length >= LIMITS.folderCount) {
    throw new StoreError(`Clipstar supports up to ${LIMITS.folderCount} folders.`);
  }
  const usedIds = new Set(store.folders.map((folder) => folder.id));
  return {
    ...store,
    folders: [...store.folders, {
      id: uniqueId("", usedIds, idFactory),
      name,
      parentId,
      position: store.folders.length,
      createdAt: now,
      updatedAt: now
    }]
  };
}

function deleteFolder(store, payload, now) {
  const id = isRecord(payload) ? asString(payload.id) : "";
  if (!store.folders.some((folder) => folder.id === id)) throw new StoreError("That folder no longer exists.");
  const childIds = store.folders.filter((folder) => folder.parentId === id).map((folder) => folder.id);
  const removedIds = new Set([id, ...childIds]);
  return {
    ...store,
    folders: store.folders.filter((folder) => !removedIds.has(folder.id)),
    snippets: store.snippets.map((snippet) => removedIds.has(snippet.folderId)
      ? { ...snippet, folderId: "", updatedAt: now }
      : snippet)
  };
}

function rootParentFor(folderId, requestedParents) {
  let candidate = requestedParents.get(folderId) || "";
  const visited = new Set([folderId]);
  while (candidate) {
    if (visited.has(candidate)) return "";
    visited.add(candidate);
    const next = requestedParents.get(candidate) || "";
    if (!next) return candidate;
    candidate = next;
  }
  return "";
}

function assertModernImport(value) {
  if (value.folders.length > LIMITS.folderCount) {
    throw new StoreError(`A backup can contain at most ${LIMITS.folderCount} folders.`, "INVALID_IMPORT");
  }
  if (value.snippets.length > LIMITS.snippetCount) {
    throw new StoreError(`A backup can contain at most ${LIMITS.snippetCount} clips.`, "INVALID_IMPORT");
  }
  for (const folder of value.folders) {
    if (!isRecord(folder) || typeof folder.name !== "string") {
      throw new StoreError("The backup contains an invalid folder.", "INVALID_IMPORT");
    }
    if (folder.name.trim().length > LIMITS.folderNameLength) {
      throw new StoreError(`Folder names can be at most ${LIMITS.folderNameLength} characters.`, "INVALID_IMPORT");
    }
  }
  assertLegacyImport(value.snippets);
}

function assertLegacyImport(snippets) {
  if (snippets.length > LIMITS.snippetCount) {
    throw new StoreError(`A backup can contain at most ${LIMITS.snippetCount} clips.`, "INVALID_IMPORT");
  }
  for (const snippet of snippets) {
    if (!isRecord(snippet) || typeof snippet.title !== "string" || typeof snippet.body !== "string") {
      throw new StoreError("The backup contains an invalid clip.", "INVALID_IMPORT");
    }
    if (!snippet.title.trim() || !snippet.body.trim()) {
      throw new StoreError("Imported clips need both a label and body.", "INVALID_IMPORT");
    }
    if (snippet.title.trim().length > LIMITS.titleLength) {
      throw new StoreError(`Clip labels can be at most ${LIMITS.titleLength} characters.`, "INVALID_IMPORT");
    }
    if (snippet.body.length > LIMITS.bodyLength) {
      throw new StoreError(`Clip bodies can be at most ${LIMITS.bodyLength.toLocaleString()} characters.`, "INVALID_IMPORT");
    }
    for (const key of ["parentFolder", "category", "childFolder"]) {
      if (snippet[key] == null || snippet[key] === "") continue;
      if (typeof snippet[key] !== "string") {
        throw new StoreError("The backup contains an invalid folder name.", "INVALID_IMPORT");
      }
      if (snippet[key].trim().length > LIMITS.folderNameLength) {
        throw new StoreError(`Folder names can be at most ${LIMITS.folderNameLength} characters.`, "INVALID_IMPORT");
      }
    }
  }
}

function uniqueId(requested, used, idFactory) {
  let candidate = SAFE_ID.test(requested) ? requested : "";
  if (!candidate || used.has(candidate)) candidate = idFactory();
  while (!SAFE_ID.test(candidate) || used.has(candidate)) candidate = idFactory();
  used.add(candidate);
  return candidate;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function boundedLabel(value, fallback, maxLength) {
  const label = asString(value).trim();
  return (label || fallback).slice(0, maxLength);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validTimestamp(value, fallback) {
  if (typeof value !== "string" || value.length > 64) return fallback;
  return Number.isNaN(Date.parse(value)) ? fallback : value;
}

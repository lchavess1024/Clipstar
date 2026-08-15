import {
  ALL_LEGACY_KEYS,
  LEGACY_SNIPPET_KEYS,
  LEGACY_STORE_KEYS,
  STORAGE_KEY
} from "./constants.js";
import {
  StoreError,
  assertStoreWithinLimit,
  cleanStore,
  createDefaultStore,
  isStoreShape,
  parseImportPayload
} from "./store.js";

export async function loadStore(storageArea = chrome.storage.local) {
  const result = await storageArea.get([STORAGE_KEY, ...ALL_LEGACY_KEYS]);
  let store;
  let migratedLegacyKey = "";
  const hasPrimaryStore = Object.prototype.hasOwnProperty.call(result, STORAGE_KEY);

  if (hasPrimaryStore && !isStoreShape(result[STORAGE_KEY])) {
    throw new StoreError(
      "Clipstar found unreadable saved data and left it unchanged. Restore a valid JSON backup before making further changes.",
      "CORRUPT_STORE"
    );
  }

  if (hasPrimaryStore) {
    store = parseImportPayload(result[STORAGE_KEY]);
  } else {
    const legacyStoreKey = LEGACY_STORE_KEYS.find((key) => isStoreShape(result[key]));
    const legacySnippetKey = LEGACY_SNIPPET_KEYS.find(
      (key) => Array.isArray(result[key])
    );
    const legacyKey = legacyStoreKey || legacySnippetKey;
    if (legacyKey) {
      try {
        store = parseImportPayload(result[legacyKey]);
        migratedLegacyKey = legacyKey;
      } catch (error) {
        throw new StoreError(
          `Clipstar kept your legacy data unchanged because it could not migrate it safely. ${error?.message || "Review the stored collection before retrying."}`,
          "MIGRATION_BLOCKED"
        );
      }
    } else {
      store = createDefaultStore();
    }
  }

  assertStoreWithinLimit(store);
  if (JSON.stringify(result[STORAGE_KEY]) !== JSON.stringify(store)) {
    await storageArea.set({ [STORAGE_KEY]: store });
  }
  if (migratedLegacyKey) {
    await storageArea.remove(migratedLegacyKey);
  }
  return store;
}

export async function saveStore(store, storageArea = chrome.storage.local) {
  const cleaned = cleanStore(store);
  assertStoreWithinLimit(cleaned);
  await storageArea.set({ [STORAGE_KEY]: cleaned });
  return cleaned;
}

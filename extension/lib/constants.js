export const APP_NAME = "Clipstar";
export const STORE_VERSION = 1;
export const STORAGE_KEY = "clipstar_store_v1";

export const LEGACY_STORE_KEYS = ["luis_clippings_store_v1"];

export const LEGACY_SNIPPET_KEYS = [
  "luis_clippings_snippets_v9",
  "luis_clippings_snippets_v8",
  "luis_clippings_snippets_v7",
  "luis_clippings_snippets_v6",
  "luis_clippings_snippets_v5",
  "luis_clippings_snippets_v4",
  "luis_clippings_snippets_v3",
  "luis_clippings_snippets_v2",
  "luis_clippings_snippets_v1",
  "rtm_snippets_v1"
];

export const ALL_LEGACY_KEYS = [...LEGACY_STORE_KEYS, ...LEGACY_SNIPPET_KEYS];

export const LIMITS = Object.freeze({
  bodyLength: 100_000,
  folderCount: 200,
  folderNameLength: 80,
  importBytes: 10 * 1024 * 1024,
  snippetCount: 500,
  storeBytes: 8 * 1024 * 1024,
  titleLength: 120
});

import { LIMITS, STORAGE_KEY } from "./lib/constants.js";
import { cleanStore, makeExportPayload } from "./lib/store.js";

let store = { version: 1, revision: 0, folders: [], snippets: [] };
let editingEntryId = null;
let editingFolderId = null;
let editingEntryRevision = 0;
let editingFolderRevision = 0;
let selectedFolderId = "";
let activeDialog = null;
let returnFocus = null;
let busy = false;
let draggedEntryId = "";

const byId = (id) => document.getElementById(id);
const els = {
  appShell: byId("appShell"),
  settingsBtn: byId("settingsBtn"),
  newEntryBtn: byId("newEntryBtn"),
  newFolderBtn: byId("newFolderBtn"),
  searchInput: byId("searchInput"),
  stats: byId("stats"),
  treeView: byId("treeView"),
  editor: byId("editor"),
  editorTitle: byId("editorTitle"),
  closeEditorBtn: byId("closeEditorBtn"),
  titleInput: byId("titleInput"),
  folderSelect: byId("folderSelect"),
  bodyInput: byId("bodyInput"),
  saveEntryBtn: byId("saveEntryBtn"),
  deleteEntryBtn: byId("deleteEntryBtn"),
  folderEditor: byId("folderEditor"),
  folderEditorTitle: byId("folderEditorTitle"),
  closeFolderEditorBtn: byId("closeFolderEditorBtn"),
  folderNameInput: byId("folderNameInput"),
  folderParentSelect: byId("folderParentSelect"),
  saveFolderBtn: byId("saveFolderBtn"),
  deleteFolderBtn: byId("deleteFolderBtn"),
  settingsPanel: byId("settingsPanel"),
  closeSettingsBtn: byId("closeSettingsBtn"),
  exportBtn: byId("exportBtn"),
  importInput: byId("importInput"),
  toast: byId("toast")
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  document.body.classList.toggle(
    "window-mode",
    new URLSearchParams(location.search).get("mode") === "window"
  );
  bindEvents();
  chrome.storage.onChanged.addListener(handleStorageChange);

  try {
    const response = await chrome.runtime.sendMessage({ type: "STORE_GET" });
    if (!response?.ok) throw new Error(response?.error || "Could not load your clips.");
    store = cleanStore(response.store);
    render();
  } catch (error) {
    render();
    showToast(error?.message || "Could not load Clipstar.", true);
  }
}

function bindEvents() {
  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", () => closeDialog(els.settingsPanel));
  els.newEntryBtn.addEventListener("click", () => openEntryEditor(null, selectedFolderId));
  els.newFolderBtn.addEventListener("click", () => openFolderEditor(null, selectedFolderId));
  els.closeEditorBtn.addEventListener("click", () => closeDialog(els.editor));
  els.saveEntryBtn.addEventListener("click", saveEntry);
  els.deleteEntryBtn.addEventListener("click", deleteCurrentEntry);
  els.closeFolderEditorBtn.addEventListener("click", () => closeDialog(els.folderEditor));
  els.saveFolderBtn.addEventListener("click", saveFolder);
  els.deleteFolderBtn.addEventListener("click", deleteCurrentFolder);
  els.searchInput.addEventListener("input", renderTree);
  els.exportBtn.addEventListener("click", exportStore);
  els.importInput.addEventListener("change", importStore);
  document.addEventListener("keydown", handleDocumentKeydown);

  for (const input of [els.titleInput, els.bodyInput, els.folderNameInput]) {
    input.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (activeDialog === els.editor) saveEntry();
        if (activeDialog === els.folderEditor) saveFolder();
      }
    });
  }
}

function handleStorageChange(changes, areaName) {
  const next = changes[STORAGE_KEY]?.newValue;
  if (areaName !== "local" || !next) return;
  store = cleanStore(next);
  if (selectedFolderId && !store.folders.some((folder) => folder.id === selectedFolderId)) {
    selectedFolderId = "";
  }
  render();
}

function render() {
  els.stats.textContent = `${store.snippets.length} ${pluralize("clip", store.snippets.length)} · ${store.folders.length} ${pluralize("folder", store.folders.length)}`;
  renderSelectors();
  renderTree();
}

function renderSelectors() {
  const requestedFolder = els.folderSelect.value;
  const requestedParent = els.folderParentSelect.value;
  renderFolderSelect();
  renderFolderParentSelect();

  if (hasOption(els.folderSelect, requestedFolder)) els.folderSelect.value = requestedFolder;
  if (hasOption(els.folderParentSelect, requestedParent)) {
    els.folderParentSelect.value = requestedParent;
  }
}

function renderFolderSelect() {
  const options = [makeOption("", "Standalone / no folder")];

  for (const folder of getRootFolders()) {
    options.push(makeOption(folder.id, folder.name));
    for (const child of getChildFolders(folder.id)) {
      options.push(makeOption(child.id, `${folder.name} / ${child.name}`));
    }
  }

  els.folderSelect.replaceChildren(...options);
}

function renderFolderParentSelect() {
  const options = [makeOption("", "Root folder")];
  for (const folder of getRootFolders()) {
    if (folder.id !== editingFolderId) {
      options.push(makeOption(folder.id, `Subfolder of: ${folder.name}`));
    }
  }
  els.folderParentSelect.replaceChildren(...options);
}

function renderTree() {
  const query = els.searchInput.value.trim().toLocaleLowerCase();
  const standalone = store.snippets
    .filter((snippet) => !snippet.folderId)
    .filter((snippet) => matchesQuery(snippet, query))
    .sort(sortEntries);
  const nodes = [];

  if (standalone.length || !query) {
    const section = makeSection("Standalone", "");
    if (standalone.length) {
      for (const snippet of standalone) section.appendChild(renderEntry(snippet));
    } else {
      section.appendChild(makeEmpty("No standalone clips", "Drag a clip here to remove it from a folder."));
    }
    nodes.push(section);
  }

  for (const folder of getRootFolders()) {
    const folderNode = renderFolder(folder, query);
    if (folderNode) nodes.push(folderNode);
  }

  if (!nodes.length) {
    nodes.push(
      makeEmpty(
        query ? "No matches" : "No clips yet",
        query ? "Try a different search." : "Create your first clip or folder above."
      )
    );
  }

  els.treeView.replaceChildren(...nodes);
  addDropHandlersToZones();
}

function makeSection(title, folderId) {
  const section = document.createElement("section");
  section.className = "tree-section drop-zone";
  section.dataset.folderId = folderId;
  const header = document.createElement("div");
  header.className = "tree-section-title";
  header.textContent = title;
  section.appendChild(header);
  return section;
}

function renderFolder(folder, query) {
  const folderMatches = folder.name.toLocaleLowerCase().includes(query);
  const directEntries = store.snippets
    .filter((snippet) => snippet.folderId === folder.id)
    .filter((snippet) => folderMatches || matchesQuery(snippet, query))
    .sort(sortEntries);
  const childFolders = getChildFolders(folder.id);
  const childNodes = childFolders
    .map((child) => renderSubfolder(child, query, folderMatches))
    .filter(Boolean);

  if (query && !folderMatches && !directEntries.length && !childNodes.length) return null;

  const section = document.createElement("section");
  section.className = "folder-card drop-zone";
  if (selectedFolderId === folder.id) section.classList.add("is-selected");
  section.dataset.folderId = folder.id;

  const header = document.createElement("div");
  header.className = "folder-header";
  const title = folderTitleButton(folder);
  const actions = document.createElement("div");
  actions.className = "folder-actions";
  actions.append(
    smallButton("+ Clip", `Create a clip in ${folder.name}`, () => openEntryEditor(null, folder.id)),
    smallButton("+ Folder", `Create a subfolder in ${folder.name}`, () => openFolderEditor(null, folder.id)),
    smallButton("✎", `Edit folder ${folder.name}`, () => openFolderEditor(folder), true)
  );
  header.append(title, actions);
  section.appendChild(header);

  const entries = document.createElement("div");
  entries.className = "folder-entries";
  for (const snippet of directEntries) entries.appendChild(renderEntry(snippet));
  for (const childNode of childNodes) entries.appendChild(childNode);
  section.appendChild(entries);
  return section;
}

function renderSubfolder(folder, query, parentMatches) {
  const folderMatches = parentMatches || folder.name.toLocaleLowerCase().includes(query);
  const entries = store.snippets
    .filter((snippet) => snippet.folderId === folder.id)
    .filter((snippet) => folderMatches || matchesQuery(snippet, query))
    .sort(sortEntries);
  if (query && !folderMatches && !entries.length) return null;

  const section = document.createElement("section");
  section.className = "subfolder-card drop-zone";
  if (selectedFolderId === folder.id) section.classList.add("is-selected");
  section.dataset.folderId = folder.id;

  const header = document.createElement("div");
  header.className = "folder-header";
  const title = folderTitleButton(folder);
  const actions = document.createElement("div");
  actions.className = "folder-actions";
  actions.append(
    smallButton("+ Clip", `Create a clip in ${folder.name}`, () => openEntryEditor(null, folder.id)),
    smallButton("✎", `Edit folder ${folder.name}`, () => openFolderEditor(folder), true)
  );
  header.append(title, actions);
  section.appendChild(header);
  for (const snippet of entries) section.appendChild(renderEntry(snippet));
  return section;
}

function folderTitleButton(folder) {
  const button = document.createElement("button");
  button.className = "folder-title";
  button.type = "button";
  button.textContent = folder.name;
  button.setAttribute("aria-pressed", String(selectedFolderId === folder.id));
  button.addEventListener("click", () => {
    selectedFolderId = folder.id;
    renderTree();
    showToast(`New clips will be added to ${getFolderPath(folder.id)}.`);
  });
  return button;
}

function renderEntry(snippet) {
  const item = document.createElement("article");
  item.className = "entry-card";
  item.dataset.entryId = snippet.id;
  item.dataset.folderId = snippet.folderId;

  const dragHandle = document.createElement("button");
  dragHandle.className = "drag-handle";
  dragHandle.type = "button";
  dragHandle.draggable = true;
  dragHandle.textContent = "⋮⋮";
  dragHandle.setAttribute("aria-label", `Reorder ${snippet.title}`);
  dragHandle.setAttribute("aria-describedby", "reorderInstructions");
  dragHandle.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
  dragHandle.title = `Drag to move ${snippet.title}, or use the arrow keys to reorder it`;
  dragHandle.addEventListener("dragstart", (event) => startEntryDrag(event, item, snippet.id));
  dragHandle.addEventListener("dragend", clearDragState);
  dragHandle.addEventListener("keydown", (event) => handleEntryOrderKeydown(event, snippet));

  item.addEventListener("dragover", (event) => {
    if (!isEntryDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const id = getDraggedEntryId(event);
    clearDropIndicators();
    if (!id || id === snippet.id) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    item.classList.add(dropPlacement(event, item) === "before" ? "drop-before" : "drop-after");
  });
  item.addEventListener("dragleave", (event) => {
    if (!item.contains(event.relatedTarget)) item.classList.remove("drop-before", "drop-after");
  });
  item.addEventListener("drop", async (event) => {
    if (!isEntryDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const id = getDraggedEntryId(event);
    const placement = dropPlacement(event, item);
    clearDragState();
    if (!id || id === snippet.id) return;
    await commitMutation("moveSnippet", {
      id,
      folderId: snippet.folderId,
      targetId: snippet.id,
      placement
    });
  });

  const main = document.createElement("div");
  main.className = "entry-main";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = snippet.title;
  const path = document.createElement("div");
  path.className = "card-category";
  path.textContent = getFolderPath(snippet.folderId) || "Standalone";
  main.append(title, path);

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  actions.append(
    smallButton("Copy", `Copy ${snippet.title}`, () => copyToClipboard(snippet.body), false, "primary"),
    smallButton("✎", `Edit clip ${snippet.title}`, () => openEntryEditor(snippet), true)
  );
  item.append(dragHandle, main, actions);
  return item;
}

function addDropHandlersToZones() {
  for (const zone of els.treeView.querySelectorAll(".drop-zone")) {
    zone.addEventListener("dragover", (event) => {
      if (!isEntryDrag(event) || event.target.closest(".entry-card")) return;
      if (event.target.closest(".drop-zone") !== zone) return;
      event.preventDefault();
      event.stopPropagation();
      clearDropIndicators();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", async (event) => {
      if (!isEntryDrag(event) || event.target.closest(".entry-card")) return;
      if (event.target.closest(".drop-zone") !== zone) return;
      const id = getDraggedEntryId(event);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      const folderId = zone.dataset.folderId || "";
      clearDragState();
      const updated = await commitMutation("moveSnippet", { id, folderId });
      if (updated) {
        showToast(folderId ? `Moved to the end of ${getFolderPath(folderId)}.` : "Moved to the end of Standalone.");
      }
    });
  }
}

function startEntryDrag(event, item, id) {
  if (!event.dataTransfer) return;
  draggedEntryId = id;
  event.dataTransfer.setData("application/x-clipstar-id", id);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setDragImage(item, 18, 18);
  item.classList.add("is-dragging");
  document.body.classList.add("is-reordering");
}

function isEntryDrag(event) {
  return Boolean(
    draggedEntryId
    || Array.from(event.dataTransfer?.types || []).includes("application/x-clipstar-id")
  );
}

function getDraggedEntryId(event) {
  return event.dataTransfer?.getData("application/x-clipstar-id") || draggedEntryId;
}

function dropPlacement(event, item) {
  const bounds = item.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function clearDropIndicators() {
  for (const element of els.treeView.querySelectorAll(".drop-before, .drop-after, .drag-over")) {
    element.classList.remove("drop-before", "drop-after", "drag-over");
  }
}

function clearDragState() {
  clearDropIndicators();
  for (const element of els.treeView.querySelectorAll(".is-dragging")) {
    element.classList.remove("is-dragging");
  }
  document.body.classList.remove("is-reordering");
  draggedEntryId = "";
}

async function handleEntryOrderKeydown(event, snippet) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  event.stopPropagation();
  const siblings = store.snippets
    .filter((item) => item.folderId === snippet.folderId)
    .sort(sortEntries);
  const currentIndex = siblings.findIndex((item) => item.id === snippet.id);
  const direction = event.key === "ArrowUp" ? -1 : 1;
  const target = siblings[currentIndex + direction];
  if (!target) {
    showToast(direction < 0 ? "This clip is already first." : "This clip is already last.");
    return;
  }

  const updated = await commitMutation("moveSnippet", {
    id: snippet.id,
    folderId: snippet.folderId,
    targetId: target.id,
    placement: direction < 0 ? "before" : "after"
  });
  if (!updated) return;
  focusEntryHandle(snippet.id);
  showToast(`Moved ${direction < 0 ? "up" : "down"}.`);
}

function focusEntryHandle(id) {
  const item = Array.from(els.treeView.querySelectorAll(".entry-card"))
    .find((entry) => entry.dataset.entryId === id);
  item?.querySelector(".drag-handle")?.focus();
}

function openEntryEditor(snippet = null, folderId = selectedFolderId) {
  editingEntryId = snippet?.id || null;
  editingEntryRevision = store.revision;
  els.editorTitle.textContent = editingEntryId ? "Edit clip" : "New clip";
  els.titleInput.value = snippet?.title || "";
  els.bodyInput.value = snippet?.body || "";
  renderFolderSelect();
  const requestedFolder = snippet?.folderId ?? folderId ?? "";
  els.folderSelect.value = hasOption(els.folderSelect, requestedFolder) ? requestedFolder : "";
  els.deleteEntryBtn.classList.toggle("hidden", !editingEntryId);
  openDialog(els.editor, els.titleInput);
}

async function saveEntry() {
  const payload = {
    id: editingEntryId || "",
    title: els.titleInput.value,
    folderId: els.folderSelect.value,
    body: els.bodyInput.value
  };
  const updated = await commitMutation("upsertSnippet", payload, editingEntryRevision);
  if (!updated) return;
  closeDialog(els.editor);
  showToast(editingEntryId ? "Clip updated." : "Clip saved.");
  editingEntryId = null;
}

async function deleteCurrentEntry() {
  if (!editingEntryId || !confirm("Delete this clip? This cannot be undone.")) return;
  const updated = await commitMutation("deleteSnippet", { id: editingEntryId }, editingEntryRevision);
  if (!updated) return;
  closeDialog(els.editor);
  editingEntryId = null;
  showToast("Clip deleted.");
}

function openFolderEditor(folder = null, parentFolderId = selectedFolderId) {
  editingFolderId = folder?.id || null;
  editingFolderRevision = store.revision;
  els.folderEditorTitle.textContent = editingFolderId ? "Edit folder" : "New folder";
  els.folderNameInput.value = folder?.name || "";
  renderFolderParentSelect();
  const requestedParent = folder ? folder.parentId : parentFolderId;
  const parentId = allowedFolderParent(requestedParent, folder?.id || "");
  els.folderParentSelect.value = hasOption(els.folderParentSelect, parentId) ? parentId : "";
  els.deleteFolderBtn.classList.toggle("hidden", !editingFolderId);
  openDialog(els.folderEditor, els.folderNameInput);
}

async function saveFolder() {
  const payload = {
    id: editingFolderId || "",
    name: els.folderNameInput.value,
    parentId: els.folderParentSelect.value
  };
  const updated = await commitMutation("upsertFolder", payload, editingFolderRevision);
  if (!updated) return;
  closeDialog(els.folderEditor);
  showToast(editingFolderId ? "Folder updated." : "Folder saved.");
  editingFolderId = null;
}

async function deleteCurrentFolder() {
  if (!editingFolderId) return;
  const folder = store.folders.find((item) => item.id === editingFolderId);
  if (!folder) return;
  if (!confirm(`Delete “${folder.name}” and its subfolders? Their clips will move to Standalone.`)) return;
  const updated = await commitMutation("deleteFolder", { id: editingFolderId }, editingFolderRevision);
  if (!updated) return;
  closeDialog(els.folderEditor);
  selectedFolderId = "";
  editingFolderId = null;
  showToast("Folder deleted. Its clips are now standalone.");
}

function openSettings() {
  openDialog(els.settingsPanel, els.exportBtn);
}

function exportStore() {
  const payload = makeExportPayload(store);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `clipstar-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("Backup exported.");
}

async function importStore(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    if (file.size > LIMITS.importBytes) {
      throw new Error(
        `That backup is larger than Clipstar’s ${LIMITS.importBytes / (1024 * 1024)} MB import limit.`
      );
    }
    const parsed = JSON.parse(await file.text());
    if (!confirm("Import this backup? Its clips and folders will be added to your current collection.")) {
      return;
    }
    const updated = await commitMutation("importStore", parsed);
    if (updated) showToast("Backup imported.");
  } catch (error) {
    showToast(error?.message || "Import failed. Choose a valid Clipstar JSON backup.", true);
  } finally {
    event.target.value = "";
  }
}

async function commitMutation(kind, payload, expectedRevision = store.revision) {
  if (busy) return false;
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "STORE_MUTATE",
      mutation: { kind, payload },
      expectedRevision
    });
    if (!response?.ok && response?.code === "CONFLICT") {
      await refreshStoreAfterConflict();
      showToast(
        response?.error || "Your collection changed elsewhere. Review this form, then save again.",
        true
      );
      return false;
    }
    if (!response?.ok) throw new Error(response?.error || "Clipstar could not save that change.");
    store = cleanStore(response.store);
    render();
    return true;
  } catch (error) {
    showToast(error?.message || "Clipstar could not save that change.", true);
    return false;
  } finally {
    setBusy(false);
  }
}

async function refreshStoreAfterConflict() {
  const response = await chrome.runtime.sendMessage({ type: "STORE_GET" });
  if (!response?.ok) throw new Error(response?.error || "Could not refresh your clips.");
  store = cleanStore(response.store);
  if (activeDialog === els.editor) editingEntryRevision = store.revision;
  if (activeDialog === els.folderEditor) editingFolderRevision = store.revision;
  render();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Clip copied.");
  } catch (_) {
    showToast("Chrome blocked clipboard access.", true);
  }
}

function openDialog(dialog, initialFocus) {
  if (activeDialog && activeDialog !== dialog) closeDialog(activeDialog, false);
  returnFocus = document.activeElement;
  activeDialog = dialog;
  els.appShell.inert = true;
  els.appShell.setAttribute("aria-hidden", "true");
  dialog.classList.remove("hidden");
  dialog.setAttribute("aria-hidden", "false");
  setTimeout(() => (initialFocus || dialog).focus(), 0);
}

function closeDialog(dialog, restoreFocus = true) {
  if (!dialog) return;
  dialog.classList.add("hidden");
  dialog.setAttribute("aria-hidden", "true");
  if (activeDialog === dialog) activeDialog = null;
  els.appShell.inert = false;
  els.appShell.removeAttribute("aria-hidden");
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

function handleDocumentKeydown(event) {
  if (!activeDialog) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (busy) return;
    closeDialog(activeDialog);
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = Array.from(
    activeDialog.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")
  ).filter((element) => !element.classList.contains("hidden") && element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setBusy(value) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  for (const control of document.querySelectorAll("button, input, select, textarea")) {
    if (value) {
      control.dataset.clipstarWasDisabled = String(control.disabled);
      control.disabled = true;
    } else {
      control.disabled = control.dataset.clipstarWasDisabled === "true";
      delete control.dataset.clipstarWasDisabled;
    }
  }
}

function smallButton(label, accessibleLabel, handler, iconOnly = false, style = "secondary") {
  const button = document.createElement("button");
  button.className = `${style} tiny${iconOnly ? " tiny-icon" : ""}`;
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", accessibleLabel);
  button.title = accessibleLabel;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function makeEmpty(title, detail) {
  const element = document.createElement("div");
  element.className = "empty";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const description = document.createElement("span");
  description.textContent = detail;
  element.append(heading, description);
  return element;
}

function makeOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function hasOption(select, value) {
  return Array.from(select.options).some((option) => option.value === value);
}

function allowedFolderParent(parentId, editingId = "") {
  if (!parentId) return "";
  const parent = store.folders.find((folder) => folder.id === parentId);
  if (!parent || parent.id === editingId) return "";
  return parent.parentId || parent.id;
}

function getRootFolders() {
  return store.folders.filter((folder) => !folder.parentId).sort(sortFolders);
}

function getChildFolders(parentId) {
  return store.folders.filter((folder) => folder.parentId === parentId).sort(sortFolders);
}

function getFolderPath(folderId) {
  if (!folderId) return "";
  const folder = store.folders.find((item) => item.id === folderId);
  if (!folder) return "";
  const parent = folder.parentId
    ? store.folders.find((item) => item.id === folder.parentId)
    : null;
  return parent ? `${parent.name} / ${folder.name}` : folder.name;
}

function matchesQuery(snippet, query) {
  if (!query) return true;
  return `${snippet.title}\n${getFolderPath(snippet.folderId)}\n${snippet.body}`
    .toLocaleLowerCase()
    .includes(query);
}

function sortFolders(a, b) {
  return sortByPosition(a, b) || String(a.name || "").localeCompare(String(b.name || ""));
}

function sortEntries(a, b) {
  return sortByPosition(a, b)
    || String(a.title || "").localeCompare(String(b.title || ""))
    || String(a.id || "").localeCompare(String(b.id || ""));
}

function sortByPosition(a, b) {
  return (Number(a.position) || 0) - (Number(b.position) || 0);
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.setAttribute("role", isError ? "alert" : "status");
  els.toast.setAttribute("aria-live", isError ? "assertive" : "polite");
  els.toast.classList.remove("hidden");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

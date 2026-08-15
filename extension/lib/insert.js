export async function insertClipInPage(text, title) {
  const clipText = String(text ?? "");
  const clipTitle = String(title || "clip").slice(0, 120);
  if (!clipText) return { ok: false, copied: false, reason: "empty" };

  const target = resolveTarget();
  let inserted = false;
  if (target && isEditable(target)) {
    if (isServiceNowJournal(target)) inserted = insertServiceNowJournal(target, clipText);
    if (!inserted) {
      inserted = isPlainField(target)
        ? insertIntoPlainField(target, clipText)
        : insertIntoRichField(target, clipText);
    }
  }

  if (inserted) {
    showToast(`Inserted: ${clipTitle}`, false);
    return { ok: true, copied: false };
  }

  const copied = await copyText(clipText);
  if (copied) showToast("This field is not supported. Clip copied instead.", false);
  return { ok: false, copied, reason: target ? "unsupported" : "no-editable-target" };

  function resolveTarget() {
    let candidate = document.activeElement;
    while (candidate?.shadowRoot?.activeElement) candidate = candidate.shadowRoot.activeElement;
    if (isEditable(candidate)) return candidate;

    const selection = window.getSelection?.();
    let node = selection?.anchorNode || null;
    if (node?.nodeType === 3) node = node.parentElement;
    if (node?.closest) {
      const selectedEditor = node.closest(
        "textarea, input, [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox']"
      );
      if (isEditable(selectedEditor)) return selectedEditor;
    }
    return null;
  }

  function isEditable(element) {
    if (!element || element.disabled || element.readOnly) return false;
    const tag = element.tagName?.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") return isSupportedInput(element.getAttribute?.("type"));
    return Boolean(
      element.isContentEditable ||
      element.getAttribute?.("contenteditable") === "plaintext-only" ||
      element.getAttribute?.("role") === "textbox"
    );
  }

  function isSupportedInput(type) {
    return ["", "text", "search", "url", "tel", "email", "password"].includes(
      String(type || "").toLowerCase()
    );
  }

  function isPlainField(element) {
    const tag = element.tagName?.toLowerCase();
    return tag === "textarea" || tag === "input";
  }

  function insertIntoPlainField(field, insertion) {
    field.focus?.();
    const before = String(field.value ?? "");
    const start = Number.isFinite(field.selectionStart) ? field.selectionStart : before.length;
    const end = Number.isFinite(field.selectionEnd) ? field.selectionEnd : before.length;
    const merged = mergeAtSelection(before, start, end, insertion);

    try {
      const commandWorked = document.execCommand?.("insertText", false, insertion);
      if (commandWorked && String(field.value ?? "") === merged.value) return true;
    } catch (_) {
      // Use the native value setter below.
    }

    if (!dispatchBeforeInput(field, insertion)) return String(field.value ?? "") === merged.value;
    setNativeValue(field, merged.value);
    setCursor(field, merged.cursor);
    dispatchAfterInput(field, insertion);
    return String(field.value ?? "") === merged.value;
  }

  function insertIntoRichField(field, insertion) {
    field.focus?.();
    try {
      const commandWorked = document.execCommand?.("insertText", false, insertion);
      if (commandWorked) return true;
    } catch (_) {
      // Use a DOM Range fallback below.
    }

    const selection = window.getSelection?.();
    if (!selection) return false;
    let range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (
      !range ||
      !field.contains?.(range.startContainer) ||
      !field.contains?.(range.endContainer)
    ) {
      const endRange = document.createRange();
      endRange.selectNodeContents(field);
      endRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(endRange);
      range = endRange;
    }
    if (!dispatchBeforeInput(field, insertion)) return false;

    range.deleteContents();
    const fragment = document.createDocumentFragment();
    const lines = insertion.split("\n");
    lines.forEach((line, index) => {
      if (index) fragment.appendChild(document.createElement("br"));
      fragment.appendChild(document.createTextNode(line));
    });
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode) {
      const cursorRange = document.createRange();
      cursorRange.setStartAfter(lastNode);
      cursorRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(cursorRange);
    }
    dispatchAfterInput(field, insertion);
    return true;
  }

  function isServiceNowJournal(field) {
    let hasGForm = false;
    try {
      hasGForm = Boolean(window.g_form?.setValue);
    } catch (_) {
      hasGForm = false;
    }
    if (!hasGForm) return false;
    const clues = fieldClues(field);
    return ["work_notes", "work notes", "comments", "additional comments", "close_notes", "close notes"]
      .some((clue) => clues.includes(clue));
  }

  function insertServiceNowJournal(field, insertion) {
    const fieldName = inferServiceNowField(field);
    if (!fieldName) return false;
    try {
      const current = String(field.value ?? window.g_form.getValue(fieldName) ?? "");
      const start = Number.isFinite(field.selectionStart) ? field.selectionStart : current.length;
      const end = Number.isFinite(field.selectionEnd) ? field.selectionEnd : current.length;
      const merged = mergeAtSelection(current, start, end, insertion);

      window.g_form.setValue(fieldName, merged.value);
      if (String(field.value ?? "") !== merged.value) setNativeValue(field, merged.value);
      setCursor(field, merged.cursor);
      dispatchAfterInput(field, insertion);
      const formValue = String(window.g_form.getValue(fieldName) ?? "");
      return formValue === merged.value || String(field.value ?? "") === merged.value;
    } catch (_) {
      return false;
    }
  }

  function inferServiceNowField(field) {
    const clues = fieldClues(field);
    if (clues.includes("work_notes") || clues.includes("work notes")) return "work_notes";
    if (clues.includes("close_notes") || clues.includes("close notes")) return "close_notes";
    if (clues.includes("comments") || clues.includes("additional comments")) return "comments";
    return "";
  }

  function fieldClues(field) {
    return [
      field.id,
      field.name,
      field.getAttribute?.("aria-label"),
      field.getAttribute?.("placeholder"),
      field.getAttribute?.("data-field-name")
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function mergeAtSelection(value, start, end, insertion) {
    const current = String(value ?? "");
    const safeStart = clamp(start, current.length);
    const safeEnd = Math.max(safeStart, clamp(end, current.length));
    return {
      value: current.slice(0, safeStart) + insertion + current.slice(safeEnd),
      cursor: safeStart + insertion.length
    };
  }

  function clamp(value, length) {
    const number = Number(value);
    if (!Number.isFinite(number)) return length;
    return Math.max(0, Math.min(Math.trunc(number), length));
  }

  function setNativeValue(element, value) {
    const tag = element.tagName?.toLowerCase();
    const prototype = tag === "textarea"
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function setCursor(field, cursor) {
    try {
      field.setSelectionRange?.(cursor, cursor);
    } catch (_) {
      // Some input types do not expose a selection range.
    }
  }

  function dispatchBeforeInput(element, insertion) {
    try {
      return element.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "insertText",
        data: insertion,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    } catch (_) {
      return true;
    }
  }

  function dispatchAfterInput(element, insertion) {
    try {
      element.dispatchEvent(new InputEvent("input", {
        inputType: "insertText",
        data: insertion,
        bubbles: true,
        composed: true
      }));
    } catch (_) {
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function showToast(message, isError) {
    try {
      document.getElementById("clipstar-toast-host")?.remove();
      const host = document.createElement("div");
      host.id = "clipstar-toast-host";
      host.style.cssText = "all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647";
      const root = host.attachShadow({ mode: "closed" });
      const toast = document.createElement("div");
      toast.setAttribute("role", isError ? "alert" : "status");
      toast.textContent = message;
      toast.style.cssText = toastStyle(isError);
      root.appendChild(toast);
      document.documentElement.appendChild(host);
      setTimeout(() => host.remove(), 2200);
    } catch (_) {
      // Page feedback is best-effort.
    }
  }

  function toastStyle(isError) {
    return [
      "box-sizing:border-box",
      "max-width:min(520px,calc(100vw - 32px))",
      "padding:10px 14px",
      "border:1px solid rgba(255,255,255,.2)",
      "border-radius:999px",
      `color:${isError ? "#fff7ed" : "#082f49"}`,
      `background:${isError ? "#9f1239" : "#7dd3fc"}`,
      "box-shadow:0 12px 32px rgba(0,0,0,.35)",
      "font:700 13px/1.35 system-ui,sans-serif",
      "text-align:center"
    ].join(";");
  }
}

export async function copyClipInPage(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ""));
    return true;
  } catch (_) {
    return false;
  }
}

export function showClipstarToast(message, isError = false) {
  try {
    document.getElementById("clipstar-toast-host")?.remove();
    const host = document.createElement("div");
    host.id = "clipstar-toast-host";
    host.style.cssText = "all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647";
    const root = host.attachShadow({ mode: "closed" });
    const toast = document.createElement("div");
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.textContent = String(message || "");
    toast.style.cssText = [
      "box-sizing:border-box",
      "max-width:min(520px,calc(100vw - 32px))",
      "padding:10px 14px",
      "border:1px solid rgba(255,255,255,.2)",
      "border-radius:999px",
      `color:${isError ? "#fff7ed" : "#082f49"}`,
      `background:${isError ? "#9f1239" : "#7dd3fc"}`,
      "box-shadow:0 12px 32px rgba(0,0,0,.35)",
      "font:700 13px/1.35 system-ui,sans-serif",
      "text-align:center"
    ].join(";");
    root.appendChild(toast);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 2200);
  } catch (_) {
    // Feedback is best-effort.
  }
}

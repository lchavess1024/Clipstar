import test from "node:test";
import assert from "node:assert/strict";
import { insertClipInPage } from "../../extension/lib/insert.js";

test("plain textarea insertion preserves the draft and selection", async () => {
  const field = new FakeField("textarea", "Hello world");
  field.selectionStart = 6;
  field.selectionEnd = 11;
  const restore = installPageGlobals(field);

  try {
    const result = await insertClipInPage("Clipstar", "Greeting");
    assert.equal(result.ok, true);
    assert.equal(field.value, "Hello Clipstar");
    assert.equal(field.selectionStart, 14);
    assert.equal(field.selectionEnd, 14);
  } finally {
    restore();
  }
});

test("ServiceNow insertion updates g_form once without replacing the draft", async () => {
  const field = new FakeField("textarea", "Draft: done");
  field.id = "activity-stream-work_notes-textarea";
  field.selectionStart = 7;
  field.selectionEnd = 11;
  let formValue = field.value;
  let writes = 0;
  const restore = installPageGlobals(field, {
    gForm: {
      getValue: () => formValue,
      setValue: (_name, value) => {
        writes += 1;
        formValue = value;
      }
    }
  });

  try {
    const result = await insertClipInPage("reviewed", "Status");
    assert.equal(result.ok, true);
    assert.equal(writes, 1);
    assert.equal(formValue, "Draft: reviewed");
    assert.equal(field.value, "Draft: reviewed");
  } finally {
    restore();
  }
});

test("unsupported number inputs are not mutated and fall back to copy", async () => {
  const field = new FakeField("input", "42");
  field.type = "number";
  let copied = "";
  const restore = installPageGlobals(field, {
    clipboard: { writeText: async (value) => { copied = value; } }
  });

  try {
    const result = await insertClipInPage("not-a-number", "Invalid");
    assert.equal(result.ok, false);
    assert.equal(result.copied, true);
    assert.equal(field.value, "42");
    assert.equal(copied, "not-a-number");
  } finally {
    restore();
  }
});

test("a successful rich-text command is not repeated when visible text is unchanged", async () => {
  const field = new FakeRichField("same text");
  let commands = 0;
  let copied = "";
  const restore = installPageGlobals(field, {
    execCommand: () => {
      commands += 1;
      return true;
    },
    clipboard: { writeText: async (value) => { copied = value; } }
  });

  try {
    const result = await insertClipInPage("same text", "Same");
    assert.equal(result.ok, true);
    assert.equal(result.copied, false);
    assert.equal(commands, 1);
    assert.equal(copied, "");
  } finally {
    restore();
  }
});

class FakeField {
  constructor(tagName, value) {
    this.tagName = tagName.toUpperCase();
    this.value = value;
    this.type = "";
    this.id = "";
    this.name = "";
    this.disabled = false;
    this.readOnly = false;
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
  }

  focus() {}

  getAttribute(name) {
    if (name === "type") return this.type;
    if (name === "aria-label" || name === "placeholder" || name === "data-field-name") return "";
    return this[name] || "";
  }

  dispatchEvent() {
    return true;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakeRichField {
  constructor(value) {
    this.tagName = "DIV";
    this.innerText = value;
    this.textContent = value;
    this.isContentEditable = true;
    this.disabled = false;
    this.readOnly = false;
  }

  focus() {}

  getAttribute(name) {
    if (name === "contenteditable") return "true";
    if (name === "role") return "textbox";
    return "";
  }

  dispatchEvent() {
    return true;
  }
}

function installPageGlobals(field, options = {}) {
  const originals = new Map();
  const setGlobal = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const clipboard = options.clipboard || { writeText: async () => {} };
  const fakeWindow = {
    HTMLInputElement: FakeField,
    HTMLTextAreaElement: FakeField,
    getSelection: () => null,
    g_form: options.gForm
  };

  setGlobal("window", fakeWindow);
  setGlobal("document", {
    activeElement: field,
    execCommand: options.execCommand || (() => false),
    getElementById: () => null
  });
  setGlobal("navigator", { clipboard });
  setGlobal("InputEvent", class InputEvent {});
  if (!globalThis.Event) setGlobal("Event", class Event {});

  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

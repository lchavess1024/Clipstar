# Clipstar

Clipstar is a local-first Chrome extension for saving reusable text clips and inserting them from a text field's right-click menu.

## What changed in 1.1.0

This release turns the former Luis Clippings prototype into a production-oriented Clipstar project:

- Rebranded product, UI, exports, documentation, and icons.
- Replaced permanent all-site access with `activeTab`, so page access begins only when the user chooses a Clipstar context-menu item.
- Removed generated inline page scripts and the dead “save selected text” feature.
- Fixed ServiceNow insertion so it preserves the existing draft and selection and writes exactly once.
- Added serialized background mutations to prevent two open Clipstar windows from overwriting each other.
- Added strict import normalization, storage limits, ID collision handling, and deterministic folder repair.
- Added accessible dialogs, keyboard controls, visible focus states, live status messages, and keyboard-accessible imports.
- Added dependency-free tests, validation, reproducible packaging, CI, release automation, and VS Code tasks.

## Features

- Create, edit, copy, search, organize, import, and export reusable clips.
- Use root folders and one level of subfolders.
- Drag clips before or after one another to set their exact order, including across folders or back to Standalone.
- Reorder a focused clip with the up and down arrow keys when dragging is not convenient.
- Insert clips into standard inputs, textareas, contenteditable fields, and supported ServiceNow journal fields.
- Keep all saved content in Chrome's local extension storage—no account, server, analytics, telemetry, or remote code.

## Install for local testing

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `extension` folder in this repository.

Chrome blocks extensions on internal pages such as `chrome://settings`. File URLs and incognito windows require explicit permission in Chrome's extension details.

## Development

Clipstar has no runtime or development dependencies. Node.js 20 or newer is used only for validation, tests, icon generation, and packaging.
The unpacked `extension` folder can be loaded directly in Chrome without running a build first.

```bash
npm run check
npm test
npm run build
```

`npm run verify` runs all three. The release archive is written to `release/` with a matching SHA-256 checksum. Its `manifest.json` is at the ZIP root, as required by the Chrome Web Store.

## VS Code

Open this repository as a folder. The included tasks expose **Validate**, **Test**, **Build release**, and **Verify all**. The **Launch Clipstar in Chrome** debug profile starts a clean Chrome profile with the unpacked extension loaded.

## Architecture and privacy

- The popup never writes the full data store directly. It sends typed mutations to the service worker.
- The service worker serializes every mutation against the latest store revision, validates the result, and then writes it.
- When no current store exists, the first valid `luis_*` source is migrated to `clipstar_store_v1` and that migrated source key is removed after a verified write.
- Chrome local storage is restricted to trusted extension contexts.
- Page insertion runs only after a context-menu gesture and only in the frame Chrome identifies for that action.
- The packaged extension contains all executable code and performs no network requests.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Release

Follow [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). The Chrome Web Store listing copy and permission explanations are in [docs/CHROME_WEB_STORE.md](docs/CHROME_WEB_STORE.md).

## License

MIT © 2026 Luis Chaves. See [LICENSE](LICENSE).

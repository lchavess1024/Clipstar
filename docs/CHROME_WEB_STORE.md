# Chrome Web Store submission notes

## Suggested listing

**Name:** Clipstar

**Summary:** Save reusable text clips locally and insert them from Chrome's right-click menu.

**Category:** Productivity

**Single purpose:** Clipstar lets users create and organize reusable text clips, then insert a chosen clip into an editable field after an explicit right-click action.

## Detailed description

Clipstar keeps frequently reused text one right-click away. Create standalone clips or organize them into folders and subfolders, search your collection, drag clips between folders, and back up or restore everything as JSON.

Clipstar is local by design: there is no account, server, analytics, telemetry, or remote code. Your saved clips stay in Chrome storage on your device. Clipstar does not request permanent access to websites. It receives temporary access only when you choose a Clipstar item from an editable field's right-click menu.

## Permission rationale

- **storage:** Required to save user-created clips, folders, ordering, and timestamps in Chrome local storage.
- **contextMenus:** Required to show saved clips in editable fields' right-click menus.
- **activeTab:** Required to access only the current page after the user explicitly chooses a Clipstar context-menu item. This replaces persistent host access.
- **scripting:** Required to run the packaged insertion function in the exact frame selected by the context-menu action.
- **clipboardWrite:** Required for the Copy button and the disclosed fallback that copies a clip when a field cannot accept direct insertion.

## Data-use dashboard answers

Clipstar handles user-generated content (saved clip text and folder labels) and transient website/form content (the focused field's value, selection, and limited identifying attributes) solely to manage and insert clips. It does not collect, transmit, sell, or share that data. Processing and storage are local to the user's Chrome profile.

Use the public URL of `PRIVACY.md` for the privacy-policy field. Confirm that the listing, screenshots, and dashboard disclosures match the shipped version before submission.

## Required visual assets

- 128×128 store icon (included).
- At least one 1280×800 or 640×400 screenshot.
- 440×280 small promotional image if used for featuring.

Do not place unsupported claims, keyword lists, or private user data in listing assets.

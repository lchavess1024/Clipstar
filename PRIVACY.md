# Clipstar Privacy Policy

Effective: August 14, 2026

Clipstar is a local-first Chrome extension for saving reusable text clips and inserting them into text fields. This policy explains the data Clipstar handles and how it is used.

## Data Clipstar handles

Clipstar handles the following data only to provide its user-facing features:

- **Saved content:** clip labels, clip bodies, folder names, folder relationships, ordering, and creation/update timestamps that you create or import.
- **Focused field information:** after you select a Clipstar right-click menu item, Clipstar temporarily examines the focused editable element in that exact page frame. It uses the element's value, selection position, and limited field attributes such as its ID, name, label, and placeholder to insert at the cursor and support ServiceNow journal fields.
- **Clipboard data:** when you press Copy, or when a field cannot accept an insertion, Clipstar writes the selected clip to the system clipboard. Clipstar does not read or retain clipboard history.
- **Backup files:** exported JSON contains your full saved clips and folders. Imported JSON is read locally and merged into Chrome storage after validation.

## Storage, use, and retention

Saved clips and folders are stored in `chrome.storage.local`, inside your Chrome profile on the device. Chrome manages this storage; Clipstar does not add separate encryption. Extension storage access is restricted to trusted Clipstar contexts.

Clipstar uses saved content only to display, organize, copy, import, export, and insert your clips. Focused field information is processed transiently during the user-requested insertion and is not added to Clipstar storage.

Data remains until you delete individual items, clear the extension's storage, remove the extension, or remove its Chrome profile. When no current Clipstar store exists, Clipstar migrates the first valid Luis Clippings data source it finds and removes that migrated source key only after the new store is saved. Other legacy keys, if present, remain in Chrome extension storage until you clear the extension's storage or remove the extension.

Exported backups are files you control. Their retention and sharing depend on where you save them.

## Network transfers and sharing

Clipstar makes no outbound network requests and has no account, external server, telemetry, analytics, advertising, or remote code. It does not sell, rent, share, or transmit saved clips, page content, browsing activity, clipboard data, credentials, personal communications, or other user data to the developer or third parties.

When you insert a clip into a website, that website can access the inserted text because you placed it into the site's field. Clipstar does not control how that website handles data you submit to it.

## Permissions

- `storage`: stores your clips and folders locally.
- `contextMenus`: adds Clipstar to editable fields' right-click menus.
- `activeTab`: grants temporary access to the current page only after you choose a Clipstar menu item.
- `scripting`: runs the packaged insertion function in the exact frame selected by that action.
- `clipboardWrite`: supports Copy and the copy fallback when a field cannot accept insertion.

Clipstar requests no persistent host permissions and does not run a content script on every website.

## Limited Use

Clipstar's use of information received from Chrome APIs is limited to providing and improving its single user-facing purpose: managing and inserting user-created text clips. That information is not used for advertising, creditworthiness, lending, or any unrelated purpose, and is not made available for human review.

## Changes and contact

Material changes to this policy will be documented in the changelog and included with the relevant release. For privacy questions, open an issue in this repository without including sensitive clip contents. For a security vulnerability, follow [SECURITY.md](SECURITY.md).

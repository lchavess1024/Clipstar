# Release checklist

## Automated

- [ ] `npm run verify` passes.
- [ ] Manifest and package versions match the intended tag.
- [ ] The generated ZIP has `manifest.json` at its root.
- [ ] The SHA-256 checksum matches the ZIP.
- [ ] CI passes on the release commit.

## Manual Chrome smoke test

- [ ] Load the generated `dist/clipstar` folder, not a development source folder.
- [ ] First run creates the welcome clip and the context menu.
- [ ] Create, edit, delete, search, copy, drag, import, and export work.
- [ ] A second open Clipstar window does not lose changes made in the first.
- [ ] Insertion preserves text before and after selections in inputs and textareas.
- [ ] Multiline insertion works in a contenteditable field.
- [ ] A real ServiceNow journal insertion preserves the current draft and occurs once.
- [ ] Unsupported fields copy only when clipboard access actually succeeds.
- [ ] Restricted pages fail safely and show the action badge warning.
- [ ] Keyboard-only use, Escape-to-close, focus return, and screen-reader labels work.

## Store and repository

- [ ] `PRIVACY.md`, listing disclosures, screenshots, and permission explanations match the release.
- [ ] No secrets, `.pem`, `.crx`, user backups, browser profiles, or development files are included.
- [ ] Private vulnerability reporting is enabled on GitHub.
- [ ] Complete [Chrome Web Store automation setup](CHROME_WEB_STORE_AUTOMATION.md) and its read-only connection test.
- [ ] Increase the version in `package.json`, `package-lock.json`, and `extension/manifest.json` above the store version.
- [ ] Commit and push to `main`, then push tag `v<version>`; the release workflow publishes the ZIP and checksum to GitHub.
- [ ] If `CWS_PUBLISH_ENABLED=true`, confirm the Chrome submission job succeeded. `PENDING_REVIEW` means submitted, not live.
- [ ] Confirm Google's approval and the new version in the store dashboard before announcing availability.

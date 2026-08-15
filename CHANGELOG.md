# Changelog

All notable changes to Clipstar are documented here.

## [1.2.0] - 2026-08-14

### Added

- Drag handles for placing clips before or after one another within Standalone, folders, and subfolders.
- Exact cross-folder placement instead of always relying on a clip's previous position.
- Up and down arrow-key ordering from each clip's drag handle.
- Persistent folder-local position normalization so popup and right-click menu order stay in sync.

## [1.1.0] - 2026-08-14

### Added

- Clipstar branding and a new clipboard-star icon set.
- Dependency-free unit tests, source validation, deterministic packaging, CI, release automation, and VS Code tasks.
- Store revisions, import/storage limits, accessible dialogs, keyboard navigation, and live status messages.
- Detailed privacy, security, architecture, permission, and release documentation.

### Changed

- Replaced persistent `<all_urls>` access with user-triggered `activeTab` injection into the selected frame.
- Centralized storage normalization and migrations.
- Routed all popup changes through a serialized service-worker mutation queue.
- Restricted Chrome local storage to trusted extension contexts.
- Migrated valid `luis_*` storage data to `clipstar_store_v1` and removed stale legacy keys.

### Fixed

- Preserved existing text and selection during regular and ServiceNow insertions.
- Removed duplicate/overwriting ServiceNow insertion paths and false synthetic-paste success reports.
- Prevented imported ID collisions from reparenting existing folders.
- Repaired malformed, cyclic, missing-parent, duplicate-ID, and over-deep folder data.
- Excluded number and other non-text input types from insertion.
- Serialized and error-checked context-menu rebuilds.

### Removed

- Dead selected-text capture UI and its unhandled message flow.
- Generated inline page scripts and permanent all-page content injection.

## [1.0.4] - 2026-08-14

- Last archived Luis Clippings prototype supplied as the basis for Clipstar.

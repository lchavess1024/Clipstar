# Security Policy

## Supported versions

Security fixes are provided for the latest Clipstar release on the `main` branch.

| Version | Supported |
| --- | --- |
| 1.1.x | Yes |
| 1.0.x and older Luis Clippings builds | No |

## Reporting a vulnerability

Please do not publish exploit details or sensitive clip contents in a public issue. Use GitHub's **Report a vulnerability** option in the repository's Security tab. If private vulnerability reporting is unavailable, open a minimal issue asking the maintainer for a private contact channel.

Include the affected version, impact, reproduction steps, and any suggested remediation. You should receive an acknowledgement within seven days.

## Security design

- No remote code, network requests, accounts, telemetry, or analytics.
- No persistent site access or static all-page content script.
- Page access is temporary and begins only after an explicit context-menu action.
- Saved data is restricted to trusted extension contexts.
- All mutations are serialized and validated before storage.
- Imports are bounded, normalized, and checked against the storage budget.
- Release ZIPs are reproducible and accompanied by a SHA-256 checksum.

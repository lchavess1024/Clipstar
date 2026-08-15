# Contributing to Clipstar

1. Create a focused branch and keep production runtime code inside `extension/`.
2. Do not add remote code, telemetry, network calls, persistent host access, or new permissions without an explicit product and privacy review.
3. Add or update tests for behavior changes.
4. Run `npm run verify` before opening a pull request.
5. Describe user-visible changes in `CHANGELOG.md`.

Keep the extension dependency-free unless a dependency provides a clear security or maintenance benefit that cannot be achieved with the platform.

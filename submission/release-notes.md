# Submission release notes

KeepKeys 0.1.1 is the initial BarnLabs submission.

It gives Codex use of named local secrets without returning plaintext to the model. Codex supplies the friendly name, variable name, and description; macOS users only enter the key through a native secure field. Records stay in macOS Keychain. Each use requires a native one-time approval showing the exact executable, arguments, purpose, working directory, stored metadata, and SHA-256 fingerprint. The child environment is cleared before the one stored variable is added.

Version 0.1.1 also fixes plugin-relative MCP startup verified from a fresh installed Codex task.

The initial version is macOS 13+ only. It has no account, cloud vault, telemetry, network service, raw retrieval tool, Windows/Linux/iOS support, or web-only mode.

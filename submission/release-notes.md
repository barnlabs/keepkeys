# Submission release notes

KeepKeys 0.3.0 is the current BarnLabs submission.

It gives Codex use of named local secrets without returning plaintext to the model. Codex supplies the friendly name, variable name, and description; macOS users only enter the key through a native secure field. Records stay in macOS Keychain. Each use requires a native one-time approval showing the exact executable, arguments, purpose, working directory, stored metadata, and SHA-256 fingerprint. The child environment is cleared before the one stored variable is added.

Version 0.3.0 preserves the verified Codex MCP startup path and adds compatible
packaging for Claude Code, Oh My Pi, Hermes, Gemini CLI, and Agent Skills
clients. Those additional distributions do not expand the Codex tool surface or
the plaintext boundary.

The current version is macOS 13+ only. It has no account, cloud vault, telemetry,
network service, raw retrieval tool, Windows/Linux/iOS support, or web-only mode.

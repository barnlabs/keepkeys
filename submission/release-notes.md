# Submission release notes

KeepKeys 0.4.1 is the current BarnLabs submission.

It gives Codex use of named local secrets without returning plaintext to the
model. Codex supplies the friendly name, variable name, and description; users
enter only the key through native secure UI. Records stay in macOS Keychain,
Windows Credential Manager, or Linux Secret Service. Each use requires native
one-time approval showing the risk class, exact executable, arguments, purpose,
working directory, stored metadata, SHA-256 fingerprint, and detected script
entrypoint fingerprint. The child environment is cleared before the one stored
variable is added.

Version 0.4.1 adds a deliberate immutable-commit update checker, strengthens the
Windows scoped-process proof, adds a complete MCP stdio transcript regression,
and formalizes independent adversarial review and release evidence. It preserves
the macOS, Windows, and Linux native backends and compatible packaging for Grok
Build/Grok Code, Claude Code, Oh My Pi, Hermes, Gemini CLI, and Agent Skills
clients. Those distributions do not expand the six-tool surface or plaintext
boundary.

KeepKeys has no account, cloud vault, telemetry, network service, raw retrieval
tool, mobile support, or web-only mode. Missing vault or GUI prerequisites fail
closed.

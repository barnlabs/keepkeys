# Submission release notes

KeepKeys 0.4.2 is the current BarnLabs submission.

It gives Codex use of named local secrets without returning plaintext to the
model. Codex researches official credential documentation and supplies the
friendly name, variable name, description, provider, and documentation links;
users only copy the key and press **Paste & Store** in native UI. Records stay
in macOS Keychain, Windows Credential Manager, or Linux Secret Service. Each
use requires native
one-time approval showing the risk class, exact executable, arguments, purpose,
working directory, stored metadata, SHA-256 fingerprint, and detected script
entrypoint fingerprint. The child environment is cleared before the one stored
variable is added.

Version 0.4.2 replaces editable metadata and password typing with one explicit
native paste action, validates agent metadata before UI opens, and stores
provider plus official documentation links for future agent use. It preserves
the deliberate immutable-commit update checker, three native backends, and
compatible packaging for Grok Build/Grok Code, Claude Code, Oh My Pi, Hermes,
Gemini CLI, and Agent Skills clients. Those distributions do not expand the
six-tool surface or plaintext boundary.

KeepKeys has no account, cloud vault, telemetry, network service, raw retrieval
tool, mobile support, or web-only mode. Missing vault or GUI prerequisites fail
closed.

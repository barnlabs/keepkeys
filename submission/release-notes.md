# Submission release notes

KeepKeys 0.5.0 is the current BarnLabs submission.

It gives Codex use of named local secrets without returning plaintext to the
model. Codex researches official credential documentation and supplies the
friendly name, variable name, description, provider, and documentation links;
users only copy the key and press **Paste & Store** in native UI. Records stay
in macOS Keychain, Windows Credential Manager, or Linux Secret Service. Each
use requires native one-time approval showing the risk class, exact executable,
arguments, purpose, working directory, stored metadata, SHA-256 fingerprint,
and detected script entrypoint fingerprint. The child environment is cleared
before the one stored variable is added.

Version 0.5.0 adds private phone intake. KeepKeys can create a ten-minute,
one-use Tailscale Serve page on the connected computer. A user in the same
tailnet reviews the non-secret metadata, pastes the key, and submits it directly
to the computer's native vault. The page binds to one Tailscale identity and
browser session, checks origin and request size, and closes after one
submission or expiry. UTF-8 byte limits are enforced in the page script and
server. After a vault write, the page shows success only after the owned Serve
process stops and the exact route is gone; a cleanup failure is shown
separately from a failed vault write. Native paste-and-store and phone intake
share one per-name coordinator, preventing a concurrent store from silently
bypassing the displayed replacement state. A post-write lock cleanup error
still says the key was stored, preventing a duplicate submission. The detached
portal requires a launcher acknowledgment before it can survive independently,
and it closes if foreground Serve exits after readiness, including while that
acknowledgment is pending. Native tests reject both stale create-to-replace and
replace-to-create states on macOS, Windows, and Linux. Linux vault lookup
failures fail closed, generated cleanup requires both items to be deleted, and
failed Linux or Windows storage rollback is shown as uncertain instead of
discarded. A missing or inconsistent native commit receipt is also uncertain.
Native uncertainty remains visible if lock cleanup also fails. Startup helper
descendants are terminated and awaited on cancellation. KeepKeys never enables
Tailscale Funnel.

The release preserves the immutable-commit update checker, three native
backends, and packages for Grok Build/Grok Code, Claude Code, Oh My Pi, Hermes,
Gemini CLI, and Agent Skills clients.

KeepKeys has no account, cloud vault, telemetry, raw retrieval tool, public
secret-intake page, synchronization service, or web-only mode. Missing vault,
GUI, or Tailscale prerequisites fail closed.

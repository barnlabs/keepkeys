# Submission release notes

KeepKeys 0.6.0 is the current BarnLabs submission.

Version 0.6.0 adds native exact-command automatic approval on macOS, Windows,
and Linux. The user can choose **Always allow this exact command** after
reviewing the purpose, canonical executable, SHA-256, arguments, working
directory, and optional interpreter entrypoint fingerprint. The rule contains
metadata only, and `keepkeys_revoke` removes it after native confirmation.

`keepkeys_rotate` reuses the existing metadata, requires the named record to
still exist under the shared per-name lock, opens the native Paste & Store flow,
and clears old automatic approvals before the replacement can be used. Approved
command execution uses the same lock, preventing an old rule from racing a
replacement write.

The skill now requires search-tool research of official provider documentation
before metadata is prepared. The update checker remains explicit and local: it
reports reviewed immutable source/catalog pins, never installs in the
background, and never synchronizes vault values between devices.

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
separately from a failed vault write. Native paste-and-store, phone intake, and
removal share one per-name coordinator, preventing removal from interleaving
with a write and preventing a concurrent store from silently bypassing the
displayed replacement state. A post-write lock cleanup error still says the key
was stored, preventing a duplicate submission. The detached portal completes a
two-way handshake before the launcher can return its URL, and it closes if
foreground Serve exits after readiness, including during either side of that
handshake. Native tests reject both stale create-to-replace and
replace-to-create states on macOS, Windows, and Linux. Linux vault lookup
failures fail closed, generated cleanup requires both items to be deleted, and
failed Linux or Windows storage rollback is shown as uncertain instead of
discarded. A missing, incomplete, or inconsistent native commit receipt is
also uncertain. Native uncertainty remains visible if lock cleanup also fails.
Startup helper process groups are terminated and verified on cancellation even
if a leader exited first. Windows snapshots owned PID ancestry and process
creation identity before signaling, follows surviving descendants through
exited ancestors, refuses to signal a reused PID, and fails cleanup unless
every tracked process is gone. KeepKeys never enables Tailscale Funnel.

The release preserves the immutable-commit update checker, three native
backends, and packages for Grok Build/Grok Code, Claude Code, Oh My Pi, Hermes,
Gemini CLI, and Agent Skills clients.

KeepKeys has no account, cloud vault, telemetry, raw retrieval tool, public
secret-intake page, synchronization service, or web-only mode. Missing vault,
GUI, or Tailscale prerequisites fail closed.

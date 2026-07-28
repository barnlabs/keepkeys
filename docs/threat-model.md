# Threat model

## Security objective

KeepKeys lets a supported local agent cause one user-approved process to use one
named secret without placing the plaintext value in the model prompt, tool
arguments or results, plugin metadata, repository, persistent environment,
terminal, or plaintext file. Clipboard access occurs only inside the native
helper after the user explicitly presses **Paste & Store**. A user on a phone
may instead press **Paste & Store** on a one-time, tailnet-only Tailscale Serve
page connected to the host.

This is scoped delegation, not containment after delegation. The approved
program and its descendants receive the value.

## Assets

- secret values;
- friendly names, variable names, descriptions, provider names, documentation
  URLs, and command purposes;
- user intent for store, replacement, deletion, and each use;
- one-time phone-intake URLs, Tailscale identity metadata held for the active
  session, and the user's intent to submit from the phone;
- integrity of the plugin source, dispatcher, native helper, approval window,
  target executable, and optional script entrypoint;
- availability and correctness of the native credential vault;
- bounded command output returned to an agent.

## Roles and trust boundaries

| Role or boundary | Trust and control |
| --- | --- |
| User | Trusted to copy a value from its provider, trigger the native paste, and judge the displayed one-time request. |
| Agent/client | Untrusted with plaintext through the KeepKeys protocol. It can propose metadata and a command through fixed schemas. A host with unrestricted same-user command execution is not contained while a value is on the shared clipboard. |
| MCP/Hermes adapter | Trusted code boundary. It validates arguments, selects one bundled backend, uses no shell, and returns bounded JSON. |
| Native helper | Trusted secret-bearing boundary. It owns click-gated clipboard ingestion, vault access, approval, fingerprints, child environment, and redaction. |
| Phone portal process | Trusted, temporary secret-bearing boundary. It owns the localhost listener, Tailscale identity and browser binding, one submitted byte buffer, a per-name commit lock, and a capability-framed redirected pipe to the native helper. |
| Tailscale Serve | Trusted private transport and identity boundary for phone intake. It terminates tailnet HTTPS on the host and forwards only to `127.0.0.1`. Funnel is forbidden. |
| OS credential vault | Trusted for per-user at-rest protection and its own lock/unlock policy. |
| Approved executable | Trusted only for this action. It and descendants can read, transform, persist, or transmit the secret. |
| Same-user malware / administrator | Out of the defended boundary. It can inspect memory, replace local code, automate UI, or access the signed-in vault. |

## Cross-platform controls

### Conversation to helper

No input schema includes `secret`, `value`, or an equivalent plaintext field.
The behavioral skill forbids asking for the value. Store carries only name,
variable, description, provider, and official documentation URLs. There is no
plaintext retrieval action. `keepkeys_store_from_phone` carries the same
metadata and returns only a one-time tailnet URL, expiry, replacement state,
and status.

The MCP server and Hermes adapter form argument arrays and start a
repository-relative helper with `shell=false`. The dispatcher keeps only
session variables needed for the selected native desktop/vault.

### Native entry to vault

- macOS uses AppKit pasteboard access only after **Paste & Store** and a
  non-synchronizing `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` Keychain
  item.
- Windows uses WPF clipboard access only after **Paste & Store**. Metadata and
  value are separate generic
  Credential Manager records, so listing and pre-approval lookup never request
  the value record.
- Linux uses Tk clipboard access only after **Paste & Store** and separate
  metadata/value Secret
  Service items. It pipes the value directly to `secret-tool store`; the value
  is never an argument, environment variable, terminal input, or file.

All three paths require 8–2048 UTF-8 bytes. After capture, each helper
immediately clears the current clipboard before storage or replacement review.
The helpers also clear mutable buffers where their runtime provides a reliable
operation. Clipboard history, Swift, .NET strings, Python strings, GUI
frameworks, vault APIs, and target-process environments can retain copies;
KeepKeys does not claim complete zeroization.

The clipboard is a same-user OS boundary, not a protected channel. Other
same-user software—including an agent host able to run arbitrary local
commands—or clipboard-history features may read its contents before the helper
clears it. Clearing reduces dwell time but cannot retract a history entry or a
copy already observed. KeepKeys narrows its own access to the explicit click,
never returns the value through its protocol, and instructs the user to copy
directly from the provider immediately before storing.

### Vault to command

The helper validates metadata, prepares the exact request, and obtains native
one-time approval before reading the protected value. It then reloads or
rechecks metadata. Windows reads only `meta/*` before approval and reads the
paired `secret/*` record after approval. Linux label search returns metadata;
lookup happens after approval. macOS requests Keychain attributes first and
value data afterward. Linux `secret-tool search` prints only the paired metadata
item payload; KeepKeys never searches the protected-value service.

### Request to executable

KeepKeys requires an absolute direct executable path, resolves it, rejects
common shells and environment-dump or dynamic script-host programs, and shows
its SHA-256. Interpreters and common network-capable clients receive explicit
risk labels. When an interpreter's script entrypoint can be identified, that
file receives a second hash.

The executable and optional entrypoint are hashed again immediately before
launch. A same-user attacker may still win a narrow path or filesystem
time-of-check/time-of-use race. KeepKeys does not claim descriptor-bound
execution on every supported OS.

### Parent to child

The target is launched without a shell. The child environment begins empty and
receives only the one approved variable. OS loader state, process architecture,
and implementation-defined runtime state may exist outside the user-visible
environment map. Descendants may inherit the secret.

### Child output to agent

stdout and stderr are drained concurrently into separate 1 MiB bounded
captures. A stream that exceeds the bound is replaced in full with a fixed
omission marker. KeepKeys replaces exact, Base64, hexadecimal, URL-encoded, and
JSON-escaped representations before returning JSON.

Redaction cannot detect arbitrary splitting, encryption, compression, hashing,
steganography, network transmission, file writes, IPC, screenshots, or
side-channels. It is defense in depth, never a data-loss-prevention guarantee.

## Platform-specific abuse cases

### macOS source or cache replacement

The launcher rejects symlinked source/cache files, requires a current-user-owned
mode-0700 cache, verifies the Swift source against a pinned SHA-256, builds in a
private temporary directory, and replaces the compiled helper only after
success. A process already acting as the same user can still replace plugin
files and is outside the boundary.

### Windows paired-record interruption

A crash can occur between Credential Manager writes. Replacement snapshots the
old pair, writes the value and metadata, and attempts rollback on failure.
Doctor verifies create, update, enumerate, read, and deletion. An unclean
process termination at the exact inter-write boundary can still leave an orphan
record; listing ignores orphan value records and a later approved store/remove
repairs the named pair.

### Linux Secret Service diversity

The freedesktop specification does not mandate a uniform at-rest algorithm,
master password, or per-application access-control model. KeepKeys requires a
compatible provider and inherits its security policy. Item attributes and
labels are explicitly non-secret metadata. The value crosses the local D-Bus
and a `secret-tool` pipe; it never crosses the agent protocol.

Linux replacement snapshots the prior value and metadata. If either
`secret-tool store` call raises a KeepKeys error, operating-system error,
timeout, or other subprocess failure, KeepKeys attempts to restore the complete
previous pair before returning the failure.

KeepKeys refuses to use a plaintext keyring fallback and refuses secret entry
when no graphical session is available.

### Vault unlock prompts

The native Keychain, Credential Manager, or Secret Service may apply additional
OS policy or display its own unlock/authentication prompt. KeepKeys does not
bypass or suppress it. Cancellation or vault failure returns an error without
launching the command.

### Prompt injection or compromised agent

The agent can ask for metadata enumeration or propose a misleading purpose,
path, or arguments. It cannot invoke a KeepKeys value-retrieval tool because
none exists. Store clipboard access, replacement, removal, and Run retain
native human gates. If the agent host can execute arbitrary commands as the
signed-in user, KeepKeys does not sandbox that host from the shared system
clipboard or native vault; the user must copy only when the Store window is
ready and activate **Paste & Store** immediately.
Metadata remains visible to the active agent when list is authorized, so
descriptions should be useful but minimal.

### Phone to host

Phone intake is opt-in and requires Tailscale 1.52 or newer on the host, a
signed-in phone in the same tailnet, MagicDNS, and tailnet HTTPS. KeepKeys
starts one localhost HTTP listener and invokes `tailscale serve` in the
foreground with an unguessable path. It never invokes `tailscale funnel`,
listens on a LAN address, creates a BarnLabs account, or sends the key through a
BarnLabs server.

Tailscale Serve strips caller-supplied identity headers and adds the
authenticated Tailscale user identity for tailnet traffic. KeepKeys rejects
requests without that header. The first GET binds the session to one identity,
sets a Secure, HttpOnly, SameSite=Strict cookie, and returns a page with no
third-party resources. Later GETs require both that identity and cookie, so a
second browser under the same identity cannot acquire another session cookie.
The form is disabled until the nonce-authorized script runs, and its password
input has no HTML `name`. If JavaScript is blocked or fails, the browser cannot
serialize the value into a query string or form submission.
POST requires the same identity, exact HTTPS origin, cookie, content type,
path, and 8-2048-byte body. The first authenticated POST claims the session
before its body is read; malformed bodies, native failure, and successful
storage are all terminal. The session expires after ten minutes.

The URL is a short-lived capability visible to the active agent and user.
Skill instructions forbid the agent from opening, previewing, or testing it
because the first GET binds the session. Another authorized tailnet user who
obtains the unused URL could bind it first. Tailscale ACLs remain the user's
network-level control. A local agent host with arbitrary command execution can
also call its own Tailscale URL and is outside KeepKeys' containment boundary,
as it already is for the shared host clipboard.

The page shows metadata and whether the name existed when the page opened. A
per-name, user-owned exclusive lock serializes portal commits across processes
and remains held across the native existence recheck and write. A
create-to-replace or replace-to-create race therefore fails closed and requires
a new page. A process crash can leave an orphaned lock file; subsequent intake
fails closed until that file is removed from
`~/Library/Caches/net.barnlabs.keepkeys/portal-locks` on macOS,
`%LOCALAPPDATA%\BarnLabs\KeepKeys\portal-locks` on Windows, or
`${XDG_RUNTIME_DIR:-~/.cache}/keepkeys/portal-locks` on Linux.

The submitted bytes travel from the localhost portal process to the native
helper through redirected stdin after a 256-bit capability frame. Public
dispatch rejects the internal action, and every native backend requires its
direct parent PID to be Node executing the exact bundled
`keepkeys-portal.mjs`. These checks remove the public command shortcut; they do
not contain same-user code injection or modified local plugin source, which are
outside the defended boundary. The bytes never appear in argv, a tool payload,
a file, a log, or a persistent environment. KeepKeys clears mutable Node,
Swift, .NET, and Python buffers where possible, but those runtimes and
operating-system APIs may retain copies.

KeepKeys cannot clear the phone's clipboard or clipboard history. The page
tells the user to copy only when it is ready and submit immediately. Tailscale
and the user's identity provider can observe normal connection and identity
metadata; the key stays inside the encrypted connection to the host.

Submission, expiry, startup failure, or termination closes the listener, aborts
and kills an in-flight native helper process group, gracefully signals the
portal process group, waits for the owned Serve child, and queries Tailscale
until the exact generated path is absent. Route absence without process exit,
or process exit without route absence, is a cleanup failure; failure of one
proof cannot stop KeepKeys from awaiting the other. Metadata and Tailscale
startup operations share an abort signal and both settle before startup failure
is returned. A successful vault write does not produce a browser success
response until the owned Serve process exits and the exact path is absent. If
that cleanup fails, the response says the key was stored and reports cleanup
failure. Unconfirmed native-helper termination remains a teardown failure after
the commit promise settles. Serve output is drained but not retained after
readiness. Expiry teardown is scheduled from the timestamp advertised to the
user, including time spent starting Serve. A pre-existing listener conflict
fails closed rather than changing another Tailscale Serve configuration.

### Approved target disclosure

Approval is authority to deliver the secret to the displayed executable, not a
claim that the executable is safe. Network-capable tools can transmit it;
interpreters can run arbitrary code; child processes inherit it. Users must
approve only the target and action they intend.

### Timeout and process-tree cleanup

Adapters enforce a 15-minute default timeout and terminate the helper process
tree. A malicious target may detach into another session or exploit OS-specific
process behavior to escape cleanup. That is treated as approved-target risk.

### Supply-chain or client compromise

Source-pinned installation, helper source digests, shared schema tests, minimal
dependencies, and cross-platform CI reduce risk. They do not defend against a
malicious plugin checkout, compromised client process, compromised CI/release
account, or altered operating system.

The deliberate update checker trusts a fixed GitHub Raw origin only for public
release metadata. It caps and validates the response, requires full commit
SHAs, and performs no installation. A compromised repository or GitHub account
could still publish malicious commit identifiers; the user must review the
linked diff and green public evidence before updating. KeepKeys does not claim
signed update metadata.

## Explicit non-goals

- protection from root/administrator, malware, keyloggers, debuggers, injected
  code, or a compromised signed-in account;
- containment of an agent host with unrestricted same-user local-command
  execution while a credential is present on the shared system clipboard;
- confinement after delivery to an approved executable;
- general output DLP or network egress control;
- team sharing, cloud synchronization, backup, recovery, or rotation;
- public browser intake, Tailscale Funnel, server-side secret storage, or
  headless secret entry;
- absolute, “unbreakable,” or formal-verification claims.

## Required regression invariants

1. No adapter input accepts plaintext secret material.
2. No tool or helper action retrieves plaintext for the model.
3. Secret entry occurs only after explicit **Paste & Store** in native GUI,
   never chat or terminal, and the current clipboard is cleared immediately
   after capture.
4. Listing and pre-approval flow use metadata without loading the protected
   value.
5. Run requires one-time native approval for an exact request.
6. The helper invokes a direct absolute executable without a shell.
7. The child environment contains only the approved secret variable.
8. Executable and detected entrypoint hashes are rechecked after approval.
9. Cancellation performs no store, delete, or launch.
10. Output is bounded and common representations are redacted.
11. Doctor uses only a generated temporary credential and removes it.
12. Missing UI or native-vault prerequisites fail closed.
13. Update discovery is explicit, bounded, read-only, and cannot install code.
14. Agent-supplied names, providers, and documentation links are validated
    before native UI opens and are never editable by the user.
15. Phone intake uses Tailscale Serve only, binds one identity and browser
    session, accepts one bounded authenticated submission attempt, and expires
    within ten minutes.
16. Phone-submitted bytes reach the native helper only through redirected
    stdin and never enter a tool payload, argv, file, log, or persistent
    environment.
17. Phone commits serialize by name across portal processes, and native commit
    dispatch requires a capability frame plus the exact bundled portal parent.
18. Portal submission, expiry, startup failure, and termination remove the
    localhost listener, in-flight native helper, and foreground Serve route
    without resetting unrelated Tailscale configuration.

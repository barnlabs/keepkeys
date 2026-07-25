# Threat model

## Security objective

KeepKeys lets a supported local agent cause one user-approved process to use one
named secret without placing the plaintext value in the model prompt, tool
arguments or results, plugin metadata, repository, persistent environment,
terminal, or plaintext file. Clipboard access occurs only inside the native
helper after the user explicitly presses **Paste & Store**.

This is scoped delegation, not containment after delegation. The approved
program and its descendants receive the value.

## Assets

- secret values;
- friendly names, variable names, descriptions, provider names, documentation
  URLs, and command purposes;
- user intent for store, replacement, deletion, and each use;
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
| OS credential vault | Trusted for per-user at-rest protection and its own lock/unlock policy. |
| Approved executable | Trusted only for this action. It and descendants can read, transform, persist, or transmit the secret. |
| Same-user malware / administrator | Out of the defended boundary. It can inspect memory, replace local code, automate UI, or access the signed-in vault. |

## Cross-platform controls

### Conversation to helper

No input schema includes `secret`, `value`, or an equivalent plaintext field.
The behavioral skill forbids asking for the value. Store carries only name,
variable, description, provider, and official documentation URLs. There is no
plaintext retrieval action.

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
signed update metadata in version 0.4.2.

## Explicit non-goals

- protection from root/administrator, malware, keyloggers, debuggers, injected
  code, or a compromised signed-in account;
- containment of an agent host with unrestricted same-user local-command
  execution while a credential is present on the shared system clipboard;
- confinement after delivery to an approved executable;
- general output DLP or network egress control;
- team sharing, cloud synchronization, backup, recovery, or rotation;
- browser, mobile, server, or headless approval support;
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

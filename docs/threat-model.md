# Threat model

## Security objective

KeepKeys lets a supported local agent use a user-selected secret without placing
the plaintext value in the model prompt, adapter arguments/results, plugin
metadata, repository, persistent environment, or shell command.

## Assets

- secret value;
- stored environment-variable name and description;
- friendly name and command-purpose metadata;
- integrity of the native helper, MCP server, approval dialog, and target executable;
- user intent for each store, overwrite, remove, and run action.

## Trust boundaries

| Boundary | Control |
| --- | --- |
| Conversation → adapter | The shared tool schemas contain no plaintext-secret field. The skill forbids asking for or reconstructing a value. |
| Adapter → native helper | MCP or the Hermes bridge spawns a fixed repository-relative launcher with an argument array, no shell, and a minimal environment. The launcher re-executes the helper with only system `PATH` and the current home directory. |
| Native entry → Keychain | The agent supplies name, variable, and description; `NSSecureTextField` collects only the value. Security.framework stores one non-synchronizing, device-local generic-password item. |
| Keychain → command | The native helper reads the record only after preparing a concrete request and the user approves it once. |
| Request → executable | Absolute path, resolved symlinks, executable check, fixed arguments, working directory, and SHA-256 are shown. The hash is checked again immediately before launch. |
| Parent → child | The environment is cleared, then one stored variable is added. `Process` invokes the executable directly; common shells and environment-dump programs are rejected. |
| Child output → agent | Output is bounded and exact/common encodings of the secret are redacted before JSON reaches an adapter. If either stream exceeds its bound, that entire stream is replaced by a fixed omission marker. |
| Plugin source → compiled helper | The launcher fails closed unless the Swift source matches its pinned SHA-256 digest. A user-owned non-symlink cache compiles that source; a hash of the source plus launcher/build recipe triggers rebuilds. |

## Adversaries and abuse cases

### Prompt injection or compromised agent asks for plaintext

There is no retrieval tool. Store accepts only name, variable, and description metadata. Use returns bounded command output, not a credential field.

### Agent enumerates credential metadata

`keepkeys_list` deliberately returns names, variable names, and descriptions
without a second native prompt so a future authorized task can find the correct
credential. The skill permits listing only on an explicit request or when
necessary for the current task. Users should keep descriptions minimal because
the active agent task can read this metadata.

### Agent attempts `/usr/bin/env`, a shell, or misleading command

The helper rejects common shells and environment-dump programs. Every allowed request still requires native approval showing the canonical executable, arguments, purpose, variable name, working directory, and hash.

### Approved target prints or encodes the secret

KeepKeys redacts the exact value plus common base64, hexadecimal, URL-encoded, and JSON-escaped forms. A stream that exceeds 1 MiB is omitted completely so truncation cannot expose a partial encoded value. This is defense in depth, not a data-loss-prevention guarantee. An approved program can transform, transmit, persist, fork with, or otherwise disclose its environment. Only approve a target you intend to trust.

### Executable changes between review and launch

KeepKeys fingerprints the resolved file, displays the hash, and recomputes it immediately before `Process.run`. A same-user attacker may still win a narrow time-of-check/time-of-use race. Stronger descriptor-bound execution is not portable through Foundation `Process`.

### Another same-user process reads Keychain

macOS Keychain provides at-rest storage and application access controls, but a compromised signed-in session or administrator can interact with Keychain, automate approval UI, inspect process memory, replace plugin files, debug processes, or capture keystrokes. KeepKeys does not claim same-user sandbox isolation.

### Secret remains in memory

The value necessarily exists in the secure text field, Swift strings/data, Security.framework call, Keychain response, `Process` environment, target process, and possibly descendants. Swift and Foundation do not provide a complete zeroization guarantee for copied strings. KeepKeys minimizes lifetime and never deliberately logs the value, but does not claim memory-forensic resistance.

### Cache replacement

The launcher rejects a symlink cache root, checks current-user ownership, uses mode `0700`, builds in a private temporary directory, and atomically replaces the helper. A process already acting as the same user can still replace source or cache content and is outside the defended boundary.

### Tool timeout

The MCP server and Hermes bridge launch the helper in a dedicated process group.
If the 15-minute local approval/command limit expires or helper output violates
the adapter bound, the adapter sends `SIGKILL` to that group before returning an
error. A target that deliberately creates a new session or process group can
escape group cleanup and is treated as an untrusted approved-target behavior.

### Client adapter changes semantics

Client packages are deliberately declarative or thin. The canonical JSON schema
is shared by MCP and Hermes; validation requires identical skills for root and
bundled distributions. A compromised client or modified installed plugin can
still misdescribe tool intent, change source, or bypass the skill. The native
store/run/remove windows remain the final user gate, and source pinning plus the
launcher digest reduces—but does not eliminate—installed-source tampering.

## Explicit non-goals

- protection from root, administrator, malware, keyloggers, debuggers, injected code, or a compromised macOS account;
- secret confinement after delivery to an approved process;
- encoded/fragmented/steganographic output detection;
- remote, shared, synchronized, backup, recovery, or team-vault storage;
- Windows, Linux, iOS, or web support in version 0.3;
- absolute security claims.

## Required regression invariants

1. No adapter input schema accepts `secret`, `value`, or equivalent plaintext.
2. No tool or CLI action retrieves a plaintext value for the model.
3. An agent can pre-fill metadata, but secret entry occurs in native UI and Keychain only.
4. Run requires one native approval and direct absolute executable invocation.
5. The child starts from an empty environment plus one stored variable.
6. Cancellation performs no store, delete, or launch.
7. Captured output is bounded and exact/common representations are redacted.
8. Tests never touch user credentials; `doctor` creates and removes its own generated item.

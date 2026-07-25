# Architecture

KeepKeys is a local secret-use broker for desktop coding agents. It has one
agent-facing contract and three native security backends:

```text
Codex · Grok Build · Claude Code · Oh My Pi · Gemini CLI
                         │
                    MCP over stdio
                         │
Hermes ── Python bridge ─┤
                         ▼
             fixed cross-platform dispatcher
                │          │          │
              macOS      Windows     Linux
             AppKit/WPF/Tk native human gates
                │          │          │
             Keychain   Credential   Secret
                        Manager       Service
```

## Stable agent contract

Every supported client loads the canonical definitions in
`plugins/keepkeys/mcp/tools.json`. The six operations are:

- `keepkeys_store`
- `keepkeys_list`
- `keepkeys_remove`
- `keepkeys_run`
- `keepkeys_status`
- `keepkeys_doctor`

There is deliberately no `get`, `show`, `copy`, `reveal`, `export`, or generic
command tool. Store accepts a friendly name, an environment-variable name, and
a description, but no secret value. The helper emits one bounded JSON result.

The Node MCP server and Hermes adapter validate the same limits and build the
same fixed argument vector. Neither constructs a shell command. The platform
dispatcher preserves only the minimum OS session variables required to reach
the native vault and desktop, then launches exactly one bundled backend:

| Platform | Backend | Secure storage | Human interface |
| --- | --- | --- | --- |
| macOS 13+ | compiled Swift | Security.framework Keychain | AppKit secure text and approval windows |
| Windows 10/11 | Windows PowerShell + compiled in-memory C# | Windows Credential Manager | WPF `PasswordBox` and approval windows |
| desktop Linux | Python 3 | freedesktop Secret Service through `secret-tool` | native Tk password and approval windows |

`scripts/keepkeys-cli.mjs` provides the same dispatch for skills-only packages
and direct local diagnostics.

## Platform records

### macOS

The Keychain service is `net.barnlabs.keepkeys`. The friendly name is the
account attribute. A versioned JSON payload in `kSecAttrGeneric` stores the
variable and description. The value is the same non-synchronizing,
`WhenUnlockedThisDeviceOnly` generic-password item. Metadata listing requests
attributes only and does not request value data.

The POSIX launcher pins the Swift source SHA-256, compiles it with Apple
Command Line Tools into a current-user-owned, non-symlink cache, and rebuilds
when the source or build recipe changes.

### Windows

Each friendly name owns two generic Credential Manager records:

```text
net.barnlabs.keepkeys/meta/<name>    variable + description; empty blob
net.barnlabs.keepkeys/secret/<name>  protected value; no user metadata
```

Listing and pre-approval lookup enumerate only `meta/*`. The `secret/*` record
is read after one-time approval. Replacement snapshots the old pair, writes
the new secret and metadata, and attempts a full rollback if either write
fails. Removal deletes both records after one native confirmation.

The bundled PowerShell helper compiles its small P/Invoke and bounded-process
runner in memory with the system C# compiler. It does not write a helper
assembly, secret file, or generated script.

### Linux

KeepKeys requires a Secret Service provider in the signed-in desktop session,
such as GNOME Keyring or a compatible KWallet service. Each friendly name owns
two items:

```text
service=net.barnlabs.keepkeys.metadata  encoded variable + description
service=net.barnlabs.keepkeys.secret    protected value
```

`secret-tool search` is used only against the metadata service. Although the
command prints that item's payload, the payload contains only agent-visible
metadata; it never searches the protected-value service. After approval,
`secret-tool lookup` transfers the value item through an anonymous pipe into
the helper. Store transfers both payloads to `secret-tool store` through
standard input. No credential value is placed in argv, an environment variable,
a temporary file, or a terminal prompt.

KeepKeys fails closed when `secret-tool`, a D-Bus user session, a Secret Service
provider, Python Tk support, or a graphical session is absent.

## Command-use flow

1. The agent supplies the friendly name, plain-language purpose, absolute
   program path, argument array, and optional absolute working directory.
2. The native helper validates lengths and control characters, resolves the
   executable, rejects shells and environment-dump tools, and computes
   SHA-256.
3. Interpreters and common network-capable programs receive a higher-visibility
   risk label. A detected script entrypoint is fingerprinted separately.
4. The helper reads only validated metadata and opens the native one-time
   approval window.
5. After approval, it reads the protected value and rechecks metadata.
6. It recomputes the executable and optional entrypoint hashes.
7. It launches the program directly, with an empty child environment plus the
   one approved variable.
8. Concurrent bounded readers drain stdout and stderr. If either exceeds
   1 MiB, that entire stream is replaced with an omission marker.
9. Exact, Base64, hexadecimal, URL-encoded, and JSON-escaped representations of
   the value are redacted before JSON reaches the adapter.

Output redaction is defense in depth. An approved process and its descendants
receive the credential and can transform, persist, or transmit it.

## Build and verification

The repository exercises shared contracts on macOS, Windows, and Ubuntu for
Node.js 18 and 22. Native jobs compile and round-trip a temporary credential
through macOS Keychain, Windows Credential Manager, and a disposable Linux
Secret Service session. The temporary value is generated during the job and
removed before success.

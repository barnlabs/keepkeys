# Architecture

KeepKeys is a local secret-use broker for desktop coding agents. It has one
agent-facing contract, one optional private phone intake, and three native
security backends:

```text
Codex · Grok Build · Claude Code · Oh My Pi · Gemini CLI
                         │
                    MCP over stdio
                         │
Hermes ── Python bridge ─┤
                         ▼
             fixed cross-platform dispatcher
                 │                    │
        native Paste & Store    Tailscale Serve page
                 │              on 127.0.0.1 only
                 └─────────┬──────────┘
                    private pipe
                │          │          │
              macOS      Windows     Linux
                │          │          │
             Keychain   Credential   Secret
                        Manager       Service
```

## Stable agent contract

Every supported client loads the canonical definitions in
`plugins/keepkeys/mcp/tools.json`. The seven operations are:

- `keepkeys_store`
- `keepkeys_store_from_phone`
- `keepkeys_list`
- `keepkeys_remove`
- `keepkeys_run`
- `keepkeys_status`
- `keepkeys_doctor`

There is deliberately no `get`, `show`, `copy`, `reveal`, `export`, or generic
command tool. Store accepts a friendly name, an environment-variable name, a
description, provider, and one to three official HTTPS documentation URLs, but
no secret value. Phone store accepts the same metadata and returns a one-time
tailnet URL without accepting or returning the value. The helper emits one
bounded JSON result.

The Node MCP server and Hermes adapter validate the same limits and build the
same fixed argument vector. Neither constructs a shell command. The platform
dispatcher preserves only the minimum OS session variables required to reach
the native vault and desktop, then launches exactly one bundled backend:

| Platform | Backend | Secure storage | Human interface |
| --- | --- | --- | --- |
| macOS 13+ | compiled Swift | Security.framework Keychain | AppKit explicit paste and approval windows |
| Windows 10/11 | Windows PowerShell + compiled in-memory C# | Windows Credential Manager | WPF explicit paste and approval windows |
| desktop Linux | Python 3 | freedesktop Secret Service through `secret-tool` | native Tk explicit paste and approval windows |

`scripts/keepkeys-cli.mjs` provides the same dispatch for skills-only packages
and direct local diagnostics.

## Private phone intake

`keepkeys_store_from_phone` starts `scripts/keepkeys-portal.mjs` as a detached,
ten-minute session. The session:

1. concurrently confirms Tailscale 1.52 or newer is online with a tailnet DNS
   name and reads only native-vault metadata to determine whether the name
   exists, canceling and awaiting both operations if either fails;
2. binds an HTTP server to an ephemeral `127.0.0.1` port;
3. runs Tailscale Serve in the foreground at an unguessable
   `/keepkeys/store/...` path;
4. sends the tailnet HTTPS URL and expiry to its launcher, receives the
   launcher's acknowledgment, rechecks Serve, and sends a child-side
   confirmation before the launcher can return the URL;
5. binds the first browser GET to one Tailscale identity and a Secure,
   HttpOnly, SameSite=Strict cookie that a second browser cannot reacquire;
6. atomically claims the first authenticated same-origin POST of 8-2048 UTF-8
   bytes and makes that submission attempt terminal;
7. holds the same per-name cross-process lock used by native paste-and-store
   and removal, then sends a capability frame and those bytes through
   redirected stdin to the selected native helper;
8. requires that helper to verify its direct parent is Node executing the exact
   bundled `keepkeys-portal.mjs`;
9. after a successful native write, stops the owned Serve process and queries
   Tailscale until the exact route is absent before the browser receives its
   success response;
10. watches the foreground Serve process after readiness, including the
    launcher-acknowledgment window, and closes the portal if Serve exits
    unexpectedly;
11. closes every localhost connection and aborts any in-flight helper during
    terminal or expiry cleanup.

The browser page has no external scripts, styles, images, analytics, or
network destinations. Its form starts disabled, and the password input has no
HTML `name`, so missing or blocked JavaScript cannot serialize the key into a
URL or form body. The nonce-authorized script enables the controls and sends
only the explicit same-origin text POST. `scripts/keepkeys-store.mjs` routes
native paste-and-store and removal through the same per-name lock used by
phone intake. The native helpers reject public store or removal dispatch that
bypasses that coordinator. The lock spans replacement checks, destructive
confirmation, and the selected write or deletion, so removal cannot interleave
with a store and desktop and phone stores cannot silently overwrite a name
whose displayed replacement state has changed. The session never runs
Tailscale Funnel and never changes unrelated Serve configuration. After Serve
reports readiness, KeepKeys drains
but no longer retains its later process output. If the key is stored but Serve
cleanup fails, the response distinguishes that state from a failed vault write
and the portal exits with a cleanup failure. If closing or removing the
per-name lock fails after the native write, the response retains `stored: true`
and reports the lock cleanup error so the user is not prompted to store the
same value again. If the Linux helper cannot confirm rollback after a failed
write, its JSON response carries `storageState: "uncertain"` and
`cleanupKind: "native-rollback"`. The portal preserves that cleanup error
through teardown and tells the phone to inspect the connected host before
retrying. Windows uses the same structured uncertainty when paired-record
rollback fails. If commit-lock cleanup fails at the same time, the portal
retains the uncertain vault state and reports both cleanup problems. An
unconfirmed native-helper termination remains attached to teardown even after
the commit promise settles. A helper exit, malformed JSON, or incomplete or
inconsistent error or success receipt is also uncertain; the phone never
reports that value as discarded. Metadata and Tailscale startup helpers run in
their own process groups. Cancellation verifies the group is gone even if its
leader exited first; Windows process-tree cleanup must succeed or startup
reports a cleanup failure.

## Platform records

### macOS

The Keychain service is `net.barnlabs.keepkeys`. The friendly name is the
account attribute. A versioned JSON payload in `kSecAttrGeneric` stores the
variable, description, provider, and documentation URLs. Version-1 records
remain readable; new stores write version 2. The value is the same
non-synchronizing,
`WhenUnlockedThisDeviceOnly` generic-password item. Metadata listing requests
attributes only and does not request value data.

The POSIX launcher pins the Swift source SHA-256, compiles it with Apple
Command Line Tools into a current-user-owned, non-symlink cache, and rebuilds
when the source or build recipe changes.

### Windows

Each friendly name owns two generic Credential Manager records:

```text
net.barnlabs.keepkeys/meta/<name>    variable + description + provider/docs JSON
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
service=net.barnlabs.keepkeys.metadata  encoded variable + description + provider/docs
service=net.barnlabs.keepkeys.secret    protected value
```

`secret-tool search` is used only against the metadata service. Although the
command prints that item's payload, the payload contains only agent-visible
metadata; it never searches the protected-value service. After approval,
`secret-tool lookup` transfers the value item through an anonymous pipe into
the helper. Store transfers both payloads to `secret-tool store` through
standard input. No credential value is placed in argv, an environment variable,
a temporary file, or a terminal prompt. Replacement snapshots the old pair and
rolls it back when either write raises a KeepKeys error, operating-system error,
timeout, or other subprocess failure.

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
removed before success. Each native job also sends fresh UTF-8 values through
the portal's real capability frame and redirected-input path, verifies metadata,
proves a normal round trip, rejects create-to-replace and replace-to-create
stale states through the real native write path, and proves record cleanup.
The Linux job also requires successful deletion of both generated items;
Secret Service errors cannot be counted as absence.
Headless tests cover phone-page escaping, identity binding, origin and cookie
checks, size limits, one-use behavior, private dispatch, advertised-expiry
scheduling, and confirmed process-tree teardown. A release candidate receives a
same-tailnet synthetic-value smoke test on a supported host.

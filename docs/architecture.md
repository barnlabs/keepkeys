# Architecture

KeepKeys is one native secrets core with thin client adapters:

```text
Codex / Claude Code / Oh My Pi / Gemini CLI
  │  MCP over stdio
  ├───────────────┐
  │               │
  │         Hermes plugin
  │               │  Python bridge
  └───────┬───────┘
          │  shared schemas + fixed argv, no shell
          ▼
Native helper (Swift/AppKit/Security.framework)
  ├─ secure entry / approval UI
  ├─ macOS Keychain
  └─ one direct child process
```

## Adapter layer

Codex, Claude Code, OMP, and Gemini manifests start
`plugins/keep-keys/mcp/server.mjs`. The MCP server loads the canonical tool
definitions from `mcp/tools.json`. Each client receives the same six schemas and
the same bundled behavioral skill.

Hermes installs the repository root as a plugin. Its Python bridge loads the same
`tools.json`, translates `inputSchema` to Hermes’ `parameters` field, and maps
validated arguments directly to the same launcher. It does not read Keychain,
show UI, handle secret values, invoke a shell, or reimplement redaction.

Every adapter exposes only:

- `keepkeys_store`
- `keepkeys_list`
- `keepkeys_remove`
- `keepkeys_run`
- `keepkeys_status`
- `keepkeys_doctor`

No runtime adapter has a package dependency install or plaintext retrieval
route.

## Native layer

`plugins/keep-keys/scripts/keepkeys` first verifies `keepkeys.swift` against the SHA-256 digest pinned in the launcher, then compiles it into a private user cache on first use or when either the Swift source or launcher/build recipe changes. The Swift helper uses AppKit for local prompts, Security.framework for Keychain, CryptoKit for executable fingerprints, and Foundation `Process` for direct execution.

The plugin is macOS-only in 0.2. This is deliberate: a credential plugin should
not claim a platform until its native storage, prompts, build, and failure
behavior can be verified on that platform.

## Storage record

The Keychain service is `net.barnlabs.keepkeys`. The friendly name is the account attribute. One versioned metadata payload in `kSecAttrGeneric` stores:

```json
{
  "version": 1,
  "variable": "SERVICE_API_TOKEN",
  "description": "Publishes approved service releases"
}
```

The raw secret is the same Keychain item's protected value data. An add/update changes the metadata and value together, while listing reads attributes without retrieving value data. Friendly names remain visible Keychain metadata and are treated accordingly.

## Command flow

1. The agent sends friendly name, purpose, absolute program path, fixed arguments, and optional absolute working directory.
2. The helper canonicalizes the executable and directory, rejects control characters, rejects common shells/environment dumps, and hashes the executable.
3. The helper reads the Keychain record to display the stored variable name.
4. A native alert shows the exact request and requires **Allow once**.
5. The hash is rechecked.
6. A child process starts with an empty environment plus the stored variable.
7. Concurrent bounded readers drain stdout/stderr to avoid pipe deadlock.
8. Exact/common secret representations are redacted before one JSON result returns.

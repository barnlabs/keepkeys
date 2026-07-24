# Install KeepKeys

## Requirements

- macOS 13 or newer
- Node.js 18 or newer
- Apple Command Line Tools (`xcode-select --install` if
  `xcrun --find swiftc` fails)
- one supported agent client: Codex, Grok Build, Claude Code, Oh My Pi, Hermes,
  or Gemini CLI

KeepKeys 0.3 does not claim Windows, Linux, iPhone/iPad, browser-only, or remote
Keychain support.

## Codex

Install the reviewed immutable source:

```sh
codex plugin marketplace add barnlabs/keepkeys \
  --ref 243ffd36702d4961932538e55e7b01e95e372a84
codex plugin add keepkeys@barnlabs
```

Restart Codex or begin a new task, then ask:

> Check KeepKeys status.

## Grok Build

Grok accepts a plugin subdirectory pinned to an exact commit. Install the
reviewed source directly:

```sh
grok plugin install \
  'barnlabs/keepkeys@243ffd36702d4961932538e55e7b01e95e372a84#plugins/keepkeys' \
  --trust
grok plugin list
grok plugin details keepkeys
```

The internal slug is `keepkeys` because Grok requires lowercase identifiers.
The product and human-facing brand are **KeepKeys**. The repository also ships
`.grok-plugin/marketplace.json` for Grok marketplace discovery, but the direct
full-SHA install above is the recommended credential-sensitive route.

## Claude Code

```sh
claude plugin marketplace add \
  https://raw.githubusercontent.com/barnlabs/keepkeys/6fb515c5edb7065e90efb8ce653139544388da80/.claude-plugin/marketplace.json
claude plugin install keepkeys@barnlabs
```

Claude Code does not expose a raw-commit option for a Git marketplace checkout,
so this command adds the catalog as a direct file from reviewed catalog commit
`6fb515c5edb7065e90efb8ce653139544388da80`. That immutable catalog pins the
actual `plugins/keepkeys` source with a `git-subdir` entry and functional SHA
`243ffd36702d4961932538e55e7b01e95e372a84`. A changed `main` catalog cannot
alter either part of this installation. Verify with:

```sh
claude plugin validate .
claude plugin list
```

Start a new Claude Code session after installation.

## Oh My Pi

OMP reads the native `.omp-plugin/marketplace.json` catalog and uses the same
self-contained Claude-compatible plugin bundle. Its catalog entry pins the
plugin source to reviewed commit
`243ffd36702d4961932538e55e7b01e95e372a84`:

```sh
omp plugin marketplace add \
  https://raw.githubusercontent.com/barnlabs/keepkeys/6fb515c5edb7065e90efb8ce653139544388da80/.omp-plugin/marketplace.json
omp plugin install keepkeys@barnlabs
omp plugin list
```

Start a new OMP session. The plugin uses OMP’s documented
`${CLAUDE_PLUGIN_ROOT}` compatibility substitution for its bundled MCP server.

## Hermes

The repository root is a Hermes plugin. The Python adapter registers the same
six schemas and launches the same native helper without a shell.

```sh
git clone https://github.com/barnlabs/keepkeys.git keepkeys-0.3.0
git -C keepkeys-0.3.0 checkout --detach \
  243ffd36702d4961932538e55e7b01e95e372a84
hermes plugins install "file://$(cd keepkeys-0.3.0 && pwd)" --enable
hermes plugins list
```

Hermes’ one-line `owner/repo` installer follows the repository’s mutable default
branch, so KeepKeys does not recommend that route for credentials. The detached
checkout above makes the installed source auditable and immutable. Hermes
plugins are opt-in. If you installed without `--enable`, run:

```sh
hermes plugins enable keepkeys
```

Restart Hermes after enabling it. The bundled skill appears as
`keepkeys:keepkeys`.

## Gemini CLI

```sh
gemini extensions install https://github.com/barnlabs/keepkeys \
  --ref 243ffd36702d4961932538e55e7b01e95e372a84
gemini extensions list
```

Gemini loads the repository-root `gemini-extension.json`, the bundled MCP
server, and the standard Agent Skill under `skills/keepkeys/`.

## First use

On the first tool call, `plugins/keepkeys/scripts/keepkeys` verifies the bundled
Swift source and compiles it into:

```text
~/Library/Caches/net.barnlabs.keepkeys/keepkeys-helper
```

The cache directory is required to be current-user-owned, mode `0700`, and not a
symbolic link. It contains code and a build digest, never secret values.
Credentials stay in macOS Keychain.

Ask your client:

> Store a new secret with KeepKeys.

The agent supplies the friendly name, environment-variable name, and one-line
description. **You type only the key** into the native secure field. Never paste
it into the conversation.

## Verify a clone

```sh
git clone https://github.com/barnlabs/keepkeys.git
cd keepkeys
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
```

`doctor` creates a random temporary Keychain credential, reads it back, verifies
it, and deletes it before returning. It never reads an existing KeepKeys item.

For a client-level smoke test, ask “Check KeepKeys status,” then store a
synthetic test value, confirm that it never appears in the conversation, and
remove the item.

## Local development

| Client | Development install |
| --- | --- |
| Codex | `codex plugin marketplace add "$(pwd)"` then `codex plugin add keepkeys@barnlabs` |
| Grok Build | `grok plugin validate "$PWD/plugins/keepkeys"` |
| Claude Code | `claude --plugin-dir "$PWD/plugins/keepkeys"` |
| OMP | `omp plugin link "$PWD/plugins/keepkeys"` |
| Gemini CLI | `gemini extensions link .` |
| Hermes | `HERMES_ENABLE_PROJECT_PLUGINS=true hermes` with a trusted project copy, or install the repository normally |

## Upgrade

Review the newer commit and changelog before changing a security-sensitive
installation. For clients that accept a Git ref, use the exact full commit SHA,
not a mutable branch.

Codex:

```sh
codex plugin marketplace remove barnlabs
codex plugin marketplace add barnlabs/keepkeys --ref NEW_REVIEWED_COMMIT_SHA
codex plugin add keepkeys@barnlabs
```

Grok can repeat the direct full-SHA install after review. Claude Code and OMP
require a newly reviewed raw catalog URL for every KeepKeys
release; updating only `main` does not change the installed plugin. Remove the
old BarnLabs marketplace, add the new full-SHA raw URL, and reinstall
`keepkeys@barnlabs`. Gemini can pin the new commit directly. Hermes should
repeat the detached-checkout install with the new reviewed SHA.

Client refresh commands:

```sh
grok plugin uninstall keepkeys
grok plugin install 'barnlabs/keepkeys@NEW_REVIEWED_COMMIT_SHA#plugins/keepkeys' --trust

claude plugin marketplace remove barnlabs
claude plugin marketplace add NEW_REVIEWED_RAW_CATALOG_URL
claude plugin install keepkeys@barnlabs
omp plugin marketplace remove barnlabs
omp plugin marketplace add NEW_REVIEWED_RAW_CATALOG_URL
omp plugin install keepkeys@barnlabs
hermes plugins update keepkeys
gemini extensions update keepkeys
```

The launcher recompiles when the Swift source or launcher/build recipe changes.
macOS Keychain may ask you to confirm access after a helper update because the
executable identity changed.

## Remove secrets and uninstall

Uninstalling an integration does not silently delete credentials. First ask
KeepKeys to list its metadata and remove each item you no longer want. Every
removal opens a native destructive-action confirmation and deletes the complete
named Keychain item through Security.framework.

Then uninstall the integration:

```sh
codex plugin remove keepkeys
codex plugin marketplace remove barnlabs

grok plugin uninstall keepkeys

claude plugin uninstall keepkeys@barnlabs
claude plugin marketplace remove barnlabs

omp plugin uninstall keepkeys@barnlabs
omp plugin marketplace remove barnlabs

hermes plugins remove keepkeys

gemini extensions uninstall keepkeys
```

To remove only the compiled cache, review this exact path and then remove it:

```sh
rm -rf "$HOME/Library/Caches/net.barnlabs.keepkeys"
```

The cache and Keychain records are separate. Security.framework deletion removes
the Keychain item from logical access; KeepKeys does not claim forensic
overwriting of storage managed internally by macOS.

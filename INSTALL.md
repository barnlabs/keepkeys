# Install KeepKeys

## Requirements

- macOS 13 or newer
- Node.js 18 or newer
- Apple Command Line Tools (`xcode-select --install` if
  `xcrun --find swiftc` fails)
- one supported agent client: Codex, Claude Code, Oh My Pi, Hermes, or Gemini
  CLI

KeepKeys 0.2 does not claim Windows, Linux, iPhone/iPad, browser-only, or remote
Keychain support.

## Codex

Install the reviewed immutable source:

```sh
codex plugin marketplace add barnlabs/keep-keys --ref REVIEWED_COMMIT_SHA
codex plugin add keep-keys@barnlabs
```

Restart Codex or begin a new task, then ask:

> Check KeepKeys status.

## Claude Code

```sh
claude plugin marketplace add barnlabs/keep-keys
claude plugin install keep-keys@barnlabs
```

For an immutable marketplace checkout, append the reviewed Git reference
supported by your Claude Code version when adding the marketplace. Verify with:

```sh
claude plugin validate .
claude plugin list
```

Start a new Claude Code session after installation.

## Oh My Pi

OMP reads the native `.omp-plugin/marketplace.json` catalog and uses the same
self-contained Claude-compatible plugin bundle:

```sh
omp plugin marketplace add barnlabs/keep-keys
omp plugin install keep-keys@barnlabs
omp plugin list
```

Start a new OMP session. The plugin uses OMP’s documented
`${CLAUDE_PLUGIN_ROOT}` compatibility substitution for its bundled MCP server.

## Hermes

The repository root is a Hermes plugin. The Python adapter registers the same
six schemas and launches the same native helper without a shell:

```sh
hermes plugins install barnlabs/keep-keys --enable
hermes plugins list
```

Hermes plugins are opt-in. If you installed without `--enable`, run:

```sh
hermes plugins enable keep-keys
```

Restart Hermes after enabling it. The bundled skill appears as
`keep-keys:keep-keys`.

## Gemini CLI

```sh
gemini extensions install https://github.com/barnlabs/keep-keys \
  --ref REVIEWED_COMMIT_SHA
gemini extensions list
```

Gemini loads the repository-root `gemini-extension.json`, the bundled MCP
server, and the standard Agent Skill under `skills/keep-keys/`.

## First use

On the first tool call, `plugins/keep-keys/scripts/keepkeys` verifies the bundled
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
git clone https://github.com/barnlabs/keep-keys.git
cd keep-keys
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
| Codex | `codex plugin marketplace add "$(pwd)"` then `codex plugin add keep-keys@barnlabs` |
| Claude Code | `claude plugin marketplace add "$(pwd)"` then `claude plugin install keep-keys@barnlabs` |
| OMP | `omp plugin marketplace add "$(pwd)"` then `omp plugin install keep-keys@barnlabs` |
| Gemini CLI | `gemini extensions link .` |
| Hermes | `HERMES_ENABLE_PROJECT_PLUGINS=true hermes` with a trusted project copy, or install the repository normally |

## Upgrade

Review the newer commit and changelog before changing a security-sensitive
installation. For clients that accept a Git ref, use the exact full commit SHA,
not a mutable branch.

Codex:

```sh
codex plugin marketplace remove barnlabs
codex plugin marketplace add barnlabs/keep-keys --ref NEW_REVIEWED_COMMIT_SHA
codex plugin add keep-keys@barnlabs
```

Other clients:

```sh
claude plugin marketplace update barnlabs
claude plugin update keep-keys@barnlabs
omp plugin marketplace update barnlabs
omp plugin upgrade keep-keys@barnlabs
hermes plugins update keep-keys
gemini extensions update keep-keys
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
codex plugin remove keep-keys
codex plugin marketplace remove barnlabs

claude plugin uninstall keep-keys@barnlabs
claude plugin marketplace remove barnlabs

omp plugin uninstall keep-keys@barnlabs
omp plugin marketplace remove barnlabs

hermes plugins remove keep-keys

gemini extensions uninstall keep-keys
```

To remove only the compiled cache, review this exact path and then remove it:

```sh
rm -rf "$HOME/Library/Caches/net.barnlabs.keepkeys"
```

The cache and Keychain records are separate. Security.framework deletion removes
the Keychain item from logical access; KeepKeys does not claim forensic
overwriting of storage managed internally by macOS.

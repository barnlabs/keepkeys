# Install KeepKeys

## Requirements

- macOS 13 or newer
- Codex CLI or the Codex desktop app
- Node.js 18 or newer
- Apple Command Line Tools (`xcode-select --install` if `xcrun --find swiftc` fails)

KeepKeys 0.1 does not claim Windows, Linux, iPhone/iPad, or ChatGPT web support.

## Install from the BarnLabs marketplace

```sh
codex plugin marketplace add barnlabs/keep-keys --ref a6055594caa58261cbde00a168e090f96e89f960
codex plugin add keep-keys@barnlabs
```

This full commit SHA is the reviewed KeepKeys 0.1.0 source. It is deliberately immutable; the security-sensitive install path does not follow `main`.

Restart the desktop app or start a new Codex task so the plugin and its MCP server load from the installed cache.

On first use, `plugins/keep-keys/scripts/keepkeys` compiles the reviewed Swift source into:

```text
~/Library/Caches/net.barnlabs.keepkeys/keepkeys-helper
```

The cache directory is required to be owned by the current user, is set to mode `0700`, must not be a symbolic link, and contains no secret values. Keychain holds the credentials.

## Verify

From a clone:

```sh
./scripts/check
./scripts/test
./scripts/doctor
```

`doctor` creates a random temporary Keychain credential, reads it back, verifies it, and deletes it before returning. It never reads an existing KeepKeys item.

In Codex, ask “Check KeepKeys status,” then “Store a test secret with KeepKeys.” Use a synthetic value, confirm that the value never appears in the task, and remove the test item when finished.

## Local plugin development

```sh
git clone https://github.com/barnlabs/keep-keys.git
cd keep-keys
codex plugin marketplace add "$(pwd)"
codex plugin add keep-keys@barnlabs
```

After changing the plugin, refresh the marketplace/install and start a new task:

```sh
codex plugin marketplace upgrade barnlabs
codex plugin add keep-keys@barnlabs
```

## Upgrade

Choose and review the exact newer KeepKeys commit first. Then replace `NEW_REVIEWED_COMMIT_SHA` below; do not substitute a mutable branch:

```sh
codex plugin marketplace remove barnlabs
codex plugin marketplace add barnlabs/keep-keys --ref NEW_REVIEWED_COMMIT_SHA
codex plugin add keep-keys@barnlabs
```

The launcher first checks the reviewed Swift source against its pinned SHA-256 digest, then recompiles the native helper when the source or launcher/build recipe changes. macOS Keychain may ask you to confirm access after a helper update because the executable identity changed.

## Uninstall

```sh
codex plugin remove keep-keys
codex plugin marketplace remove barnlabs
```

Removing the plugin does not silently delete credentials. Before uninstalling, ask KeepKeys to list and remove any items you no longer want. To remove only the compiled cache:

```sh
rm -rf "$HOME/Library/Caches/net.barnlabs.keepkeys"
```

Review that exact path before running the command. Keychain items are separate from the cache.

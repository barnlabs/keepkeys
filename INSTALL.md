# Install KeepKeys

KeepKeys supports macOS, Windows, and desktop Linux. Every client integration
uses the same tool schema and platform dispatcher.

## Platform prerequisites

### macOS

- macOS 13 or newer on Apple silicon or Intel
- Node.js 18 or newer
- Apple Command Line Tools

```sh
xcode-select --install
```

The Swift helper compiles on first use into
`~/Library/Caches/net.barnlabs.keepkeys`. Secret values stay in macOS Keychain.

### Windows

- Windows 10 or 11 on x64
- Node.js 18 or newer
- Windows PowerShell 5.1 and .NET Framework 4.8

Supported Windows versions include PowerShell 5.1 and .NET Framework 4.8. The
helper uses WPF and Windows Credential Manager. Its C# vault/process bridge is
compiled in memory; KeepKeys writes no helper executable or secret file.

### desktop Linux

- Node.js 18 or newer
- Python 3
- Python Tk
- `secret-tool`
- a live D-Bus user session and compatible freedesktop Secret Service
- a graphical X11 or Wayland session for Store, Remove, and Run

Common packages:

```sh
# Debian / Ubuntu
sudo apt install libsecret-tools python3-tk

# Fedora
sudo dnf install libsecret python3-tkinter

# Arch Linux
sudo pacman -S libsecret tk
```

GNOME Keyring works directly. KDE needs a KWallet configuration that exposes
the freedesktop Secret Service interface. KeepKeys fails closed when it cannot
reach a secure vault or graphical prompt.

## Reviewed source pins

KeepKeys is security-sensitive, so the commands below avoid a mutable `main`
checkout:

```text
functional plugin commit
0e6453c4e57925a62edded30b43fbc85861e9497

Claude/OMP catalog commit
8b80475f636582abe8e758dbc449abdc6ddd3789
```

The catalog commit pins its plugin source to the functional commit. Review both
before installation.

## Codex

```sh
codex plugin marketplace add barnlabs/keepkeys \
  --ref 0e6453c4e57925a62edded30b43fbc85861e9497
codex plugin add keepkeys@barnlabs
```

Start a new Codex session, then ask:

> Check KeepKeys status.

The product name is **KeepKeys**. The lowercase `keepkeys` slug is required by
plugin hosts.

## Grok Build / Grok Code

```sh
grok plugin install \
  'barnlabs/keepkeys@0e6453c4e57925a62edded30b43fbc85861e9497#plugins/keepkeys' \
  --trust
grok plugin list
grok plugin details keepkeys
```

The repository also provides `.grok-plugin/marketplace.json` for discovery.
The exact-SHA subdirectory install is the credential-sensitive route.

## Claude Code

```sh
claude plugin marketplace add \
  https://raw.githubusercontent.com/barnlabs/keepkeys/8b80475f636582abe8e758dbc449abdc6ddd3789/.claude-plugin/marketplace.json
claude plugin install keepkeys@barnlabs
claude plugin list
```

Claude Code does not expose a raw commit option for a Git marketplace checkout.
The immutable raw catalog above pins `plugins/keepkeys` to functional commit
`0e6453c4e57925a62edded30b43fbc85861e9497`. Start a new Claude Code session.

## Oh My Pi

```sh
omp plugin marketplace add \
  https://raw.githubusercontent.com/barnlabs/keepkeys/8b80475f636582abe8e758dbc449abdc6ddd3789/.omp-plugin/marketplace.json
omp plugin install keepkeys@barnlabs
omp plugin list
```

KeepKeys uses OMP's documented Claude-plugin compatibility token for the
bundled MCP server. Start a new OMP session.

## Hermes

Hermes installs the repository root. Use a detached reviewed checkout:

```sh
git clone https://github.com/barnlabs/keepkeys.git keepkeys-0.4.0
git -C keepkeys-0.4.0 checkout --detach \
  0e6453c4e57925a62edded30b43fbc85861e9497
hermes plugins install "file://$(cd keepkeys-0.4.0 && pwd)" --enable
hermes plugins list
```

On Windows PowerShell:

```powershell
git clone https://github.com/barnlabs/keepkeys.git keepkeys-0.4.0
git -C keepkeys-0.4.0 checkout --detach 0e6453c4e57925a62edded30b43fbc85861e9497
$path = (Resolve-Path .\keepkeys-0.4.0).Path
hermes plugins install "file://$path" --enable
hermes plugins list
```

Hermes plugins are opt-in. If installed without `--enable`, run
`hermes plugins enable keepkeys`, then restart Hermes.

## Gemini CLI

```sh
gemini extensions install https://github.com/barnlabs/keepkeys \
  --ref 0e6453c4e57925a62edded30b43fbc85861e9497
gemini extensions list
```

Gemini loads the repository-root extension, bundled MCP server, and standard
Agent Skill.

## Agent Skills package

Compatible clients can load `skills/keepkeys/SKILL.md` from the reviewed
checkout. The skills-only distribution includes a cross-platform Node launcher
and all three native backends but intentionally omits MCP configuration.

When the six `keepkeys_*` tools are available, use them. The fallback launcher
is:

```sh
node plugins/keepkeys/scripts/keepkeys-cli.mjs status
```

It selects the same platform backend and verifies the Windows/Linux helper
source digest before launch.

## First use

Ask:

> Store a new secret with KeepKeys.

The agent supplies:

- a stable friendly name;
- the environment-variable name expected by the target program;
- a one-line description that will still make sense in a future task.

KeepKeys pre-fills those fields. **Type only the key** into the native password
field. Never paste it into the conversation.

For use, ask for a concrete direct command. The native approval surface shows:

- risk class;
- purpose;
- friendly name, variable, and description;
- canonical executable and SHA-256;
- detected script entrypoint and its SHA-256, when applicable;
- every argument;
- working directory;
- exact child-environment scope.

Choose **Allow once** only when the displayed program and action are intended.

## Verify a checkout

macOS or Linux:

```sh
git clone https://github.com/barnlabs/keepkeys.git
cd keepkeys
git checkout --detach 0e6453c4e57925a62edded30b43fbc85861e9497
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
```

Windows:

```powershell
git clone https://github.com/barnlabs/keepkeys.git
Set-Location keepkeys
git checkout --detach 0e6453c4e57925a62edded30b43fbc85861e9497
.\scripts\bootstrap.ps1
.\scripts\check.ps1
.\scripts\test.ps1
.\scripts\doctor.ps1
```

Doctor creates a generated temporary record, verifies create, metadata list,
update, read, and deletion through the current OS vault, and removes it. It
never reads an existing KeepKeys credential.

For a client-level smoke test:

1. Ask “Check KeepKeys status.”
2. Store a generated synthetic value.
3. Confirm that the value never appears in chat or tool arguments/results.
4. Run a harmless direct test program and inspect the one-time approval.
5. Remove the synthetic item through the native confirmation.

## Local development

| Client | Development install |
| --- | --- |
| Codex | `codex plugin marketplace add "$(pwd)"` then `codex plugin add keepkeys@barnlabs` |
| Grok Build | `grok plugin validate "$PWD/plugins/keepkeys"` |
| Claude Code | `claude --plugin-dir "$PWD/plugins/keepkeys"` |
| Oh My Pi | `omp plugin link "$PWD/plugins/keepkeys"` |
| Gemini CLI | `gemini extensions link .` |
| Hermes | `HERMES_ENABLE_PROJECT_PLUGINS=true hermes` in a trusted checkout, or install the repository |

PowerShell can pass `(Get-Location).Path` where a client needs an absolute local
path.

## Upgrade

Review the changelog, threat model, new functional commit, and new catalog
commit before changing a credential-sensitive installation. Do not substitute
`main` for `NEW_REVIEWED_COMMIT_SHA`.

Codex:

```sh
codex plugin marketplace remove barnlabs
codex plugin marketplace add barnlabs/keepkeys --ref NEW_REVIEWED_COMMIT_SHA
codex plugin add keepkeys@barnlabs
```

Grok Build:

```sh
grok plugin uninstall keepkeys
grok plugin install \
  'barnlabs/keepkeys@NEW_REVIEWED_COMMIT_SHA#plugins/keepkeys' --trust
```

Claude Code and Oh My Pi require the new immutable raw catalog URL:

```sh
claude plugin marketplace remove barnlabs
claude plugin marketplace add NEW_REVIEWED_RAW_CATALOG_URL
claude plugin install keepkeys@barnlabs

omp plugin marketplace remove barnlabs
omp plugin marketplace add NEW_REVIEWED_RAW_CATALOG_URL
omp plugin install keepkeys@barnlabs
```

Gemini can pin the new functional commit directly. Hermes should repeat the
detached-checkout install.

Stored credential formats are owned by the OS backend and are not deleted by an
integration upgrade.

## Remove secrets and uninstall

Uninstalling a client does not delete credentials. First ask KeepKeys to list
its metadata and remove each item you no longer want. Every removal opens a
native destructive-action confirmation.

Then remove integrations:

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

macOS alone has a compiled code cache. After reviewing this exact path:

```sh
rm -rf "$HOME/Library/Caches/net.barnlabs.keepkeys"
```

The cache contains code and a build digest, never values. Windows compiles its
small C# bridge in memory. Linux runs the reviewed Python source. Cache removal
and credential removal are separate.

Native APIs provide logical deletion. KeepKeys does not claim forensic
overwriting of storage managed internally by the operating system.

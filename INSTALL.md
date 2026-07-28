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

### optional phone intake with Tailscale

Phone intake works when ChatGPT mobile controls a connected Mac or Windows host
through [ChatGPT Remote](https://learn.chatgpt.com/docs/remote-connections), or
when another supported agent client runs on that host.

Install [Tailscale](https://tailscale.com/download) on the host and phone, sign
both into the same tailnet, and confirm the host has Tailscale 1.52 or newer:

```sh
tailscale version
tailscale status
```

Tailscale Serve needs MagicDNS and HTTPS enabled for the tailnet. Follow
[Tailscale's Serve setup](https://tailscale.com/docs/features/tailscale-serve)
if the first phone-intake request reports that either is missing. KeepKeys does
not install Tailscale, sign devices in, edit tailnet policy, or enable Funnel.

Keep port 443 free of another foreground Tailscale Serve listener while the
one-time page is active. KeepKeys refuses a listener conflict and does not
reset or replace another Serve configuration.

After installation, the phone flow is one request:

> Store this key from my phone with KeepKeys.

The agent asks only for missing non-secret metadata, then returns the private
link without opening it. Open the link on the phone, paste the key, and press
**Paste & Store**. No BarnLabs account or relay setup is required.

## Reviewed source pins

KeepKeys is security-sensitive, so the commands below avoid a mutable `main`
checkout:

```text
functional plugin commit
039f33d6da17173e7615f266c00b656367d64dba

Claude/OMP catalog commit
18698ac3374633cda82650115122e9179457ad40
```

The catalog commit pins its plugin source to the functional commit. Review both
before installation.

## Codex

```sh
codex plugin marketplace add barnlabs/keepkeys \
  --ref 039f33d6da17173e7615f266c00b656367d64dba
codex plugin add keepkeys@barnlabs
```

Start a new Codex session, then ask:

> Check KeepKeys status.

The product name is **KeepKeys**. The lowercase `keepkeys` slug is required by
plugin hosts.

## Grok Build / Grok Code

```sh
grok plugin install \
  'barnlabs/keepkeys@039f33d6da17173e7615f266c00b656367d64dba#plugins/keepkeys' \
  --trust
grok plugin list
grok plugin details keepkeys
```

The repository also provides `.grok-plugin/marketplace.json` for discovery.
The exact-SHA subdirectory install is the credential-sensitive route.

## Claude Code

```sh
claude plugin marketplace add \
  https://raw.githubusercontent.com/barnlabs/keepkeys/18698ac3374633cda82650115122e9179457ad40/.claude-plugin/marketplace.json
claude plugin install keepkeys@barnlabs
claude plugin list
```

Claude Code does not expose a raw commit option for a Git marketplace checkout.
The immutable raw catalog above pins `plugins/keepkeys` to functional commit
`039f33d6da17173e7615f266c00b656367d64dba`. Start a new Claude Code session.

## Oh My Pi

```sh
omp plugin marketplace add \
  https://raw.githubusercontent.com/barnlabs/keepkeys/18698ac3374633cda82650115122e9179457ad40/.omp-plugin/marketplace.json
omp plugin install keepkeys@barnlabs
omp plugin list
```

KeepKeys uses OMP's documented Claude-plugin compatibility token for the
bundled MCP server. Start a new OMP session.

## Hermes

Hermes installs the repository root. Use a detached reviewed checkout:

```sh
git clone https://github.com/barnlabs/keepkeys.git keepkeys-0.5.0
git -C keepkeys-0.5.0 checkout --detach \
  039f33d6da17173e7615f266c00b656367d64dba
hermes plugins install "file://$(cd keepkeys-0.5.0 && pwd)" --enable
hermes plugins list
```

On Windows PowerShell:

```powershell
git clone https://github.com/barnlabs/keepkeys.git keepkeys-0.5.0
git -C keepkeys-0.5.0 checkout --detach 039f33d6da17173e7615f266c00b656367d64dba
$path = (Resolve-Path .\keepkeys-0.5.0).Path
hermes plugins install "file://$path" --enable
hermes plugins list
```

Hermes plugins are opt-in. If installed without `--enable`, run
`hermes plugins enable keepkeys`, then restart Hermes.

## Gemini CLI

```sh
gemini extensions install https://github.com/barnlabs/keepkeys \
  --ref 039f33d6da17173e7615f266c00b656367d64dba
gemini extensions list
```

Gemini loads the repository-root extension, bundled MCP server, and standard
Agent Skill.

## Agent Skills package

Compatible clients can load `skills/keepkeys/SKILL.md` from the reviewed
checkout. The skills-only distribution includes a cross-platform Node launcher
and all three native backends but intentionally omits MCP configuration.

When the seven `keepkeys_*` tools are available, use them. The fallback launcher
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
- a one-line description that will still make sense in a future task;
- the credential provider;
- one to three researched official HTTPS documentation links, preferring
  AI-readable references when the provider publishes them.

KeepKeys validates and displays those fields read-only. Copy the credential
from its provider, then press **Paste & Store**. The native helper reads the
clipboard only after that click, clears the current clipboard immediately, and
stores the value directly in the OS vault. Same-user software or clipboard
history may still observe a shared clipboard value, so copy only when the
window is ready and click immediately. Never paste it into the conversation.

From a phone, ask:

> Store a new secret from my phone with KeepKeys.

The agent prepares the same metadata and calls
`keepkeys_store_from_phone`. KeepKeys returns a one-time Tailscale HTTPS link
that expires after ten minutes. Open it on a phone in the same tailnet, review
the metadata and any replacement warning, paste the key, and press
**Paste & Store**. The page sends the value to the host's native vault and
closes its local listener. KeepKeys never uses Tailscale Funnel or a BarnLabs
server.

KeepKeys cannot clear the phone's clipboard or clipboard history. Copy the key
only after the page is ready, submit it immediately, and close the page after
it reports success.

For use, ask for a concrete direct command. The native approval surface shows:

- risk class;
- purpose;
- friendly name, variable, description, provider, and documentation links;
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
git checkout --detach 039f33d6da17173e7615f266c00b656367d64dba
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
```

Windows:

```powershell
git clone https://github.com/barnlabs/keepkeys.git
Set-Location keepkeys
git checkout --detach 039f33d6da17173e7615f266c00b656367d64dba
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

From a reviewed checkout, discover the current stable immutable commits without
installing anything:

```sh
./scripts/check-update
```

On Windows use `.\scripts\check-update.ps1`. The checker is explicit-only and
read-only; details and rollback steps are in [docs/updating.md](docs/updating.md).

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

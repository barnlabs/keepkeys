# Compatibility

KeepKeys 0.7.0 uses the same nine-tool contract on macOS, Windows, and desktop Linux.
Node.js 18 or newer is required by the MCP server and cross-platform launcher.

Version 0.7.0 establishes fresh Neorome vault, cache, lock, and mutex
namespaces. It does not read, export, or automatically migrate records from a
prior namespace. Store a record again through the native **Paste & Store**
surface before using it with 0.7.0.

| Platform | Supported baseline | Native requirements | CI proof |
| --- | --- | --- | --- |
| macOS | macOS 13+, Apple silicon or Intel | Apple Command Line Tools | macOS 14, Node 18/22, Swift build, Keychain doctor |
| Windows | Windows 10 or 11, x64 | Windows PowerShell 5.1 and .NET Framework 4.8 (included with supported Windows) | Windows Server 2025, Node 18/22, C# helper self-test, Credential Manager doctor |
| Linux | modern x86-64 or arm64 desktop | Python 3, Tk, `secret-tool`, D-Bus user session, compatible Secret Service | Ubuntu 24.04, Node 18/22, helper self-test, disposable GNOME Keyring doctor |

The Linux implementation is desktop software. Store, rotate, revoke, remove, and Run require a
graphical user session because KeepKeys never falls back to terminal password
entry or silent approval. `status`, `list`, and `doctor` can run without a
display when a usable D-Bus Secret Service session exists.

Phone intake is optional on all three platforms. It requires:

- Tailscale 1.52 or newer on the host;
- Tailscale on the phone, signed into the same tailnet;
- MagicDNS and HTTPS enabled for the tailnet;
- permission for the phone's Tailscale identity to reach the host;
- port 443 free of another foreground Tailscale Serve listener on that host.

Phone intake does not need a host display for the store action itself. Later
command use and removal still require the native graphical approval surface.
KeepKeys does not install Tailscale, sign a device in, edit tailnet policy, or
enable Funnel.

Common Linux packages:

| Distribution | Packages |
| --- | --- |
| Debian / Ubuntu | `libsecret-tools python3-tk` |
| Fedora | `libsecret python3-tkinter` |
| Arch Linux | `libsecret tk` |

GNOME Keyring implements Secret Service directly. KDE users need a KWallet
configuration that exposes the freedesktop Secret Service interface. A locked
vault may show its own desktop unlock prompt.

## Client surfaces

The bundled Codex, Grok Build, Claude Code, Oh My Pi, Gemini CLI, Hermes, and
Agent Skills adapters share the same schemas and helper dispatch. Individual
client plugin installers may have their own OS restrictions; KeepKeys' local
runtime itself is cross-platform.

ChatGPT mobile can use phone intake while controlling a connected Mac or
Windows host through ChatGPT Remote. The plugin and vault still run on that
host. A cloud-only chat without a connected local host cannot reach a native
vault and must fail closed.

Compatibility here means contract and package validation plus the stated
native-runtime CI. Optional client CLIs that are not installed or authenticated
are not silently added to a maintainer's system; disposable end-to-end host
smokes remain separately tracked in [CHECKLIST.md](../CHECKLIST.md).

## Fail-closed behavior

KeepKeys reports a setup error and performs no credential mutation when:

- the current OS is not macOS, Windows, or Linux;
- the required native vault is unavailable;
- a graphical secret-entry or approval surface cannot open;
- a helper source integrity check fails;
- a program path is relative, missing, a directory, or a blocked shell;
- metadata or a protected value changes after approval;
- an executable or detected script entrypoint changes after review;
- output exceeds a configured adapter or stream bound.
- Tailscale is absent, offline, too old, lacks tailnet HTTPS, reports no
  identity, or cannot create and remove the one-time private route.

No unsupported configuration falls back to plaintext files, plugin settings,
terminal input, cloud storage, or a process-wide persistent environment.

The device boundary is deliberate: phone intake is a one-use tailnet transfer
into the connected host's vault, not background vault synchronization across
devices. Automatic approvals are local metadata rules and are cleared by a
successful rotation or explicit revoke.

<p align="center">
  <img src="plugins/keepkeys/assets/social-preview.png" width="100%" alt="KeepKeys — the BarnLabs Keykeeper holding a ring of keys beside the words Use secrets. Never reveal them." />
</p>

<p align="center">
  <strong>You paste once. Your key stays out of chat and tool payloads.</strong>
</p>

<p align="center">
  <a href="https://github.com/barnlabs/keepkeys/actions/workflows/ci.yml"><img alt="macOS, Windows, and Linux CI" src="https://github.com/barnlabs/keepkeys/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="Apache-2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-41544C.svg" /></a>
  <a href="SECURITY.md"><img alt="Security policy" src="https://img.shields.io/badge/security-policy-D96C4D.svg" /></a>
  <img alt="macOS 13+" src="https://img.shields.io/badge/macOS-13%2B-1F2D27.svg" />
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-1F2D27.svg" />
  <img alt="desktop Linux" src="https://img.shields.io/badge/Linux-desktop-1F2D27.svg" />
  <img alt="KeepKeys 0.4.2 release candidate" src="https://img.shields.io/badge/version-0.4.2--candidate-D96C4D.svg" />
</p>

> **Release candidate:** the 0.4.2 source and installation pins on this branch
> remain candidates until the public macOS/Windows/Linux matrix, Release gate,
> and independent review are recorded in [CHECKLIST.md](CHECKLIST.md).

KeepKeys is the open-source, local secret-use broker for coding agents. It
opens a native paste-and-store window, stores the value in the operating system's
credential vault, and gives the agent one narrow capability: run a specific
command with one named secret after you review the exact request.

There is no `get`, `show`, `copy`, reveal, or export tool. Friendly names,
environment-variable names, descriptions, providers, and official
documentation links remain reusable for future tasks; the plaintext value does
not.

## Why KeepKeys exists

An `.env` file gives every process that can read the file a reusable credential.
A general password-manager CLI commonly has a reveal path. A cloud agent vault
adds an account, network boundary, and service operator.

KeepKeys is deliberately narrower:

| Property | KeepKeys |
| --- | --- |
| At-rest storage | macOS Keychain, Windows Credential Manager, or Linux Secret Service |
| Secret entry | Explicit native **Paste & Store**, never chat or terminal |
| Agent API | Research and store metadata, list metadata, remove, and approval-gated Run |
| Plaintext retrieval | No tool or helper action |
| Authorization | One native **Allow once** decision per command |
| Process scope | Empty child environment plus one approved variable |
| Executable identity | Canonical path and SHA-256, rechecked after approval |
| Interpreter identity | Detected script entrypoint gets a second SHA-256 |
| Output | Concurrent 1 MiB bounds and common-representation redaction |
| Service model | Local, offline, no KeepKeys account, cloud, daemon, or telemetry |

The distinction is simple: KeepKeys provides approval-gated use without adding
a reveal operation to the agent protocol.

## Native on all three desktop platforms

| Operating system | Secure store | Native human gate |
| --- | --- | --- |
| **macOS 13+** | Security.framework Keychain; device-only and non-synchronizing | AppKit explicit clipboard paste, replacement, removal, and command approval |
| **Windows 10/11** | paired metadata/value records in Windows Credential Manager | branded WPF explicit clipboard paste, replacement, removal, and command approval |
| **desktop Linux** | paired metadata/value items in freedesktop Secret Service | branded Tk explicit clipboard paste, replacement, removal, and command approval |

Listing and the approval screen read only metadata. The protected value is
loaded after **Allow once**, metadata is checked again, and executable hashes
are rechecked immediately before launch.

Linux fails closed without a compatible Secret Service and graphical session.
It never falls back to a plaintext keyring, terminal password prompt, or file.

## One core contract, seven integrations

| Client | Package surface | Immutable install |
| --- | --- | --- |
| **Codex** | Codex plugin + BarnLabs marketplace | `codex plugin marketplace add barnlabs/keepkeys --ref 4b3109f7b846bd2d58cd9e32e1b4fbd084fd6e60`<br>`codex plugin add keepkeys@barnlabs` |
| **Grok Build / Grok Code** | native Grok plugin | `grok plugin install 'barnlabs/keepkeys@4b3109f7b846bd2d58cd9e32e1b4fbd084fd6e60#plugins/keepkeys' --trust` |
| **Claude Code** | Claude plugin + pinned catalog | see [Install](INSTALL.md#claude-code) |
| **Oh My Pi** | OMP/Claude-compatible pinned catalog | see [Install](INSTALL.md#oh-my-pi) |
| **Hermes** | repository-root Hermes plugin | see [Install](INSTALL.md#hermes) |
| **Gemini CLI** | Gemini extension + Agent Skill | `gemini extensions install https://github.com/barnlabs/keepkeys --ref 4b3109f7b846bd2d58cd9e32e1b4fbd084fd6e60` |
| **Agent Skills clients** | standard `skills/keepkeys/SKILL.md` | reviewed checkout or skills-only archive |

All integrations expose the same six tools and dispatch to the same
platform-native boundary:

- `keepkeys_store`
- `keepkeys_list`
- `keepkeys_remove`
- `keepkeys_run`
- `keepkeys_status`
- `keepkeys_doctor`

Claude Code and Oh My Pi use the immutable catalog at commit
`888b937e289f22b7d6b2ebd1d79f8a611886e1c6`; that catalog pins the functional
plugin source at `4b3109f7b846bd2d58cd9e32e1b4fbd084fd6e60`. See
[INSTALL.md](INSTALL.md) for copy-paste commands and platform prerequisites.

## What the user experiences

Store:

1. The agent gathers any missing non-secret context, researches official
   credential documentation, and chooses the name, environment variable,
   description, provider, and one to three official HTTPS documentation links.
2. KeepKeys validates that metadata before opening and displays it read-only.
3. The user copies the key from the provider and presses **Paste & Store**.
4. Only that click lets the native helper read the clipboard. It immediately
   clears the current clipboard, then the operating-system vault stores the
   value without returning it through the agent protocol.

Run:

1. The agent proposes an absolute executable, fixed argument list, purpose, and
   optional working directory.
2. KeepKeys displays the risk class, stored metadata, executable path, SHA-256,
   arguments, directory, environment scope, and detected script fingerprint.
3. The user chooses **Allow once** or **Cancel**.
4. Only after approval does KeepKeys load the value and run the direct child.

Remove always opens a native destructive-action confirmation and deletes the
complete named record. Uninstalling a client does not silently delete
credentials.

## The security promise—and its edge

KeepKeys does:

- keep plaintext out of model prompts, tool inputs/results, plugin metadata,
  argv, persistent environment, and plaintext files;
- read the system clipboard only after **Paste & Store** and clear its current
  contents immediately after capture;
- pin native helper sources and fail closed on integrity mismatch;
- block common shells, environment dumpers, and Windows dynamic script hosts;
- classify common network clients and interpreters visibly;
- compare metadata and executable identity again after approval;
- bound both output streams and omit a whole stream after overflow;
- run native-vault doctor tests with generated temporary values only.

KeepKeys does not:

- make an approved executable safe;
- confine a credential after delivery to that process or its descendants;
- detect arbitrary encryption, splitting, file writes, IPC, or network egress;
- prevent same-user software, a coding host with unrestricted local-command
  execution, or operating-system clipboard history from observing a value
  while it is on the shared clipboard;
- protect against malware, a compromised signed-in account, administrator/root,
  debuggers, keyloggers, or modified local plugin code;
- promise forensic erasure inside operating-system-managed storage;
- claim to be unbreakable.

Read the complete [threat model](docs/threat-model.md), [privacy and data
handling](docs/privacy-and-data-handling.md), and [security policy](SECURITY.md)
before using KeepKeys for high-impact credentials.

## Development and proof

macOS or Linux:

```sh
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
```

Windows:

```powershell
.\scripts\bootstrap.ps1
.\scripts\check.ps1
.\scripts\test.ps1
.\scripts\doctor.ps1
```

CI runs the shared contract on macOS, Windows, and Ubuntu with Node.js 18 and
22. Separate jobs perform generated-value round trips through macOS Keychain,
Windows Credential Manager, and a disposable GNOME Keyring session. GitHub
Actions are pinned to exact upstream commits.

The repository has no runtime package dependencies. macOS compiles the reviewed
Swift helper with Apple Command Line Tools; Windows uses built-in Windows
PowerShell/.NET; Linux uses Python's standard library plus the desktop's
Secret Service tools and Tk.

Check the stable channel only when you choose:

```sh
./scripts/check-update
```

The checker reports the stable version and immutable source/catalog commits. It
does not install code, touch the native vault, or run in the background. See
[Updating KeepKeys](docs/updating.md).

## Project documents

- [Install, verify, upgrade, and remove](INSTALL.md)
- [Product and interface design](DESIGN.md)
- [Production acceptance checklist](CHECKLIST.md)
- [Independent code review](CODE_REVIEW.md)
- [Architecture](docs/architecture.md)
- [Compatibility matrix](docs/compatibility.md)
- [Threat model](docs/threat-model.md)
- [Privacy and data handling](docs/privacy-and-data-handling.md)
- [Deliberate updates](docs/updating.md)
- [Release runbook](docs/releasing.md)
- [Security reporting](SECURITY.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)
- [Brand guidelines](plugins/keepkeys/assets/brand-guidelines.md)

## BarnLabs open source

KeepKeys is a BarnLabs open-source initiative, licensed under Apache-2.0. The
Keykeeper—an old steward carrying a real ring of keys—represents the product's
job: hold authority carefully, explain exactly where it is going, and hand over
only the one key needed for the approved task.

Security reports belong in a private GitHub Security Advisory. Product ideas
and reproducible bugs are welcome through the repository templates.

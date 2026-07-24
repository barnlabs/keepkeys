# KeepKeys

<p align="center">
  <img src="plugins/keep-keys/assets/wordmark.svg" width="440" alt="KeepKeys by BarnLabs" />
</p>

**KeepKeys is a Codex plugin for secrets you want your agent to use. That is all it is.**

The plugin opens a native secure-entry window, stores the value in macOS Keychain, and gives Codex a narrow tool for using that named secret in one command you review. The plaintext value is never returned by a KeepKeys tool and never belongs in the conversation.

## The boundary

KeepKeys does:

- let Codex pre-fill a friendly name, environment-variable name, and one-line description so the user only types the key in the native window;
- store the description, variable name, and value as one Keychain item;
- list friendly names, variable names, and descriptions without reading values into Codex;
- display the exact executable, arguments, purpose, working directory, variable name, and SHA-256 fingerprint before each use;
- clear the child environment, add the one approved variable, and invoke the executable directly without a shell;
- redact the exact secret plus common base64, hexadecimal, URL-encoded, and JSON-escaped forms from captured output.

KeepKeys does not:

- reveal or return plaintext secrets to Codex;
- provide a `get`, `show`, `copy`, or export tool;
- store `.env` files, shell-profile variables, cloud-vault copies, or chat attachments;
- make an approved target safe—the target and its descendants receive the secret;
- claim protection from a compromised macOS user session, administrator, malicious approved executable, debugger, or memory inspection.

## Install

KeepKeys 0.1 supports Codex on macOS 13 or newer. It needs Node.js 18+ and Apple Command Line Tools so the installed plugin can compile its small native helper locally.

```sh
codex plugin marketplace add barnlabs/keep-keys --ref main
codex plugin add keep-keys@barnlabs
```

Restart Codex or begin a new task after installation. Then ask:

> Store a new secret with KeepKeys.

The value goes only into the native prompt. Never paste it into the task.

See [INSTALL.md](INSTALL.md) for local-development, upgrade, uninstall, and verification commands.

## Use

Typical requests:

- “Store my deployment token as `cloudflare-production` using `CLOUDFLARE_API_TOKEN`; it deploys approved BarnLabs releases.”
- “List my KeepKeys names.”
- “Use `cloudflare-production` for this exact Wrangler command.”
- “Remove `cloudflare-production` from KeepKeys.”

`keepkeys_run` always opens a local approval window. A cancellation fails closed. Shells and environment-dump programs are rejected.

## Development

The repository has no application scaffold and no package dependencies. The plugin is the product.

```sh
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
```

- `check` validates repository shape, plugin metadata, Node syntax, shell syntax, and native compilation.
- `test` runs MCP contract tests plus native validation/redaction tests without opening a window or reading user credentials.
- `doctor` performs one temporary Keychain write/read/delete round trip using a generated synthetic value.

Read [the architecture](docs/architecture.md), [threat model](docs/threat-model.md), and [privacy/data-handling policy](docs/privacy-and-data-handling.md) before changing a security boundary.

## Distribution status

The repository contains a valid BarnLabs repo marketplace. Anyone can add it with the install commands above once the repository has been published.

OpenAI’s public plugin directory requires a separate portal submission, verified BarnLabs developer/business identity, review materials, exactly five positive and three negative test cases, and OpenAI approval. Draft portal materials and the current submission boundary are under [`submission/`](submission/). Repository publication does not itself imply OpenAI approval.

## License and security

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md); never include a real secret in an issue, log, screenshot, fixture, or report.

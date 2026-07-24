# Compatibility and proof

KeepKeys supports clients by packaging one native core through each client’s
documented extension surface. “Supported” means the repository contains a
loadable package shape, deterministic contract tests, and an installation path.
It does not mean every upstream directory has reviewed or listed KeepKeys.

## Client matrix

| Client | Package surface | Shared components | Verification gate |
| --- | --- | --- | --- |
| Codex | `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json` | MCP, skill, native helper | Codex manifest validation, installed-cache start, fresh-task `keepkeys_status` |
| Claude Code | full-SHA raw catalog and plugin manifest | MCP, skill, native helper | official marketplace/plugin validator plus catalog and source pins |
| Oh My Pi | full-SHA raw `.omp-plugin` catalog | Claude-compatible MCP, skill, native helper | catalog equivalence, source pin, and documented plugin-root substitution contract |
| Hermes | root `plugin.yaml` and `__init__.py` | shared JSON schemas, skill, native helper | Python registration/argument-vector tests; `hermes plugins list` when CLI is available |
| Gemini CLI | root `gemini-extension.json` | MCP, root Agent Skill, native helper | extension manifest/link validation with the installed Gemini CLI |
| Agent Skills clients | `skills/keep-keys/SKILL.md` | behavioral boundary; launcher fallback where supported | byte-identical skill copies and Agent Skills frontmatter checks |

The current machine’s checked client versions and runtime smoke evidence belong
in release notes or CI logs, not in this durable document.

## Platform

KeepKeys 0.2.0 supports macOS 13 or newer on Apple silicon and Intel Macs. The
native helper depends on AppKit, Security.framework, and CryptoKit. Node.js 18+
and Apple Command Line Tools are required.

Windows, Linux, iOS, browser-only clients, remote agents without local GUI
access, and shared/team vaults are not supported. A client may understand MCP or
Agent Skills and still be unsupported if it cannot launch the bundled local
helper and present macOS UI.

## Shared invariant

Every adapter must preserve all of these:

1. `keepkeys_store` accepts only friendly name, variable name, and description.
2. No adapter adds a plaintext `secret`, `value`, reveal, copy, or export field.
3. Commands are fixed argument vectors; no adapter composes or invokes a shell.
4. The native helper owns Keychain access, secure entry, confirmation, execution,
   deletion, and redaction.
5. An unavailable or malformed adapter fails closed instead of substituting
   `.env`, clipboard, chat, or shell-profile storage.

`./scripts/validate-adapters.mjs` checks version alignment, catalog equivalence,
paths, schemas, skill identity, and the absence of shell execution in the Hermes
bridge. `./scripts/test` adds behavior-level MCP and Hermes coverage.

## Directory listings

Official public catalogs have separate human and policy review. Repository
publication alone does not establish:

- OpenAI/Codex directory approval;
- Anthropic marketplace inclusion;
- OMP community promotion;
- Hermes community promotion; or
- Gemini CLI extension-gallery inclusion.

The repository is installable without those listings. BarnLabs will describe a
listing as “official” only after the owning platform confirms it.

## Source trust

Codex and Gemini CLI accept the reviewed functional commit directly. Claude Code
and OMP install an immutable raw catalog by its full commit SHA; that catalog
pins the plugin subdirectory to the reviewed functional SHA. Hermes’ native
installer follows a branch, so the supported KeepKeys route first checks out the
functional commit in detached mode and installs from that local Git checkout.
The convenient mutable `owner/repo` route is not the documented credential-use
path.

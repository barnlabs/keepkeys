# Host contract evidence

KeepKeys keeps host-specific packaging thin and routes every integration to the
same local MCP server, tool schemas, Agent Skill, and platform dispatcher. This
ledger records the primary-source contract reviewed for each advertised host.
It is evidence of package-shape compatibility, not a claim that every optional
host CLI was installed or authenticated.

Reviewed on 2026-07-24.

| Host | Primary contract | KeepKeys proof |
| --- | --- | --- |
| Codex | [Build plugins](https://developers.openai.com/plugins/build/plugins) documents `.codex-plugin/plugin.json`, skills, MCP servers, local marketplaces, install, share, and deliberate marketplace upgrades. | `plugins/keepkeys/.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, schema validation, MCP transcript, and packaged-plugin validation. |
| Grok Build / Grok Code | [Grok Plugin Marketplace](https://x.ai/news/grok-plugin-marketplace) describes plugins as installable packages that can bundle skills, tools, commands, and MCP servers. | `.grok-plugin/marketplace.json`, `plugins/keepkeys/.grok-plugin/plugin.json`, shared skill and MCP config, and structural validation. |
| Claude Code | [Discover and install prebuilt plugins through marketplaces](https://docs.anthropic.com/en/docs/claude-code/plugin-marketplaces) documents marketplace catalogs and plugin sources. | `.claude-plugin/marketplace.json`, the bundled Claude manifest/MCP config, exact functional-source SHA, and structural validation. |
| Oh My Pi | [OMP marketplace documentation at reviewed commit `15184332b8dbb58e8fb66e874fe1ed27134f880e`](https://github.com/can1357/oh-my-pi/blob/15184332b8dbb58e8fb66e874fe1ed27134f880e/docs/marketplace.md) documents `omp plugin marketplace add`, `omp plugin install`, `omp plugin list`, `.omp-plugin/marketplace.json`, `git-subdir` sources with `sha`, and Claude-compatible plugins. | `.omp-plugin/marketplace.json` mirrors the tested Claude catalog, pins the exact functional commit, and is checked against the documented commands and reviewed OMP source commit. |
| Hermes | [Hermes plugin guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/plugins.md) documents Python plugin registration of tools and skills. | `adapters/hermes/plugin.py` registers the canonical schemas and skill while rejecting undeclared arguments before helper launch; Python contract tests cover registration, argument vectors, and fail-closed errors. |
| Gemini CLI | [Extension reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) documents extension manifests, MCP servers, install refs, and deliberate updates. | `gemini-extension.json`, shared skill/MCP entrypoint, exact-ref installation guidance, and structural validation. |
| Agent Skills clients | [Agent Skills specification](https://agentskills.io/specification) defines a skill directory containing `SKILL.md` with required frontmatter and progressive instructions. | `skills/keepkeys/SKILL.md` is byte-identical to the bundled plugin skill and ships in a separately validated skills-only archive. |

## OMP contract snapshot

The OMP contract is intentionally pinned above because this repository relies
on compatibility rather than an OMP-specific runtime adapter. The reviewed
source documents this complete install sequence:

```sh
omp plugin marketplace add \
  REVIEWED_IMMUTABLE_RAW_CATALOG_URL
omp plugin install keepkeys@neorome
omp plugin list
```

The Neorome catalog lives at `.omp-plugin/marketplace.json`. Its
`source: "git-subdir"` entry includes the repository URL, plugin subdirectory,
and immutable functional-source `sha`. KeepKeys tests require the OMP catalog
to be structurally identical to the Claude catalog so the compatibility claim
cannot silently drift.

## Evidence boundary

The repository test suite proves manifest parsing, canonical schema and skill
equality, undeclared-field rejection, MCP protocol behavior, deterministic
archive contents, and immutable pins without installing optional harnesses.
Authenticated, disposable end-to-end smoke tests remain a separately budgeted
check in [CHECKLIST.md](../CHECKLIST.md); the public documentation does not
present those tests as completed.

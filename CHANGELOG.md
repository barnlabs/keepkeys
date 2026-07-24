# Changelog

## 0.3.0 — 2026-07-24

- Standardized the product as **KeepKeys** with `keepkeys` as the lowercase
  internal slug required by plugin hosts.
- Added a native Grok Build plugin manifest, BarnLabs Grok marketplace catalog,
  exact-SHA install guidance, and local Grok validation.
- Replaced the generic lock branding with the original Keykeeper character: a
  capable old steward carrying a visible ring of keys.
- Refreshed the README hero, plugin icons, social preview, brand guidelines,
  client matrix, architecture, packaging, and GitHub search metadata.
- Preserved the same six tools, native Keychain core, no-plaintext boundary,
  direct execution path, and logical Keychain deletion behavior.

## 0.2.0 — 2026-07-24

- Expanded KeepKeys from a Codex-only package to native plugin/extension surfaces for Claude Code, Oh My Pi, Hermes, and Gemini CLI.
- Added a standard Agent Skill package for other compatible clients.
- Moved all tool schemas into one shared JSON contract used by both MCP and the thin Hermes bridge.
- Preserved the single Swift/AppKit/Keychain core for secure entry, approval, deletion, direct execution, and redaction.
- Added cross-client manifest, version, skill, and no-shell validation plus Hermes contract tests.
- Added a unified source archive and checksum for multi-client distribution.
- Rebuilt the public repository with a new hero, support matrix, compatibility proof, governance, maintainers, roadmap, release runbook, and repository-design rationale.

## 0.1.1 — 2026-07-24

- Fixed the plugin MCP launch directory so a newly started Codex task loads the six `keepkeys_*` tools from the installed plugin instead of requiring the skills-only fallback.

## 0.1.0 — 2026-07-24

- Added the BarnLabs KeepKeys Codex plugin and repository marketplace.
- Added native macOS secure entry, overwrite, removal, and per-command approval.
- Added device-local macOS Keychain storage with no plaintext retrieval tool.
- Added direct, empty-environment child execution with executable hashing and bounded output redaction.
- Added MCP tool annotations, plugin skill, headless tests, Keychain doctor, threat model, privacy policy, install guidance, and public-submission materials.

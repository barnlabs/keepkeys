# Roadmap

KeepKeys develops by proof, not by feature count.

## 0.4 — native desktop parity

- [x] one dispatcher and tool contract across macOS, Windows, and Linux
- [x] Windows Credential Manager storage and WPF secure-entry/approval UI
- [x] Linux Secret Service storage and native Tk secure-entry/approval UI
- [x] approval-before-value-read on all three platforms
- [x] executable risk labels and script-entrypoint fingerprints
- [x] OS-matrix contract tests and native-vault doctor jobs
- [x] cross-platform skills-only launcher and developer scripts

## 0.3 — KeepKeys identity and Grok Build

- [x] unified `keepkeys` install slug with **KeepKeys** display branding
- [x] native Grok Build plugin manifest and BarnLabs marketplace catalog
- [x] exact-SHA Grok installation and inventory validation
- [x] Keykeeper mascot, refreshed social preview, icon crops, and brand rules
- [x] GitHub repository and search metadata aligned to KeepKeys

## 0.2 — multi-agent foundation

- [x] Codex plugin and BarnLabs marketplace
- [x] Claude Code marketplace/plugin adapter
- [x] Oh My Pi marketplace adapter
- [x] Hermes repository plugin
- [x] Gemini CLI extension
- [x] standard Agent Skill distribution
- [x] one shared tool schema across MCP and Hermes
- [x] professional project, security, governance, and brand surface

## Next proof targets

- [ ] Complete each upstream public-directory submission that fits its policy
- [ ] Add repeatable isolated client smoke tests when upstream CLIs offer
      stable, non-authenticated validation commands
- [ ] Add signed release artifacts after a signing and revocation runbook exists
- [ ] Evaluate platform authentication and access-control hardening without
      degrading reliability or accessibility
- [ ] Add visual-regression fixtures for native windows where CI can capture
      real platform rendering without weakening secret-entry isolation

## Deliberate non-goals

- raw-secret retrieval, copy, reveal, or export;
- cloud synchronization or team vaults;
- automatic rotation or credential creation;
- silent background command use;
- a cloud-backed KeepKeys account or remote management application;
- platform badges without real packaging and runtime proof.

Roadmap items are intent, not commitments. Security fixes and client
compatibility take priority.

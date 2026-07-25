# Repository design

KeepKeys uses the conventions that make mature security and developer-tool
repositories easy to evaluate quickly:

- one visual product promise before implementation detail;
- a short install route for every supported client;
- an explicit boundary between supported behavior and non-goals;
- public security, contribution, governance, support, release, and roadmap
  documents;
- client manifests at the paths their upstream tools discover natively;
- deterministic local checks that mirror CI;
- no dependency install for the runtime plugin;
- no real credential fixtures, screenshots, logs, or demo keys.

## Reference review

The 0.4 repository pass reviewed current primary repositories, competitors, and
platform documentation:

- [1Password Shell Plugins](https://github.com/1Password/shell-plugins) for a
  focused security-tool promise, strong visual entry, action-oriented
  contribution path, and explicit product boundary;
- [Infisical](https://github.com/Infisical/infisical) for security-policy
  prominence, navigable capability sections, and open-source project framing;
- [Claude Code](https://github.com/anthropics/claude-code) for a concise
  terminal-product README and official documentation handoff;
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) for CI/release
  signaling and extension documentation;
- [Grok Build](https://github.com/xai-org/grok-build) and its official
  marketplace for native plugin layout, exact-SHA installation, and
  pre-install component inventory;
- [Microsoft Credential Manager
  APIs](https://learn.microsoft.com/windows/win32/api/wincred/) and the
  [freedesktop Secret Service
  specification](https://specifications.freedesktop.org/secret-service/latest-single/)
  for native Windows/Linux storage and failure semantics;
- current agent-focused secret brokers including Automic Vault, Cloak, Keyway,
  Infisical Agent Vault, Shroud, and Akasha to test whether KeepKeys' positioning
  is defensible;
- each client’s official plugin or extension specification for file placement
  and installation commands.

KeepKeys adopts the useful patterns, not the projects’ scale. A local secrets
plugin should remain understandable in one sitting. “Grand” here means polished,
auditable, and complete—not a large framework or a list of speculative
features. Its chosen wedge is the best local, human-controlled secret-use broker
for desktop coding agents: no cloud, no daemon, no reveal action, native
credential stores, executable identity, and the same human gate on all three
desktop operating systems.

## Information hierarchy

1. **README:** promise, supported clients, boundary, tools, architecture, proof.
2. **INSTALL:** exact client setup, immutable-source guidance, first use,
   upgrade, secret removal, uninstall.
3. **Security docs:** report channel, threat model, privacy/data handling,
   release gates.
4. **Project docs:** contribution, governance, roadmap, maintainers, support.
5. **Submission:** materials for directory review, clearly separated from
   repository availability.

[DESIGN.md](../DESIGN.md) owns product/visual decisions,
[CHECKLIST.md](../CHECKLIST.md) owns acceptance evidence and future proof
budgets, [CODE_REVIEW.md](../CODE_REVIEW.md) owns the independent verdict loop,
and [AGENTS.md](../AGENTS.md) keeps automated contributors inside the
credential boundary.

## Brand constraint

The visual system is deep pine, barn ember, warm paper, and aged brass. The
Keykeeper—a capable old man carrying a substantial ring of keys—is the primary
character. He makes stewardship and user-controlled access more distinctive
than a generic lock badge. Copy uses “use, never retrieve” and names limitations
near the promise. See the bundled
[brand guidelines](../plugins/keepkeys/assets/brand-guidelines.md).

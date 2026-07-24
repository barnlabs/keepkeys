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

The 0.2 repository pass reviewed current primary repositories and documentation:

- [1Password Shell Plugins](https://github.com/1Password/shell-plugins) for a
  focused security-tool promise, strong visual entry, action-oriented
  contribution path, and explicit product boundary;
- [Infisical](https://github.com/Infisical/infisical) for security-policy
  prominence, navigable capability sections, and open-source project framing;
- [Claude Code](https://github.com/anthropics/claude-code) for a concise
  terminal-product README and official documentation handoff;
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) for CI/release
  signaling and extension documentation;
- each client’s official plugin or extension specification for file placement
  and installation commands.

KeepKeys adopts the useful patterns, not the projects’ scale. A local secrets
plugin should remain understandable in one sitting. “Grand” here means polished,
auditable, and complete—not a large framework or a list of speculative
features.

## Information hierarchy

1. **README:** promise, supported clients, boundary, tools, architecture, proof.
2. **INSTALL:** exact client setup, immutable-source guidance, first use,
   upgrade, secret removal, uninstall.
3. **Security docs:** report channel, threat model, privacy/data handling,
   release gates.
4. **Project docs:** contribution, governance, roadmap, maintainers, support.
5. **Submission:** materials for directory review, clearly separated from
   repository availability.

## Brand constraint

The visual system is deep pine, barn ember, and warm paper. The keyhole shield
communicates guarded access without claiming perfect security. Copy uses “use,
never retrieve” and names limitations near the promise. See the bundled
[brand guidelines](../plugins/keep-keys/assets/brand-guidelines.md).

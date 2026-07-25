# KeepKeys production checklist

This file is the durable acceptance ledger and budget. It distinguishes the
production baseline from future improvements without pretending the product is
finished forever.

## How a checkmark is earned

Every task names:

- **Implementer context:** exact scope, source files, invariants, forbidden
  actions, rollback, and observable done condition.
- **Required tests:** positive, negative, regression, integration, cleanup, and
  public proof appropriate to the change.
- **Adversarial context:** a separate read-only reviewer receives the task
  contract, actual diff/artifacts, and evidence bar—but not the implementer’s
  intended conclusion.
- **Verdict:** `PASS`, `REWORK`, or `BLOCKED`, using
  [CODE_REVIEW.md](CODE_REVIEW.md).

The implementer cannot certify their own task. On `REWORK`, return the detailed
findings to the same implementer, repair only those failures, rerun regression
checks, and send the new diff to the same reviewer. Default to two repair
cycles. Check the box only after reviewer `PASS` and root integration proof.

## Production baseline — 0.4.1

- [ ] **Secret-use boundary is closed.**
  - Implementer context: shared schema, native store/list/remove/run paths,
    redaction, and no-retrieval invariant.
  - Required tests: schema rejection of value fields; native validation tests;
    synthetic scoped-child test; secret-pattern scan; threat-model diff.
  - Acceptance: no plaintext input/output path and no pre-approval protected
    read on any platform.
- [ ] **macOS, Windows, and Linux native backends are proven.**
  - Implementer context: AppKit/Keychain, WPF/Credential Manager, and
    Tk/Secret Service parity.
  - Required tests: headless helper suites plus generated add/list/update/read/
    delete/cleanup doctors on `macos-14`, `windows-2025`, and `ubuntu-24.04`.
  - Acceptance: every OS job green in one public CI run.
- [ ] **Seven host surfaces match their published contracts.**
  - Implementer context: Codex, Grok Build/Grok Code, Claude Code, Oh My Pi,
    Hermes, Gemini CLI, and Agent Skills, all delegating to the same core.
  - Required tests: manifest parsing, canonical tool-schema/skill equality,
    MCP initialize/tools-list/error transcript, archive inventory, immutable
    install pins, and primary-source compatibility review.
  - Acceptance: structural PASS for every host; runtime smoke testing is
    separately budgeted where a host must be installed or authenticated.
- [ ] **Install and deliberate update paths are safe and maintainable.**
  - Implementer context: immutable source commit `F`, catalog commit `C`,
    checksummed archives, stable `update.json`, and explicit user-run update
    check.
  - Required tests: update-manifest schema, semver comparisons, fixed HTTPS
    origin, response-size bound, package contents, checksums, stale-pin scan.
  - Acceptance: update discovery never auto-installs and always returns
    reviewable immutable commits.
- [ ] **GitHub and brand surfaces are production quality.**
  - Implementer context: Keykeeper assets, README, repository description and
    topics, issue/PR templates, security policy, design and governance docs.
  - Required tests: asset existence/dimensions, link scan, community-profile
    inventory, cross-platform language scan, public raw-file checks.
  - Acceptance: public repository is coherent, searchable, and honest about
    boundaries and limitations.
- [ ] **Independent adversarial release review passed.**
  - Implementer context: complete 0.4.1 diff and public evidence.
  - Required tests: dedicated read-only Codex review, project rules from
    `AGENTS.md`, regression suite, final public CI, and serious-finding
    disposition.
  - Acceptance: reviewer returns `PASS`; root reopens material evidence and
    records the CI run and immutable commits below.

### Release evidence

- Functional source commit (`F`): pending
- Catalog commit (`C`): pending
- Documentation/update commit: pending
- Public CI run: pending
- Independent reviewer verdict: pending
- Rollback: reinstall the prior reviewed functional commit; native-vault
  records are not removed by plugin rollback.

## Budgeted next proofs

- [ ] **Universal Codex/ChatGPT plugin-directory submission.**
  - Owner context: follow the current official submission workflow using the
    reviewed source package; do not invent listing claims or expose secrets.
  - Tests: directory validation, fresh install in a disposable conversation,
    tool/skill discovery, store with a synthetic value, approved run, removal,
    uninstall, and listing screenshot review.
  - Adversarial gate: independent listing/security review and policy PASS.
- [ ] **Authenticated disposable smoke tests for optional host CLIs.**
  - Owner context: only install a host a maintainer already uses or explicitly
    authorizes in a disposable profile; never alter the primary profile.
  - Tests: immutable install, fresh session, tool/skill discovery, synthetic
    use, uninstall, and cache cleanup.
  - Adversarial gate: host-specific contract and cleanup PASS.
- [ ] **Native visual-regression fixtures.**
  - Owner context: capture real platform windows without any credential value
    and without weakening secure-entry controls.
  - Tests: light/dark where native, scaling, keyboard/focus, long copy, error
    state, 375-equivalent compact width where supported, and artifact scan.
  - Adversarial gate: product-design and accessibility PASS.
- [ ] **Signed release artifacts and provenance.**
  - Owner context: design signing, key custody, rotation, revocation, and
    recovery before adding a signing dependency.
  - Tests: verification on all platforms, tamper failure, revoked-key path,
    reproducibility, and rollback.
  - Adversarial gate: independent supply-chain threat-model PASS.
- [ ] **External security assessment.**
  - Owner context: bounded source review and synthetic local testing only.
  - Tests: approval bypass, helper substitution, environment inheritance,
    command-line parsing, output transformation/exfiltration, vault cleanup,
    and update-channel tampering.
  - Adversarial gate: every confirmed high-severity finding fixed and retested;
    residual risk published.

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

## Release candidate — 0.5.0

- [x] **Private phone intake keeps plaintext outside the agent protocol.**
  - Implementer context: `keepkeys_store_from_phone`, temporary localhost
    portal, Tailscale Serve route, and private native standard-input commit
    action on macOS, Windows, and Linux.
  - Required tests: schema rejection of value fields; identity, cookie, origin,
    content type, content length, one-use, expiry, replacement-race, cleanup,
    and no-Funnel regressions; generated-value tailnet-to-vault smoke test.
  - Acceptance: the model receives only metadata and the one-time URL; no
    plaintext reaches tool input/output, argv, files, logs, persistent
    environment, the public internet, or a BarnLabs service.
- [x] **Phone setup and failure states are complete.**
  - Implementer context: ChatGPT Remote guidance, same-tailnet prerequisites,
    MagicDNS/HTTPS requirements, port conflict, unavailable Tailscale, and
    phone clipboard limitation.
  - Required tests: missing/offline/old Tailscale, absent DNS name, Serve
    startup failure, unauthorized identity, second browser, second submit,
    too-short/too-large value, expiry, interrupt, and native commit failure.
  - Acceptance: every failure closes the local listener and owned Serve route
    without changing unrelated Tailscale configuration.
- [x] **The 0.5.0 package and public copy match the seven-tool contract.**
  - Implementer context: manifests, MCP, Hermes, Agent Skill, skills-only
    package, README, install guide, listing, release notes, and eight submission
    cases.
  - Required tests: cross-adapter schema equality, archive inventory,
    checksums, documentation links, direct-copy review, and five positive plus
    three negative directory cases.
  - Acceptance: phone intake is described as a private route to the connected
    host, never as hosted storage, synchronization, or public mobile support.
- [x] **Independent adversarial 0.5.0 review and public matrix passed.**
  - Implementer context: exact diff, generated archives, local proof, public CI,
    immutable `F → C → docs` chain, and rollback.
  - Required tests: dedicated read-only Codex review, complete local regression
    suite, all-platform public CI, and serious-finding disposition.
  - Acceptance: reviewer returns `PASS`; root reopens the exact evidence and
    records it below.

### 0.5.0 release evidence

- Functional source commit (`F`):
  `af4d97691adf80dbcab2212f5fdfc091b2a97851`.
- Catalog commit (`C`):
  `e177f405482950de39abef0fa78559a2a6043074`.
- Reviewed documentation candidate:
  `aab8c8605f412df0aaf1f77386aad32d43334eeb`.
- Candidate public CI run:
  [30391619827](https://github.com/barnlabs/keepkeys/actions/runs/30391619827)
  passed all six Node jobs, all three native-vault jobs, reproducible packages,
  and `Release gate` on the exact `F → C → docs` candidate.
- Stable promotion commit and public promotion matrix: pending.
- Exact-head GitHub Codex review
  [4801015633](https://github.com/barnlabs/keepkeys/pull/4#pullrequestreview-4801015633)
  reopened the prior exact head for three repairs: cancel and await sibling
  startup operations after a partial failure, await Serve-process termination
  even when route verification fails, and stop retaining Serve output after
  readiness.
- Dedicated local proof: `check`, 42 Node tests, eight Hermes tests, 12 Linux
  unit tests, macOS doctor, package and archive checks, and repeated
  `./scripts/tailnet-smoke` runs passed. Each live smoke crossed authenticated
  Tailscale Serve HTTPS, bound one browser, submitted a fresh generated UTF-8
  value to macOS Keychain, verified the native round trip, and left
  `tailscale serve status --json` equal to `{}` with no portal, Serve process,
  or test record.
- Browser proof at 375 by 812 and 1280 by 720 CSS pixels found no horizontal
  overflow or console warnings/errors. JavaScript enabled the initially
  disabled fieldset, the password input had no HTML `name`, focus landed on
  the key field, and a generated submission reached the stored state.
- Independent read-only reviewer returned `PASS` on the focused three-finding
  repair after the new sibling-startup, route-failure, and output-listener
  regressions passed. The reviewer then reopened the exact public
  `F → C → docs` candidate and returned `PASS` again.
- Superseded exact chain: functional
  `039f33d6da17173e7615f266c00b656367d64dba`, catalog
  `18698ac3374633cda82650115122e9179457ad40`, documentation
  `6f749af83bb56e9d84bcb3764a4f613a476587a0`, promotion
  `fd0b503f3c0179bc68ac9885000f7727369a6dd7`, and final proof
  `b5e74deb7b33e6cdbd9f27602939d81d2e4e3a4c`. Public runs
  [30389726448](https://github.com/barnlabs/keepkeys/actions/runs/30389726448),
  [30389987843](https://github.com/barnlabs/keepkeys/actions/runs/30389987843),
  and [30390148371](https://github.com/barnlabs/keepkeys/actions/runs/30390148371)
  passed all 11 jobs, but exact-head review `4801015633` found the three gaps
  above, so that chain is not a release candidate. Review `4800622135` had
  previously reopened the older `c204e69a4396f46ef6f2961300ffdefeb894fa43`
  proof head for its own three P1 cleanup, no-script, and live-tailnet gaps.
- Stable update candidate: `update.json` advertises 0.5.0 with the exact `F`
  and `C` commits above.
- Rollback: reinstall the 0.4.2 functional commit
  `e5276925d390704fccdf4aaeba47280464762a1c`; plugin rollback does not remove
  native-vault records.

## Production baseline — 0.4.2

- [x] **Secret-use boundary is closed.**
  - Implementer context: shared schema, native store/list/remove/run paths,
    redaction, and no-retrieval invariant.
  - Required tests: schema rejection of value fields; native validation tests;
    synthetic scoped-child test; secret-pattern scan; threat-model diff.
  - Acceptance: no plaintext input/output path and no pre-approval protected
    read on any platform.
- [x] **macOS, Windows, and Linux native backends are proven.**
  - Implementer context: AppKit/Keychain, WPF/Credential Manager, and
    Tk/Secret Service parity.
  - Required tests: headless helper suites plus generated add/list/update/read/
    delete/cleanup doctors on `macos-14`, `windows-2025`, and `ubuntu-24.04`.
  - Acceptance: every OS job green in one public CI run.
- [x] **Seven host surfaces match their published contracts.**
  - Implementer context: Codex, Grok Build/Grok Code, Claude Code, Oh My Pi,
    Hermes, Gemini CLI, and Agent Skills, all delegating to the same core.
  - Required tests: manifest parsing, canonical tool-schema/skill equality,
    MCP initialize/tools-list/error transcript, archive inventory, immutable
    install pins, and primary-source compatibility review.
  - Acceptance: structural PASS for every host; runtime smoke testing is
    separately budgeted where a host must be installed or authenticated.
- [x] **Install and deliberate update paths are safe and maintainable.**
  - Implementer context: immutable source commit `F`, catalog commit `C`,
    checksummed archives, stable `update.json`, and explicit user-run update
    check.
  - Required tests: update-manifest schema, semver comparisons, fixed HTTPS
    origin, response-size bound, package contents, checksums, stale-pin scan.
  - Acceptance: update discovery never auto-installs and always returns
    reviewable immutable commits.
- [x] **GitHub and brand surfaces are production quality.**
  - Implementer context: Keykeeper assets, README, repository description and
    topics, issue/PR templates, security policy, design and governance docs.
  - Required tests: asset existence/dimensions, link scan, community-profile
    inventory, cross-platform language scan, public raw-file checks.
  - Acceptance: public repository is coherent, searchable, and honest about
    boundaries and limitations.
- [x] **Independent adversarial release review passed.**
  - Implementer context: complete 0.4.2 diff and public evidence.
  - Required tests: dedicated read-only Codex review, project rules from
    `AGENTS.md`, regression suite, final public CI, and serious-finding
    disposition.
  - Acceptance: reviewer returns `PASS`; root reopens material evidence and
    records the CI run and immutable commits below.

### Release evidence

- Functional source commit (`F`):
  `e5276925d390704fccdf4aaeba47280464762a1c`
- Catalog commit (`C`):
  `c6e8c89c8dd38a7fecfdf6726a19f878aa80d1dd`
- Reviewed documentation candidate:
  `eb1fbb2853d090ebbc5693a5034e63c18321705d`
- Stable promotion commit:
  `1b823ffbeb91fab761a81ef4e35e2db2bb632552`
- Candidate public CI run:
  [30148884739](https://github.com/barnlabs/keepkeys/actions/runs/30148884739)
  — macOS, Windows, and Linux Node 18/22; all three native-vault doctors;
  reproducible packages; and `Release gate` passed.
- Stable-promotion public CI run:
  [30149156624](https://github.com/barnlabs/keepkeys/actions/runs/30149156624)
  — the same 11 proof jobs passed on the exact promotion commit, including the
  strict rejection of stale 0.4.1 update metadata.
- Independent reviewer verdict: `PASS` after reopening the focused repair;
  no actionable defect. The reviewer verified the exact `F → C → docs` chain,
  public CI, adapter UTF-8 parity, Windows case-sensitive URL handling,
  serialized Credential Manager limits, clipboard coordinators, structured
  Linux errors, and the tool-I/O metadata allowlist.
- Dedicated local Codex review: no actionable regression after independently
  rerunning `check`, `test`, submission packaging, and source packaging.
- Stable update channel: `update.json` advertises 0.4.2 with the exact `F` and
  `C` commits above; the release gate rejects stale 0.4.1 metadata.
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

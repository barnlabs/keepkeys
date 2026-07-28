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
- [ ] **Independent adversarial 0.5.0 review and public matrix passed.**
  - Implementer context: exact diff, generated archives, local proof, public CI,
    immutable `F → C → docs` chain, and rollback.
  - Required tests: dedicated read-only Codex review, complete local regression
    suite, all-platform public CI, and serious-finding disposition.
  - Acceptance: reviewer returns `PASS`; root reopens the exact evidence and
    records it below.

### 0.5.0 release evidence

- Functional source commit (`F`):
  `7eba25e76778337cbcc3aff68dd9e3cbc843a31d`.
- Catalog commit (`C`):
  `c046ff9c04b28b57a5c3a6c206389b4fa467046e`.
- Reviewed documentation candidate (`D`):
  `d1fb0f5192bb7c6ea317b60410866e90c5827994`.
- Candidate public CI:
  [30406317033](https://github.com/barnlabs/keepkeys/actions/runs/30406317033)
  — all 11 jobs passed on the exact documentation candidate, including native
  vault tests on macOS, Windows, and Linux plus byte-for-byte reproducible
  package proof.
- Promotion commit (`P`):
  `fb74fb2a351a2d08284abcb8630283fa1db51e98`.
- Promotion public CI:
  [30406522588](https://github.com/barnlabs/keepkeys/actions/runs/30406522588)
  — all 11 jobs passed on the exact promotion commit.
- Evidence commit (`E`):
  `3a10a89e3de30e8e4f60900fd325d128ad9f3dc3`.
- Evidence public CI:
  [30406686042](https://github.com/barnlabs/keepkeys/actions/runs/30406686042)
  — all 11 jobs passed on the exact evidence commit.
- Proof closure commit:
  `be6ebb8f63c6b1dcecc4a961c3ee0b6515dba828`.
- Proof closure public CI:
  [30406826613](https://github.com/barnlabs/keepkeys/actions/runs/30406826613)
  — all 11 jobs passed on the exact proof closure commit. This ledger-only
  record follows that proof; public CI and both read-only reviews must also
  pass on this final ledger head before release closure.
- Exact-head GitHub Codex review
  [4802351808](https://github.com/barnlabs/keepkeys/pull/4#pullrequestreview-4802351808)
  reopened the prior exact head for four final delivery repairs: clean up Serve
  if it exits while launcher acknowledgment is pending, treat a missing native
  commit receipt as uncertain, serialize desktop and phone stores by name, and
  terminate startup-helper descendants on cancellation.
- Dedicated local proof: `check`, 55 Node tests, eight Hermes tests, 18 Linux
  unit tests, macOS doctor, package and archive checks, and repeated
  `./scripts/tailnet-smoke` runs passed. Each live smoke crossed authenticated
  Tailscale Serve HTTPS, bound one browser, submitted a fresh generated UTF-8
  value to macOS Keychain, verified the native round trip, and left
  `tailscale serve status --json` equal to `{}` with no portal, Serve process,
  or test record. A separate live cancellation probe reached Serve readiness,
  withheld the launcher acknowledgment, disconnected the launcher, observed
  the detached portal fail, and verified exact route removal.
- Browser proof at 375 by 812 and 1280 by 720 CSS pixels found no horizontal
  overflow or console warnings/errors. JavaScript enabled the initially
  disabled fieldset, the password input had no HTML `name`, focus landed on
  the key field, and a generated submission reached the stored state.
- Independent read-only review returned `PASS` on the exact `F → C → D`
  candidate after reopening the complete diff, all four findings from review
  `4802351808`, package inventories, local proof, and candidate public CI.
- Superseded portal-delivery chain: functional
  `534ca9c82914cc0a2a8072f4de2c0674cffd544b`, catalog
  `c021deb6c0f2d649b899cc11914adbef43dc7432`, documentation
  `9a2b5ff6c70188bf3afb36b08aa030b02b7f04aa`, promotion
  `e3422f2b00e16ad29af60a5ff59c0a150ecc9ca7`, evidence
  `887c2901511d19b090168bdd3edc4fdfcd9fc06c`, and proof closure
  `9041654c2114a1e50e4431dec7345ff941a7382a`. Public runs
  [30403710815](https://github.com/barnlabs/keepkeys/actions/runs/30403710815),
  [30403950497](https://github.com/barnlabs/keepkeys/actions/runs/30403950497),
  [30404113522](https://github.com/barnlabs/keepkeys/actions/runs/30404113522),
  and [30404286615](https://github.com/barnlabs/keepkeys/actions/runs/30404286615)
  passed all 11 jobs, but exact-head review `4802351808` found the four
  delivery gaps above, so that chain is not a release candidate.
- Superseded launcher-lifecycle chain: functional
  `0c036c3ad7a2fd50f48c1281229fc7ac18bab2ef`, catalog
  `28f5166c06d227261212b2172b75fa54d3b0c00b`, documentation
  `06b920b98ca3709353d4635e4a46d6a2a2b46143`, promotion
  `b90e8588d694e2c9186cb73d1eb3b775a802b097`, evidence
  `03a27b2e509270896d29ec36c3a1c17aca46be70`, and proof closure
  `3201689385ecfcf053e010ba7397efa82914aa3c`. Public runs
  [30400773539](https://github.com/barnlabs/keepkeys/actions/runs/30400773539),
  [30401202501](https://github.com/barnlabs/keepkeys/actions/runs/30401202501),
  [30401418081](https://github.com/barnlabs/keepkeys/actions/runs/30401418081),
  and [30401624974](https://github.com/barnlabs/keepkeys/actions/runs/30401624974)
  passed all 11 jobs, but exact-head review `4802130390` found the four
  lifecycle gaps above, so that chain is not a release candidate.
- Superseded Linux uncertainty chain: functional
  `561fba77ead72bef09071dd2d81be639eb76bdea`, catalog
  `486d048c92b04d47061c64b9462dffd2fe80f29e`, documentation
  `138dd49c6f2e47e27be68690055e8197631a09d4`, promotion
  `4ab861c88043bd2cc60f3203ca29f28d69b17a4c`, evidence
  `471d0798e1817d876924f6461bc61366eb7f3f0d`, and proof closure
  `2d458cf6a200b5b583ed571a194267347b17b2b5`. Public runs
  [30398247740](https://github.com/barnlabs/keepkeys/actions/runs/30398247740),
  [30398539657](https://github.com/barnlabs/keepkeys/actions/runs/30398539657),
  [30398737699](https://github.com/barnlabs/keepkeys/actions/runs/30398737699),
  and [30399131533](https://github.com/barnlabs/keepkeys/actions/runs/30399131533)
  passed all 11 jobs, but exact-head review `4801887230` found the three Linux
  gaps above, so that chain is not a release candidate.
- Superseded prior final chain: functional
  `74d32f8898394e8b7203a2d4b95f3d6282aba845`, catalog
  `945626279cc015f3e9b0c0595967bc9e39514618`, documentation
  `d2dcaa5246f5fe9ce54425762a36433edfb962df`, promotion
  `6ada0021905e0ea7b677b54c6ee1c7007ec103a4`, and final proof
  `8e7a8e259f8d455feba4703a11cf86c2cea9c658`. Public runs
  [30395067056](https://github.com/barnlabs/keepkeys/actions/runs/30395067056),
  [30395379321](https://github.com/barnlabs/keepkeys/actions/runs/30395379321),
  and [30395577746](https://github.com/barnlabs/keepkeys/actions/runs/30395577746)
  passed all 11 jobs, but exact-head review `4801551714` found the three gaps
  above, so that chain is not a release candidate.
- Superseded publisher-checksum chain: functional
  `af4d97691adf80dbcab2212f5fdfc091b2a97851`, catalog
  `e177f405482950de39abef0fa78559a2a6043074`, documentation
  `51f72623e27d92970b89d073eff686851b6937f4`, promotion
  `c4d0bc3bec1d686cfeb09ebf2872d07a9f9b3f39`, and final proof
  `0bb986864e21e22793d40c42979a1f6191b8787f`. Public runs
  [30392719709](https://github.com/barnlabs/keepkeys/actions/runs/30392719709),
  [30392872749](https://github.com/barnlabs/keepkeys/actions/runs/30392872749),
  and [30393019397](https://github.com/barnlabs/keepkeys/actions/runs/30393019397)
  passed all 11 jobs, but exact-head review `4801311339` found the four gaps
  above, so that chain is not a release candidate.
- Superseded cleanup chain: functional
  `af4d97691adf80dbcab2212f5fdfc091b2a97851`, catalog
  `e177f405482950de39abef0fa78559a2a6043074`, documentation
  `aab8c8605f412df0aaf1f77386aad32d43334eeb`, promotion
  `c98fd0951c129920d2810c4e36025922bba76aa0`, and final proof
  `ce65ee10202d919ae72aadb8a234b281d9771751`. Public runs
  [30391619827](https://github.com/barnlabs/keepkeys/actions/runs/30391619827),
  [30391841893](https://github.com/barnlabs/keepkeys/actions/runs/30391841893),
  and [30391990018](https://github.com/barnlabs/keepkeys/actions/runs/30391990018)
  passed all 11 jobs, but the publisher guide named a superseded upload
  checksum instead of the generated archive checksum, so that documentation
  candidate is not a release candidate.
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

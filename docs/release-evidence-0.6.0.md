# KeepKeys 0.6.0 Release Evidence

This packet is the reproducible evidence index for the 0.6.0 candidate. It is
intended to be read with [CHECKLIST.md](../CHECKLIST.md),
[docs/releasing.md](releasing.md), and [docs/threat-model.md](threat-model.md).
The candidate is not a tag or GitHub Release; those remain maintainer-owned.

## Immutable chain

- Functional source (`F`): `28f3e8426eb24c867f566064760edd6612062c85`.
  This commit contains the source and tests for the 0.6.0 behavior, including
  the final cross-platform POSIX-path fixture repair required by Windows CI.
- Catalogs (`C`): `e1d4470f32cf236024107230f5dbb0aa420f0137`. The Claude and OMP
  marketplace entries in this commit pin their source to `F`.
- Documentation and update candidate (`D`):
  `2958441afca00f4f6eb30b979e5550b8e6abb98e`. This packet is committed after
  `F` and `C`; its exact-head public proof is run `30600005949` below.
- `update.json` carries `version: 0.6.0`, `sourceCommit: F`, and
  `catalogCommit: C`; the checker is review-only and never installs or
  synchronizes vault values.

## Changed-file surface

The following is the exact `git diff --name-status`
`3afd9aa7b8d2b0b3b24562231f5e6d97db25be3d..HEAD` surface used for the 0.6.0
review. The prior functional commit is the reviewed 0.5.0 baseline.

```text
M .claude-plugin/marketplace.json
M .grok-plugin/marketplace.json
M .omp-plugin/marketplace.json
M CHANGELOG.md
M CHECKLIST.md
M DESIGN.md
M INSTALL.md
M README.md
M SECURITY.md
M adapters/hermes/plugin.py
M adapters/hermes/test_plugin.py
A chatgpt-app-submission.json
M docs/compatibility.md
M docs/privacy-and-data-handling.md
A docs/release-evidence-0.6.0.md
M docs/releasing.md
M docs/threat-model.md
M docs/updating.md
M gemini-extension.json
M plugin.yaml
M plugins/keepkeys/.claude-plugin/plugin.json
M plugins/keepkeys/.codex-plugin/plugin.json
M plugins/keepkeys/.grok-plugin/plugin.json
M plugins/keepkeys/mcp/server.mjs
M plugins/keepkeys/mcp/server.test.mjs
M plugins/keepkeys/mcp/tools.json
M plugins/keepkeys/scripts/check-for-update.mjs
M plugins/keepkeys/scripts/check-for-update.test.mjs
M plugins/keepkeys/scripts/keepkeys
M plugins/keepkeys/scripts/keepkeys-cli.mjs
A plugins/keepkeys/scripts/keepkeys-cli.test.mjs
A plugins/keepkeys/scripts/keepkeys-rotate.mjs
M plugins/keepkeys/scripts/keepkeys-store.mjs
M plugins/keepkeys/scripts/keepkeys.linux.py
M plugins/keepkeys/scripts/keepkeys.swift
M plugins/keepkeys/scripts/keepkeys.windows.ps1
M plugins/keepkeys/scripts/platform.mjs
M plugins/keepkeys/scripts/test_keepkeys_linux.py
M plugins/keepkeys/skills/keepkeys/SKILL.md
M scripts/check
M scripts/package-release
M scripts/package-submission
M scripts/test
M scripts/test.ps1
M scripts/validate-adapters.mjs
M scripts/validate-plugin.mjs
M skills/keepkeys/SKILL.md
M submission/codex-market-guide.md
M submission/release-notes.md
M update.json
```

The functional surface is deliberately split from catalog and documentation
commits. The final test-only change in `F` is included because Windows executes
the Linux contract tests with Windows path semantics; synthetic POSIX fixtures
must remain POSIX on every host.

## Reproducible proof

Run these commands from the exact `D` checkout. They are the local proof
commands required by the release protocol:

```sh
./scripts/check
./scripts/test
./scripts/doctor
node scripts/validate-adapters.mjs
node scripts/validate-plugin.mjs
node scripts/validate-docs.mjs
node scripts/scan-secrets.mjs
./scripts/package-submission
./scripts/package-release
(cd dist && shasum -a 256 -c keepkeys-skills-0.6.0.zip.sha256 && shasum -a 256 -c keepkeys-0.6.0-source.zip.sha256)
```

The passing local suite on the current macOS host reports 67 Node tests, 10
Hermes tests, 28 Linux contract tests, and passing macOS helper, Paste & Store,
scoped-process, redaction, and native doctor checks. The package builders assert
required archive members, executable bits, absence of MCP files from the
skills-only archive, absence of build caches, and deterministic rebuilds.
Windows PowerShell is not installed on the maintainer host, so Windows parser,
Node, native-vault, and package proof is supplied by public CI rather than
claimed as a local run.

The exact-head public proof is GitHub Actions run
[30600005949](https://github.com/barnlabs/keepkeys/actions/runs/30600005949) at
`2958441afca00f4f6eb30b979e5550b8e6abb98e`. Its 11 successful jobs are:

- reproducible packages
- native vault on macOS, Ubuntu, and Windows
- Node.js 18 and 22 on macOS, Ubuntu, and Windows
- release gate

The release gate requires every verify, native-vault, and package job to report
success; the recorded run returned `status=completed`, `conclusion=success`,
and an empty failed-job list.

The generated archive SHA-256 values from the exact `D` checkout are:

```text
722e49191f1c0033404023632c42923af76db030d736727f1993e036d95f9425  dist/keepkeys-skills-0.6.0.zip
a7f335f5519d3eb12d4d933f90cfecd5706d9a2c9f3651d0a0cc120182a79498  dist/keepkeys-0.6.0-source.zip
```

The submission archive contains 31 members and the source archive contains 129
members. The required skills-only members are present, and both archives have
no forbidden MCP files, Python bytecode, build caches, or local dependency
directories. The package job also performs a byte-for-byte rebuild comparison.

## Independent review disposition

The first final read-only critic reviewed the implementation and returned
`REWORK` only for three proof-packet gaps: changed-file and pin mapping,
reproducible command/artifact evidence, and known-limitations/rollback
evidence. It reported no implementation, plaintext-boundary, approval, update,
rotation, or cross-platform security finding. A fresh critic then reviewed the
exact `D` head after its public CI completed and found only two stale evidence
references: the packet still cited the pre-packet run and omitted the packet
itself from the changed-file list. This closure update fixes those two ledger
errors; the implementation and its exact `D` public proof are unchanged.

## Known limitations and rollback

- KeepKeys has no background vault synchronization, hosted relay, account, or
  cloud copy. Cross-device support is a deliberate one-use, ten-minute,
  tailnet-only Tailscale Serve transfer into the connected host's native vault;
  it is not record synchronization.
- Official provider documentation research depends on an available search or
  web-search tool. If no authoritative provider documentation can be found,
  setup stops and asks for nonsecret context rather than inventing a link.
- Native entry requires a graphical approval surface and a supported native
  vault. Linux requires Secret Service. Phone entry additionally requires the
  same tailnet identity, private HTTPS/MagicDNS, session expiry, and exact
  Serve teardown; missing prerequisites fail closed.
- The update checker is review-only and does not auto-install, migrate, or
  synchronize records. Tags, GitHub Releases, signing, and marketplace
  submissions are not performed by this branch.
- If a candidate fails validation, reinstall the previous reviewed functional
  commit `3afd9aa7b8d2b0b3b24562231f5e6d97db25be3d`; use the previous raw
  catalog commit `33afe85cf245c0b8003c0d1638c90c56defeb128` for Claude and OMP.
  Stop before merge, tag, or release. Plugin rollback does not delete native
  vault records or downgrade their format.
- If a native helper or portal operation reports uncertain cleanup or storage,
  do not repeat the submission blindly. Follow the visible uncertainty state,
  inspect only metadata/status, and use the documented recovery path in
  [docs/releasing.md](releasing.md).

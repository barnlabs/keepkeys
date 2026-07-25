# KeepKeys agent instructions

KeepKeys is a local secret-use broker for coding agents. The user types a value
into a native password field, the operating-system vault stores it, and an
approved direct child process receives one environment variable. The product
does not expose a plaintext retrieval action.

Read [DESIGN.md](DESIGN.md), [CHECKLIST.md](CHECKLIST.md),
[CODE_REVIEW.md](CODE_REVIEW.md), and [docs/threat-model.md](docs/threat-model.md)
before changing behavior.

## Non-negotiable invariants

- Never add a `get`, reveal, copy, export, clipboard, terminal-entry, chat-entry,
  file-backed secret, or secret-returning tool.
- Tool inputs and outputs may contain names, variable names, descriptions,
  purposes, paths, arguments, fingerprints, and status only—never a secret
  value.
- Listing and pre-approval UI read metadata only. Read the protected value only
  after **Allow once**, then recheck metadata and executable identity before
  launch.
- Launch a direct executable without a shell. Start with an empty child
  environment and add only the approved variable.
- Preserve bounded concurrent stdout/stderr capture, overflow omission, and
  common-representation redaction.
- Use generated synthetic values for tests. Never inspect an existing user
  credential or add credential-shaped fixtures, logs, screenshots, or output.
- Fail closed when the native vault, graphical approval surface, source
  fingerprint, validation, or cleanup proof is unavailable.
- Do not install absent agent harnesses to validate adapters. Test their
  published contracts and use disposable host smoke tests only when a
  maintainer explicitly schedules them.

## Development commands

macOS or Linux:

```sh
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
./scripts/package-submission
./scripts/package-release
```

Windows PowerShell:

```powershell
.\scripts\bootstrap.ps1
.\scripts\check.ps1
.\scripts\test.ps1
.\scripts\doctor.ps1
```

`test` must stay headless. `doctor` may touch only a generated temporary
KeepKeys record and must prove cleanup.

## Change and release protocol

1. Define the affected invariant, platform, host contract, rollback, and proof.
2. Add a positive test, a negative test, and a regression test before claiming
   the behavior.
3. Keep host adapters thin and the shared schema canonical.
4. Recompute every changed native-helper source fingerprint.
5. Update every manifest, skill copy, archive assertion, version surface,
   changelog entry, compatibility statement, and update-channel record.
6. Commit functional source first (`F`), commit catalogs pinned to `F` second
   (`C`), then commit install/update documentation pinned to `F` and `C`.
7. Require the complete OS/Node matrix, all three native-vault doctors,
   packages, secret scan, and independent adversarial review to pass.
8. Use [CHECKLIST.md](CHECKLIST.md) for acceptance evidence. An implementer
   cannot certify their own checkmark.

Tags, GitHub Releases, public-directory submissions, signing, and repository
settings remain maintainer-owned external actions.

## Code Review Rules

### Plaintext boundary

- Flag P1 if any changed schema, adapter, command, log, test, document, or UI
  creates a path for a secret value to enter chat, argv, persistent environment,
  clipboard, plaintext storage, or a tool response. Safe path: keep values
  inside native secure entry, the native vault, and the one approved child.

### Approval and executable identity

- Flag P1 if protected data can be read before one-time approval, if approval
  omits the exact executable/arguments/scope, or if metadata, executable, or
  interpreter-entrypoint identity is not rechecked after approval. Safe path:
  metadata-only preview, **Allow once**, protected read, identity recheck,
  direct launch.

### Cross-platform release integrity

- Flag P1 if a shared contract, native helper, version, package, or installation
  pin changes without aligned macOS/Windows/Linux tests, helper fingerprints,
  host manifests, catalog pins, update metadata, rollback documentation, and
  a green public matrix. Safe path: preserve the `F → C → docs` immutable chain
  and block release on any missing proof.

These rules guide Codex GitHub review. Deterministic formatting, syntax,
packaging, and schema checks belong in CI.

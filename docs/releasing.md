# Releasing KeepKeys

KeepKeys releases are source releases. The installation trust unit is a reviewed
full Git commit SHA; `main` is useful for discovery, not an immutable security
pin.

## Gate

1. Update all manifests, the shared skill metadata, server/helper version, and
   changelog.
2. Recompute the Swift-source SHA-256 pinned in
   `plugins/keep-keys/scripts/keepkeys`.
3. Run `./scripts/check`, `./scripts/test`, and `./scripts/doctor`.
4. Run `./scripts/package-submission` and `./scripts/package-release`; verify
   both generated checksums.
5. Validate available client CLIs from isolated temporary homes or installed
   caches without reading user secrets.
6. Review the final diff against `docs/threat-model.md` and
   `docs/compatibility.md`.
7. Commit the functional release.
8. Replace documentation placeholders with that exact functional commit SHA,
   rerun documentation/manifest checks, commit, and push.
9. Confirm GitHub CI and the public README.
10. Create a tag or GitHub Release only with maintainer authorization.

## Rollback

Reinstall the last reviewed full commit SHA for the affected client. Plugin
rollback does not alter Keychain records. If the native helper changed, the
launcher rebuilds the cache from the selected source; the user may remove the
exact KeepKeys cache directory first if a rebuild itself is under test.

Do not downgrade the Keychain record format without a tested migration. Version
0.2 uses metadata record version `1`, unchanged from 0.1.

# Releasing KeepKeys

KeepKeys releases are source releases. The installation trust unit is a reviewed
full Git commit SHA; `main` is useful for discovery, not an immutable security
pin.

## Gate

1. Update all manifests, the shared skill metadata, server/helper version, and
   changelog.
2. Recompute the Swift-source SHA-256 pinned in
   `plugins/keepkeys/scripts/keepkeys`.
3. Run `./scripts/check`, `./scripts/test`, and `./scripts/doctor`.
4. Run `./scripts/package-submission` and `./scripts/package-release`; verify
   both generated checksums.
5. Validate available client CLIs from isolated temporary homes or installed
   caches without reading user secrets.
6. Review the final diff against `docs/threat-model.md` and
   `docs/compatibility.md`.
7. Commit the functional release; this is the source SHA used by Codex, Gemini,
   Hermes, and the Claude/OMP plugin entries.
8. Replace the Claude and OMP plugin-source SHA fields with that functional SHA,
   validate both catalogs, and commit the catalogs.
9. Replace install-document placeholders with the functional SHA and the raw
   catalog URL at the catalog commit SHA. Rerun all checks and commit.
10. Push the complete commit chain, confirm GitHub CI, test the public immutable
    URLs, and verify the public README.
11. Create a tag or GitHub Release only with maintainer authorization.

## Rollback

Reinstall the last reviewed full commit SHA for the affected client. Plugin
rollback does not alter Keychain records. If the native helper changed, the
launcher rebuilds the cache from the selected source; the user may remove the
exact KeepKeys cache directory first if a rebuild itself is under test.

Do not downgrade the Keychain record format without a tested migration. Version
0.3 uses metadata record version `1`, unchanged from 0.1.

# Releasing KeepKeys

KeepKeys releases are source releases. The installation trust unit is a reviewed
full Git commit SHA; `main` is useful for discovery, not an immutable security
pin.

## Gate

1. Update all manifests, the shared skill metadata, server/helper version, and
   changelog.
2. Recompute the Swift-source SHA-256 pinned in the macOS launcher and the
   Windows/Linux helper SHA-256 values pinned in `scripts/platform.mjs`.
3. Run the check, test, and doctor scripts on macOS, Windows, and Linux.
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
rollback does not alter native-vault records. If the macOS helper changed, the
launcher rebuilds the cache from the selected source; the user may remove the
exact KeepKeys cache directory first if a rebuild itself is under test. Windows
and Linux execute the selected reviewed source directly.

Do not downgrade a native-vault record format without a tested migration.
Version 0.4 uses macOS metadata version `1` plus paired metadata/value records on
Windows and Linux.

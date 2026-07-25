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
5. Validate the strict `update.json` schema, documentation links, archive
   inventories, and credential-pattern scan.
6. Validate available client CLIs from isolated temporary homes or installed
   caches without reading user secrets.
7. Review the final diff against `docs/threat-model.md` and
   `docs/compatibility.md`.
8. Commit the functional release; this is the source SHA used by Codex, Gemini,
   Hermes, and the Claude/OMP plugin entries.
9. Replace the Claude and OMP plugin-source SHA fields with that functional SHA,
   validate both catalogs, and commit the catalogs.
10. Replace install-document placeholders with the functional SHA and the raw
    catalog URL at the catalog commit SHA. Add `update.json` with the version,
    functional SHA, catalog SHA, install guide, and release notes.
11. Run the complete regression suite, package builds, native doctor available
    on the current OS, and a separate read-only Codex review of the exact diff.
    Repair findings and require the reviewer to return `PASS`.
12. Push the complete commit chain, require the public **Release gate**, test
    public immutable URLs, and verify repository metadata and the public README.
13. Record source, catalog, documentation, CI, adversarial-review, and rollback
    evidence in [CHECKLIST.md](../CHECKLIST.md).
14. Create a tag or GitHub Release only with maintainer authorization.

## Rollback

Reinstall the last reviewed full commit SHA for the affected client. Plugin
rollback does not alter native-vault records. If the macOS helper changed, the
launcher rebuilds the cache from the selected source; the user may remove the
exact KeepKeys cache directory first if a rebuild itself is under test. Windows
and Linux execute the selected reviewed source directly.

Do not downgrade a native-vault record format without a tested migration.
Version 0.4.2 reads macOS metadata versions `1` and `2`, writes version `2`, and
uses paired metadata/value records on Windows and Linux. Linux reads version-1
metadata labels and writes version-2 labels; Windows stores version-2
provider/documentation JSON in the non-secret metadata record.

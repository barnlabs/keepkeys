# Updating KeepKeys

KeepKeys uses deliberate updates. It never downloads or installs code in the
background.

## Check the stable channel

From a reviewed checkout:

```sh
./scripts/check-update
```

Windows PowerShell:

```powershell
.\scripts\check-update.ps1
```

An installed plugin can run the bundled checker directly:

```sh
node plugins/keepkeys/scripts/check-for-update.mjs
```

The checker makes one explicit HTTPS request to
`raw.githubusercontent.com/neorome/keepkeys/main/update.json`, caps the response
at 16 KiB, accepts a strict schema, and prints the stable version plus the full
functional and catalog commit SHAs, whether explicit installation is required,
and the source/catalog review requirement. It does not modify the checkout,
install a plugin, read the native vault, or send telemetry. It never runs in the
background and does not silently migrate or synchronize vault records.

## Review before updating

1. Read the linked release notes.
2. Review the immutable functional source commit (`F`).
3. Confirm the referenced catalog commit (`C`) points to `F`.
4. Confirm the public CI run for the release is green.
5. Use the host-specific immutable command in [INSTALL.md](../INSTALL.md).
6. Start a new host session and run `keepkeys_status`.
7. Use `keepkeys_doctor` with generated temporary data.
8. After a replacement, review the new exact-command approval request; a
   successful rotation clears the old name's automatic-approval rules.

Do not update from an unreviewed mutable branch, use a host-wide “update all”
command for a credential-sensitive release, or replace a working install when
the stable-channel version or immutable-commit fields are malformed.

## Roll back

Reinstall the previous reviewed functional commit. Claude Code and Oh My Pi use
the previous raw catalog URL; other supported hosts use the previous exact
source commit. Rollback does not delete native-vault records and must not change
their record format.

The release protocol and pin order are documented in
[releasing.md](releasing.md).

# KeepKeys 0.7.0 Neorome namespace evidence

## Status

This is a pre-release evidence packet. KeepKeys 0.7.0 is not released,
tagged, or approved for installation. No public matrix run, package checksum,
independent review, or release-gate decision is recorded here.

## Immutable source chain

- Functional source (`F`):
  [`2525a3358831d2a539d6a1dbdcb5f7148c0418b5`](https://github.com/neorome/keepkeys/commit/2525a3358831d2a539d6a1dbdcb5f7148c0418b5)
- Catalogs (`C`):
  [`fbccd06be00df77db27004355a6cac8b29e8533e`](https://github.com/neorome/keepkeys/commit/fbccd06be00df77db27004355a6cac8b29e8533e)

The Claude Code and Oh My Pi catalogs in `C` pin their `git-subdir` source to
`F`. The final documentation/update commit must preserve those pins and must
not be labeled a released stable version before the required proof exists.

## Changed boundary

The candidate moves public ownership, marketplace names, package metadata,
canonical repository URLs, support routes, update endpoint, native vault
service names, cache paths, portal lock paths, and Windows mutexes to Neorome.
It also replaces the Keykeeper master, plugin-store crops, and GitHub social
preview.

The fresh native namespaces intentionally do not read, export, or migrate
records from a prior namespace. That avoids a new secret-bearing migration path
and means a user stores a required record again through **Paste & Store**.

## Local verification

On 2026-08-07, this checkout passed:

- `./scripts/check`: plugin structure, all adapter contracts, documentation
  links and assets, and the credential-pattern scan;
- `./scripts/test`: 67 Node tests, 10 Hermes tests, 28 Linux-helper tests, and
  macOS generated-value self-tests.

These local checks do not prove the Windows Credential Manager doctor, Linux
Secret Service doctor, public CI, generated package checksums, or release
provenance.

## Remaining gates and rollback

Before release, run the complete OS/Node matrix, every native-vault doctor,
the submission and release packaging commands, a fresh exact-head independent
security review, public immutable-URL checks, and the public release gate.

Rollback means reinstalling the prior reviewed source/catalog pair. It does not
merge or copy records between namespaces. The current candidate must not be
published as a stable release until the required proof is recorded.

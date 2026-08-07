# Governance

KeepKeys is a Neorome open-source initiative. Neorome maintains the security
boundary, repository, release process, client adapters, and public project
identity.

## Decision principles

1. The no-plaintext-retrieval boundary wins over convenience.
2. One agent contract, one dispatcher, and narrowly scoped native backends win
   over divergent client implementations.
3. A small, verified capability wins over broad vault or automation features.
4. Client support is claimed only with a documented package surface and proof.
5. Security findings are handled privately before public discussion.

Maintainers may accept routine documentation, test, adapter, and accessibility
changes through normal review. Changes to native-vault storage, native approval,
command execution, output redaction, deletion semantics, tool schemas, or release
trust require the release gates in [SECURITY.md](SECURITY.md).

## Project scope

KeepKeys is not becoming a cloud vault, team secret manager, browser password
manager, standalone desktop app, credential generator, rotation service, or
plaintext export utility. The optional phone page is a short-lived input route
to the user's own computer, not a vault, synchronization service, or remote
management product. A proposal outside that scope needs a concrete user problem
and an explanation of why it belongs in this repository instead of an
integration with an established product.

## Releases and ownership

Neorome owns release naming, official directory submissions, vulnerability
disclosure, and repository settings. Contributor copyright remains with its
author and is licensed under Apache-2.0 when contributed.

The current maintainer list is in [MAINTAINERS.md](MAINTAINERS.md). Governance
changes are public pull requests and take effect only after maintainer approval.

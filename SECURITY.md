# Security policy

## Supported versions

| Version | Status |
| --- | --- |
| `0.4.x` | Current source release; macOS, Windows, and desktop Linux |
| `0.3.x` | Supported for critical security fixes |
| `0.2.x` | Supported for critical security fixes |
| `0.1.x` | Supported for critical security fixes |
| `< 0.1` | Unsupported scaffold |

KeepKeys is security-sensitive software. No version is described as unbreakable or as protection against a compromised user session, administrator, debugger, malicious approved executable, or physical compromise.

## Report privately

Use this repository’s **Security → Report a vulnerability** flow to open a private GitHub Security Advisory. Do not open a public issue for a suspected vulnerability.

Never include a real API key, password, token, private key, seed phrase, customer record, credential-bearing screenshot, credential-vault export, or transcript. Reproduce with a generated synthetic value.

Please include:

- affected version and commit;
- operating system, desktop/vault provider where applicable, and agent-client versions;
- preconditions and realistic impact;
- minimal reproduction using synthetic data;
- evidence of whether the value reached chat, tool input/output, logs, files, another process, or the network;
- a suggested fix if you have one.

BarnLabs aims to acknowledge a well-formed report within seven calendar days. Disclosure timing is coordinated after a fix and verification are available.

## Research boundary

Good-faith, non-destructive research against your own local clone and synthetic credentials is welcome. Do not test BarnLabs infrastructure, other users, third-party accounts, production services, or real credentials. Do not publish an exploit before coordinated remediation.

## Release gates

Changes to native-vault queries, native dialogs, shared tool schemas, client adapters, command construction, environment handling, output capture/redaction, cache compilation, marketplace wiring, or permissions require:

1. a threat-model update;
2. deterministic regression coverage;
3. full `./scripts/check` and `./scripts/test`;
4. platform-native doctor round trips for macOS Keychain, Windows Credential Manager, and Linux Secret Service;
5. macOS, Windows, and Linux CI;
6. independent security review of the final diff.

# Contributing

KeepKeys stays small because every additional capability expands a credential boundary.

## Before coding

1. Describe the user problem and why the existing store/list/use/remove tools cannot solve it.
2. Check [docs/threat-model.md](docs/threat-model.md).
3. Keep the plugin as the product. Do not add a standalone app, cloud vault,
   account system, telemetry service, silent/background updater, or raw-secret
   retrieval path. Deliberate update discovery must stay read-only and
   user-initiated. The optional phone path must stay one-use, tailnet-only, and
   free of BarnLabs-hosted secret handling.
4. Preserve the one shared contract and dispatcher. A new client integration
   must be a thin adapter; a new operating system needs a threat-modeled native
   vault and human-gate backend.
5. Discuss changes to storage, command execution, tool schemas, native prompts, permissions, or distribution before implementing them.
6. Treat Tailscale Funnel, persistent listeners, secret synchronization, and
   public browser intake as out of scope.

## Development

```sh
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
```

On Windows, use the corresponding `scripts\bootstrap.ps1`, `check.ps1`,
`test.ps1`, and `doctor.ps1` commands.

Tests must use generated synthetic markers. Never use a fixture that resembles
a live credential. `test` must remain headless: it cannot open a native window,
read an existing user vault item, or require the plugin to be installed.

## Pull requests

- Keep one behavior change per pull request.
- Add a deterministic positive and negative test.
- Update the threat model when a trust boundary changes.
- Update submission test cases if visible plugin behavior changes.
- Add adapter validation and installation documentation for every newly supported client.
- Explain exact verification and remaining risk.
- Follow [CODE_REVIEW.md](CODE_REVIEW.md): request an independent read-only
  review of the exact diff, repair findings, rerun regressions, and record a
  `PASS` verdict before release.
- Do not include generated cache binaries, `.env` files, logs, credential-vault
  exports, or screenshots containing field values.

Security reports follow [SECURITY.md](SECURITY.md), not public issues or pull requests.

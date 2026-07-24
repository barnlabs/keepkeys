# Contributing

KeepKeys stays small because every additional capability expands a credential boundary.

## Before coding

1. Describe the user problem and why the existing store/list/use/remove tools cannot solve it.
2. Check [docs/threat-model.md](docs/threat-model.md).
3. Keep the plugin as the product. Do not add a standalone app, cloud vault, account system, telemetry service, updater, or raw-secret retrieval path.
4. Discuss changes to storage, command execution, MCP tools, native prompts, permissions, or distribution before implementing them.

## Development

```sh
./scripts/bootstrap
./scripts/check
./scripts/test
./scripts/doctor
```

Tests must use generated synthetic markers. Never use a fixture that resembles a live credential. `test` must remain headless: it cannot open a native window, read a user Keychain item, or require the plugin to be installed.

## Pull requests

- Keep one behavior change per pull request.
- Add a deterministic positive and negative test.
- Update the threat model when a trust boundary changes.
- Update submission test cases if visible plugin behavior changes.
- Explain exact verification and remaining risk.
- Do not include generated cache binaries, `.env` files, logs, Keychain exports, or screenshots containing field values.

Security reports follow [SECURITY.md](SECURITY.md), not public issues or pull requests.

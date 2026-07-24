---
name: keep-keys
description: Store named secrets outside the conversation and use them through KeepKeys without returning plaintext to Codex. Use when a user asks to add, list, remove, or use a secret with KeepKeys.
---

# KeepKeys

KeepKeys gives Codex **use** of a local secret, not its plaintext value.

## Non-negotiable boundary

- Never ask the user to paste, type, dictate, attach, or expose a secret in chat.
- Never request a plaintext secret from KeepKeys; no such tool exists.
- Never fall back to an environment file, shell profile, command argument, clipboard, plugin configuration, log, or transcript.
- Treat friendly names and variable names as sensitive metadata. Mention only what the current task needs.

## Store

1. Supply a short friendly name, an uppercase environment-variable name, and a one-line description of the credential's intended use.
2. Call `keepkeys_store` with only those non-secret metadata fields.
3. KeepKeys pre-fills that metadata. The user only has to type the key into the native secure field. Do not ask for the value before or after the tool call.
4. Report only the success or cancellation result.

## Use

1. Identify the friendly name, purpose, absolute executable path, fixed argument list, and working directory.
2. Prefer a direct executable. Do not use a shell, interpreter command string, `env`, `printenv`, debugging dump, or another target likely to reveal environment variables.
3. Call `keepkeys_run`. KeepKeys shows the exact request in a native confirmation window and retrieves the credential only after the user approves it.
4. Treat output marked `[REDACTED BY KEEPKEYS]` as intentionally unavailable. Never try to reconstruct or encode the secret.
5. A target program and its descendants receive the secret. Use only a target the user intends to trust for this task.

## List and remove

- `keepkeys_list` returns friendly names, variable names, and descriptions so a future task can select the right credential without reading its value. Call it only when the user asks to list KeepKeys metadata or that metadata is necessary to complete the user's current authorized task.
- `keepkeys_remove` opens a native destructive-action confirmation. Use it only when the user asks to delete that named secret.
- `keepkeys_status` checks plugin/helper availability.
- `keepkeys_doctor` performs a temporary Keychain round trip with a generated test value and removes it; it never uses a user secret.

If KeepKeys is unavailable or unsupported, report the exact setup problem. Do not substitute a less safe storage path.

## Skills-only distribution fallback

The OpenAI public-submission bundle omits local MCP configuration. In Codex on macOS, if the `keepkeys_*` tools are not present:

1. Resolve this installed skill's own directory and use the bundled launcher exactly two levels above it at `scripts/keepkeys`. Do not search for or trust another `keepkeys` executable.
2. Pass an argument array directly through the shell execution tool:
   - store: `scripts/keepkeys store --name NAME --variable VARIABLE --description DESCRIPTION`
   - list: `scripts/keepkeys list`
   - remove: `scripts/keepkeys remove --name NAME`
   - status: `scripts/keepkeys status`
   - doctor: `scripts/keepkeys doctor`
   - run: `scripts/keepkeys run --name NAME --purpose PURPOSE [--cwd ABSOLUTE_DIR] -- ABSOLUTE_PROGRAM ARG...`
3. Quote each argument as data. Do not compose a command string, use `eval`, or pass through a shell executable.

If the surface cannot execute the bundled local launcher, KeepKeys is unsupported there and must fail closed.

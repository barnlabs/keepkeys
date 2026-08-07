---
name: keepkeys
description: Store named secrets outside the conversation and use them through KeepKeys without returning plaintext to the agent. Use when a user asks to add, list, rotate, revoke, remove, or use a secret with KeepKeys.
license: Apache-2.0
compatibility: macOS 13+, Windows 10/11, or desktop Linux; Node.js 18+ and the platform prerequisites documented in INSTALL.md.
metadata:
  author: Neorome
  version: "0.7.0"
---

# KeepKeys

KeepKeys gives the agent **use** of a local secret, not its plaintext value.

## Non-negotiable boundary

- Never ask the user to paste, type, dictate, attach, or expose a secret in chat.
- Never request a plaintext secret from KeepKeys; no such tool exists.
- Never read or inspect a clipboard. The native helper may read the host
  clipboard only after the user presses **Paste & Store**. The private phone
  page may receive the value only after the user presses its **Paste & Store**
  button.
- Never fall back to an environment file, shell profile, command argument,
  plugin configuration, log, or transcript.
- Treat friendly names and variable names as sensitive metadata. Mention only what the current task needs.

## Store

1. If the provider and intended use are unclear, ask only for that non-secret
   context. Never ask for the credential value.
2. Research the credential before opening KeepKeys. Use the available search or
   web-search tool to find the provider's official documentation, then inspect
   the official result enough to confirm that it explains the credential's
   purpose or use. Prefer AI-readable official documentation such as
   `llms.txt`, OpenAPI specifications, plain-text API references, or official
   SDK documentation. If none is available, use the provider's official
   human-readable credential or API documentation. Use one to three official
   HTTPS links, preserve the exact canonical URLs found by search, and never
   invent or substitute a third-party guide.
3. Choose the short friendly name, uppercase environment-variable name, useful
   one-line description, provider, and documentation links. These are
   agent-owned metadata; never ask the user to type or edit them.
4. Call `keepkeys_store` with only those non-secret metadata fields when the
   user is at the host computer.
5. KeepKeys shows the metadata as read-only context. The user copies the
   credential elsewhere, then presses **Paste & Store**. The native helper reads
   the clipboard only on that click, clears the current clipboard immediately,
   and stores the value without returning it through the agent protocol. The
   system clipboard is shared with same-user software, so tell the user to copy
   only when the native Store window is ready and click immediately.
6. Report only the success or cancellation result. Never ask for the value
   before or after the tool call.

When a search tool cannot find an official source, stop before storing and ask
only for the provider or intended non-secret use needed to search again. Do not
guess a documentation URL. Documentation links are durable metadata shown to a
future reviewer; they are not a place to put a credential, token, or auth code.

## Store from a phone

Use this path only when the user asks to add the key from a phone or says they
are controlling the host through ChatGPT Remote.

1. Complete the same provider research and metadata preparation as the native
   Store flow.
2. Confirm only that Tailscale is installed and signed in on the host and the
   phone, with both devices in the same tailnet. Never ask for a Tailscale
   credential or auth key.
3. Call `keepkeys_store_from_phone` with the non-secret metadata. KeepKeys
   starts a ten-minute Tailscale Serve page and never enables Tailscale Funnel.
4. Give the returned one-time HTTPS link to the user. Never open, fetch,
   preview, screenshot, or test the link. Opening it can bind the session to the
   wrong Tailscale identity.
5. The page shows the metadata and any replacement warning. The user pastes the
   key and presses **Paste & Store**. The value goes to the host's native vault
   without entering the tool call or conversation.
6. Tell the user that KeepKeys cannot clear the phone's clipboard or clipboard
   history. They should copy only when the page is ready, submit immediately,
   and follow the page's success message.

If Tailscale Serve is unavailable, offer the native Store flow at the host.
Never use Funnel, another public tunnel, email, chat, or a form hosted by
Neorome as a fallback.

## Use

1. Identify the friendly name, purpose, absolute executable path, fixed argument list, and working directory.
2. Prefer a direct executable. Do not use a shell, interpreter command string, `env`, `printenv`, debugging dump, or another target likely to reveal environment variables.
3. Call `keepkeys_run`. KeepKeys shows the exact request in a native confirmation window and retrieves the credential only after the user approves it.
4. Treat output marked `[REDACTED BY KEEPKEYS]` as intentionally unavailable. Never try to reconstruct or encode the secret.
5. A target program and its descendants receive the secret. Use only a target the user intends to trust for this task.

### Always allow

- The native approval window offers **Allow once** and **Always allow this exact command**.
- Always-allow is never a broad name-based bypass. It matches the exact purpose,
  canonical executable path, executable SHA-256 fingerprint, argument array,
  working directory, and interpreter entrypoint fingerprint when present.
- The rule stores metadata only in the operating-system vault. It never stores
  or returns the protected value, and a mismatch or changed fingerprint shows
  the approval window again.
- Use `keepkeys_revoke` when the user wants automatic approvals disabled. It
  requires native confirmation and reports only the number of rules removed.
- `keepkeys_rotate` reuses the existing reviewed metadata, opens the native
  Paste & Store flow for the replacement, and clears old exact-command rules
  when the replacement succeeds. Rotation never accepts a value in the tool
  call.

## List and remove

- `keepkeys_list` returns friendly names, variable names, descriptions,
  providers, and official documentation links so a future task can select and
  use the right credential without reading its value. Call it only when the
  user asks to list KeepKeys metadata or that metadata is necessary to complete
  the user's current authorized task.
- `keepkeys_remove` opens a native destructive-action confirmation. Use it only when the user asks to delete that named secret.
- `keepkeys_rotate` opens the native replacement flow for one existing name and clears its old automatic approvals after a successful replacement.
- `keepkeys_revoke` disables exact-command automatic approvals without deleting the credential.
- `keepkeys_status` checks plugin/helper availability.
- `keepkeys_doctor` performs a temporary native-vault round trip with a generated test value and removes it; it never uses a user secret.

If KeepKeys is unavailable or unsupported, report the exact setup problem. Do not substitute a less safe storage path.

## Cross-device use

KeepKeys supports a deliberate phone-to-host transfer, not silent background
vault replication. `keepkeys_store_from_phone` uses a one-use, ten-minute,
tailnet-only Tailscale Serve page bound to the host's loopback service. It must
use private Serve, never Funnel or a public relay. Give the returned link to the
user without opening, fetching, previewing, or testing it; the user completes
Paste & Store on the authenticated phone. The page is torn down after success,
expiry, cancellation, or failure. This boundary prevents a credential value
from being copied to every device or from becoming agent-readable just because
devices share a tailnet.

## Skills-only distribution fallback

A skills-only distribution may omit local MCP configuration. On macOS, Windows, or Linux, if the `keepkeys_*` tools are not present:

1. Resolve this installed skill's own directory. Use the first existing Node launcher
   from these two exact distribution-relative paths:
   - bundled plugin: `../../scripts/keepkeys-cli.mjs`
   - repository Agent Skill: `../../plugins/keepkeys/scripts/keepkeys-cli.mjs`
   Do not search `PATH`, the home directory, or any other location for a
   `keepkeys` executable.
2. Execute `node ABSOLUTE_LAUNCHER` with an argument array:
   - store: `store --name NAME --variable VARIABLE --description DESCRIPTION --provider PROVIDER --documentation-url URL [--documentation-url URL ...]`
   - store from phone: `portal-store --name NAME --variable VARIABLE --description DESCRIPTION --provider PROVIDER --documentation-url URL [--documentation-url URL ...]`
   - list: `list`
   - rotate: `rotate --name NAME`
   - revoke automatic approvals: `revoke --name NAME`
   - remove: `remove --name NAME`
   - status: `status`
   - doctor: `doctor`
   - run: `run --name NAME --purpose PURPOSE [--cwd ABSOLUTE_DIR] -- ABSOLUTE_PROGRAM ARG...`
3. Quote each argument as data. Do not compose a command string, use `eval`, or pass through a shell executable.

If the surface cannot execute the bundled local launcher, KeepKeys is unsupported there and must fail closed.

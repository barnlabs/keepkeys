# KeepKeys public listing

## Name

KeepKeys

## Developer

BarnLabs

## Category

Productivity

## Short description

Local secrets for approved agent commands and private phone intake.

## Long description

KeepKeys lets coding agents use named developer secrets without receiving their
plaintext values. The agent researches official credential documentation and
prepares the friendly name, environment variable, description, provider, and
documentation links. The user only copies the key and presses **Paste & Store**;
the native helper reads the clipboard on that explicit click and stores the
value in macOS Keychain, Windows Credential Manager, or Linux Secret Service.
When the agent runs on a Tailscale-connected computer, the user may instead
open a ten-minute, one-use page from a phone in the same tailnet. The page
sends the value straight to that computer's native vault. It does not use
Tailscale Funnel or a BarnLabs server.
Each use requires native one-time approval showing the purpose, risk class,
exact program, arguments, directory, metadata, executable SHA-256, and detected
script fingerprint. KeepKeys never offers a plaintext retrieval tool.

## Website

https://github.com/barnlabs/keepkeys

## Support

https://github.com/barnlabs/keepkeys/issues

## Privacy

https://github.com/barnlabs/keepkeys/blob/main/docs/privacy-and-data-handling.md

## Terms

https://github.com/barnlabs/keepkeys/blob/main/TERMS.md

## Availability

macOS 13+, Windows 10/11, and desktop Linux. Codex desktop app, Codex CLI, and
ChatGPT mobile Remote through a connected Mac or Windows host. English listing
at initial submission. Linux secure entry and approval require a graphical
session and compatible Secret Service. Phone intake requires Tailscale on the
host and phone, both signed into the same tailnet.

# Changelog

## 0.5.0 — 2026-07-28

- Added `keepkeys_store_from_phone`, which returns a ten-minute, one-use
  Tailscale Serve link for storing a key from a phone in the same tailnet.
- Kept phone intake off the public internet: the route uses Tailscale Serve,
  never Funnel, and forwards only to a temporary localhost listener.
- Bound each phone page to one authenticated Tailscale identity, one secure
  browser cookie, an exact origin, and one submission.
- Added browser content limits, a strict Content Security Policy, no external
  page resources, and fail-closed replacement-race checks in every native
  backend.
- Made both successful and failed native-vault submissions terminal so the
  session-owned listener and Serve route cannot be reused after one attempt.
- Bound the first page open to its original browser cookie, claimed the first
  authenticated POST before reading its body, and made malformed authenticated
  submissions terminal.
- Serialized same-name desktop and phone stores through one per-name
  coordinator, preventing a concurrent native store from bypassing the
  replacement state shown on the phone.
- Reject native desktop store dispatch that bypasses that coordinator, and
  abort the in-flight native helper when the session expires or terminates.
- Scheduled teardown from the advertised expiry and require confirmed native
  helper and Tailscale Serve process exit plus exact owned-route absence before
  cleanup can report success.
- Cancel and await both metadata and Tailscale startup operations after either
  fails, await Serve termination even when route verification fails, and stop
  retaining Serve output after its readiness message.
- Keep the detached portal tied to its launcher until the launcher explicitly
  accepts the ready link. A cancelled or terminated launcher aborts startup,
  stops the owned Serve process, and verifies exact route removal.
- Continue watching the foreground Serve process after readiness. If it exits
  before link delivery, during launcher acknowledgment, or later in the
  session, KeepKeys closes the portal instead of advertising a dead route
  until expiry.
- Hold the phone success response until the owned Serve process and exact route
  are gone. If storage succeeds but that cleanup fails, the page says the key
  was stored and reports the cleanup failure instead of showing a false
  success.
- Preserve unconfirmed native-helper termination as a teardown failure after
  the helper promise settles, and roll back Linux value writes when the
  following metadata subprocess times out or otherwise fails.
- Report Linux rollback deletion failures instead of treating a failed delete
  as successful, while still attempting both value and metadata cleanup.
- Propagate Linux Secret Service search and existing-value lookup errors
  instead of treating an unavailable vault as a confirmed missing record.
- Return a structured uncertain state to the phone when Linux storage and
  rollback both fail, so the page never claims a possibly retained value was
  discarded.
- Return the same structured uncertain state when Windows Credential Manager
  storage and rollback both fail, while attempting both halves of the paired
  record rollback.
- Require both generated Linux portal items to be deleted before native CI can
  report cleanup success.
- Preserve a successful native-vault write when closing or removing the portal
  commit lock fails: the phone receives `stored: true` with the cleanup error,
  and the session cannot report a false storage failure.
- Preserve native-vault uncertainty when rollback and commit-lock cleanup both
  fail, reporting both cleanup problems without claiming the value was stored
  or discarded.
- Treat helper termination, malformed JSON, or an inconsistent response
  without a valid native commit receipt as uncertain instead of claiming the
  value was discarded.
- Give concurrent startup helpers independent process groups so sibling
  cancellation terminates and awaits their descendants.
- Enforce the 8-byte minimum with UTF-8 byte counting in JavaScript and on the
  server instead of an HTML character-count minimum.
- Made the no-script form fail closed: controls remain disabled and the
  password field has no serializable HTML name until the safe JavaScript POST
  path is active.
- Sent the submitted value through redirected standard input to a private
  native helper action that requires a capability frame and the exact bundled
  portal parent, without placing the value in model context, tool payloads,
  command arguments, files, logs, or persistent environment variables.
- Added deterministic portal tests, a capability-framed generated UTF-8
  portal-to-vault round trip plus create-to-replace and replace-to-create race
  rejection on macOS, Windows, and Linux CI, and a real tailnet-to-macOS
  Keychain smoke with verified route, process, record, and temporary-file
  cleanup.
- Made the skills-only and source archives byte-for-byte reproducible, with a
  CI rebuild check that rejects changing SHA-256 digests.
- Updated the Agent Skill, MCP and Hermes adapters, installation guidance,
  threat model, privacy notice, compatibility matrix, and public submission
  materials for the seven-tool contract.

## 0.4.2 — 2026-07-25

- Replaced editable store metadata and password typing with one explicit
  **Paste & Store** action; the native helper reads the clipboard only after
  that click and clears the current clipboard immediately after capture.
- Validates all agent-prepared metadata before any native window opens, closing
  the invalid-name correction loop and regressing the valid `new-key` case.
- Added agent-researched provider and official HTTPS documentation links to the
  cross-platform tool, vault-metadata, list, and UI contracts.
- Preserves existing version-1 macOS and Linux metadata records while writing
  version-2 metadata for new credentials.
- Added positive, negative, and cross-platform parity tests for documentation
  links, clipboard-trigger language, and agent-owned fields.
- Hardened post-approval Windows metadata rechecks, compact-display scrolling,
  malformed metadata handling, and version-1 Linux rollback after adversarial
  review.
- Made the shared-clipboard limitation explicit, added compact-screen Linux
  scrolling, and made long macOS metadata fully reviewable.
- Added executable macOS and Windows Paste & Store boundary tests for successful
  capture plus rejected input that must clear the clipboard and skip storage.
- Made malformed Linux documentation URLs fail through structured JSON and
  excluded local build/cache artifacts from source packages.
- Aligned MCP and Hermes provider validation with native UTF-8 byte limits,
  enforced Windows Credential Manager's serialized metadata ceiling before UI,
  and preserved case-distinct official documentation URLs.

## 0.4.1 — 2026-07-24

- Added a deliberate, strict-schema update checker that reports immutable
  functional and catalog commits without downloading or installing code.
- Added project-level design, production-checklist, agent, and independent
  code-review contracts, including a bounded adversarial repair loop.
- Added a full MCP stdio transcript regression and local documentation-link
  validation.
- Rejects every undeclared MCP or Hermes argument before native-helper launch
  and fixes the Linux dispatcher to the trusted system Python path.
- Added a primary-source host-contract ledger, including an immutable OMP
  marketplace specification snapshot and explicit proof boundaries.
- Reworked the Windows scoped-process self-test to use a fixed compiled probe,
  keeping the test independent of Node.js and shell environment behavior.
- Added a single required CI release gate and expanded packages to carry the
  update checker and release-governance artifacts.
- Refreshed public issue, pull-request, support, privacy, release, and update
  documentation for macOS, Windows, and Linux.

## 0.4.0 — 2026-07-24

- Added native Windows support with WPF secure entry, paired metadata/value
  Credential Manager records, approval-before-value-read, transactional
  replacement rollback, direct process execution, and bounded redaction.
- Added native desktop Linux support with Tk secure entry, freedesktop Secret
  Service storage, metadata-only label search, fail-closed prerequisite checks,
  direct process execution, and bounded redaction.
- Hardened macOS Run so Keychain value data is not requested until after
  one-time approval and metadata is rechecked before launch.
- Added executable risk labels and separately fingerprinted interpreter
  entrypoints on all three platforms.
- Added one cross-platform dispatcher and CLI used by MCP, Hermes, and
  skills-only packages.
- Expanded CI to macOS, Windows, and Ubuntu across Node.js 18 and 22, with a
  temporary native-vault round trip on every operating system.
- Rewrote the architecture, threat model, privacy, compatibility, installation,
  and security guidance around the three-platform boundary.

## 0.3.0 — 2026-07-24

- Standardized the product as **KeepKeys** with `keepkeys` as the lowercase
  internal slug required by plugin hosts.
- Added a native Grok Build plugin manifest, BarnLabs Grok marketplace catalog,
  exact-SHA install guidance, and local Grok validation.
- Replaced the generic lock branding with the original Keykeeper character: a
  capable old steward carrying a visible ring of keys.
- Refreshed the README hero, plugin icons, social preview, brand guidelines,
  client matrix, architecture, packaging, and GitHub search metadata.
- Preserved the same six tools, native Keychain core, no-plaintext boundary,
  direct execution path, and logical Keychain deletion behavior.

## 0.2.0 — 2026-07-24

- Expanded KeepKeys from a Codex-only package to native plugin/extension surfaces for Claude Code, Oh My Pi, Hermes, and Gemini CLI.
- Added a standard Agent Skill package for other compatible clients.
- Moved all tool schemas into one shared JSON contract used by both MCP and the thin Hermes bridge.
- Preserved the single Swift/AppKit/Keychain core for secure entry, approval, deletion, direct execution, and redaction.
- Added cross-client manifest, version, skill, and no-shell validation plus Hermes contract tests.
- Added a unified source archive and checksum for multi-client distribution.
- Rebuilt the public repository with a new hero, support matrix, compatibility proof, governance, maintainers, roadmap, release runbook, and repository-design rationale.

## 0.1.1 — 2026-07-24

- Fixed the plugin MCP launch directory so a newly started Codex task loads the six `keepkeys_*` tools from the installed plugin instead of requiring the skills-only fallback.

## 0.1.0 — 2026-07-24

- Added the BarnLabs KeepKeys Codex plugin and repository marketplace.
- Added native macOS secure entry, overwrite, removal, and per-command approval.
- Added device-local macOS Keychain storage with no plaintext retrieval tool.
- Added direct, empty-environment child execution with executable hashing and bounded output redaction.
- Added MCP tool annotations, plugin skill, headless tests, Keychain doctor, threat model, privacy policy, install guidance, and public-submission materials.

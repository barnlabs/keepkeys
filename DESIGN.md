# KeepKeys design

## Product contract

KeepKeys is for a person using a desktop coding agent who needs the agent to
perform one credentialed command without giving the model a reusable plaintext
credential. The product is the plugin and its native approval boundary—not a
cloud vault, account system, daemon, or standalone password manager.

The core sentence is:

> You paste once. Your key stays out of chat and tool payloads.

Every interface must make three facts obvious:

1. which named credential is involved;
2. exactly which executable and arguments will receive it;
3. whether the current action stores, uses, replaces, or removes the value.

## Experience

### Store

The agent asks only for missing non-secret context, researches official
credential documentation, and supplies a stable name, uppercase variable name,
useful description, provider, and one to three official HTTPS documentation
links. KeepKeys validates that metadata before opening and renders it read-only.

The user copies the key from the provider and presses **Paste & Store**. The
native helper reads the clipboard only in direct response to that click,
immediately clears the current clipboard, stores the exact value in the
operating-system vault, and never returns it through the agent protocol.
Replacement requires an explicit warning. Because the system clipboard is
shared with same-user software and may have operating-system history, the
interface tells the user to copy immediately before clicking and does not claim
clipboard isolation.

### Use

The approval window shows risk class, purpose, friendly name, variable,
description, canonical executable, SHA-256, arguments, working directory,
environment scope, and interpreter entrypoint fingerprint when applicable.
**Allow once** is primary; **Cancel** is always available and safe.

### Remove

Removal shows the reusable metadata, names the native vault, and explains that
the logical deletion cannot be undone by KeepKeys. The agent cannot bypass the
native confirmation.

### Failure

Errors name the unavailable prerequisite or failed invariant without exposing
credential values, parent environment, vault contents, or raw captured output.
There is no fallback to a terminal password prompt or plaintext file.

## Visual identity

The Keykeeper is a dignified older steward with a silver beard, deep-pine coat,
barn-ember scarf, and a substantial ring of aged-brass keys. The ring is the
focal point: separate named authority, held locally and handed over only for an
approved task.

| Token | Value | Role |
| --- | --- | --- |
| Deep pine | `#1F2D27` | Primary type and trusted surfaces |
| Night pine | `#14211D` | Hero and dark background |
| Barn ember | `#D96C4D` | Primary action and restrained emphasis |
| Aged brass | `#C79A45` | Key ring and metadata accent |
| Warm paper | `#FFF8EC` | Light surface |
| Field sage | `#41544C` | Supporting copy |

Use the original raster assets in `plugins/keepkeys/assets/`. Do not replace
the Keykeeper with a generic lock, shield, key emoji, stock character, or
hand-drawn substitute. Do not stretch, mirror, recolor, obscure the face or key
ring, or place text over the character.

The public repository uses `social-preview.png` as its visual opening, followed
immediately by the promise, platform proof, and security boundary. Native
windows use the Keykeeper art at a restrained size so the decision—not the
mascot—remains dominant. Detailed asset rules live in
[brand-guidelines.md](plugins/keepkeys/assets/brand-guidelines.md).

## Interaction and accessibility

- Use a native button as the only clipboard trigger; metadata is readable and
  selectable but never editable.
- Provide visible labels; placeholders never carry required meaning.
- Preserve readable contrast with text on warm paper or night pine.
- Keep destructive actions visually distinct and never preselected.
- Do not depend on hover, animation, color alone, or pointer input.
- Keep approval details selectable/readable without making the secret visible.
- Explain directly beside the action that clipboard access occurs only after
  **Paste & Store**.
- Support platform scaling and long but valid descriptions without clipping the
  action buttons.

## Cross-platform parity

macOS AppKit/Keychain, Windows WPF/Credential Manager, and desktop Linux
Tk/Secret Service may use native conventions, but they share one information
hierarchy, validation contract, approval timing, failure policy, and product
language. Platform divergence is acceptable only where the operating-system
security primitive requires it and the compatibility document explains it.

## Design acceptance

A visible release is accepted only when the assets exist at their declared
paths, manifests resolve their light/dark/icon crops, native layouts compile,
headless state tests pass, representative platform rendering has been reviewed
when available, and accessibility/failure behavior is documented. Automated
screenshots are useful evidence but never proof of secret-boundary correctness.

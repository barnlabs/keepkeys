# Publish KeepKeys in the Codex plugin directory

This is the handoff for the BarnLabs publisher. It follows the official OpenAI
plugin submission workflow reviewed on 2026-07-28 and keeps account-owned
attestations with a human publisher.

## Choose the correct submission type

Submit KeepKeys as **Skills only** for its first public-directory review.

The repository edition includes a local stdio MCP server, but KeepKeys has no
public production MCP URL. OpenAI's **With MCP** path requires a publicly
reachable production server and domain verification. Do not deploy a cloud
secret service or select **With MCP** merely to satisfy that form; doing so
would contradict KeepKeys' local-host design.

The skills-only package carries the Agent Skill, native helper sources,
launcher, brand assets, license, privacy notice, and terms. The skill uses the
local launcher when the client has no `keepkeys_*` MCP tools.

## Publisher prerequisites

Before opening the portal, the BarnLabs Platform organization must have:

1. a publisher with **Apps Management: Write** permission;
2. completed developer or business identity verification;
3. authority to accept OpenAI's policy, data, and listing attestations for
   BarnLabs.

Those are account-owned decisions. Repository automation must not claim or
accept them.

## Build and verify the upload

From a reviewed checkout:

```sh
./scripts/check
./scripts/test
./scripts/package-submission
(cd dist && shasum -a 256 -c keepkeys-skills-0.5.0.zip.sha256)
```

Upload:

`dist/keepkeys-skills-0.5.0.zip`

Expected SHA-256:

`3b3d96004c7974b456e600fb6f08477c3934745a85d6147d025afcb3c8f34835`

The packaging gate verifies that the archive has the plugin manifest, skill,
native helper sources, phone portal, launcher, brand assets, policies, and
executable bit. It also rebuilds both archives and compares their SHA-256
digests, and verifies that a skills-only upload contains no MCP configuration
or MCP server directory.

## Portal fields

Open the [OpenAI plugin submission portal](https://platform.openai.com/plugins)
and use:

| Field | Value |
| --- | --- |
| Submission type | Skills only |
| Name | KeepKeys |
| Developer | BarnLabs |
| Category | Productivity |
| Website | `https://github.com/barnlabs/keepkeys` |
| Support | `https://github.com/barnlabs/keepkeys/blob/main/.github/SUPPORT.md` |
| Privacy | `https://github.com/barnlabs/keepkeys/blob/main/docs/privacy-and-data-handling.md` |
| Terms | `https://github.com/barnlabs/keepkeys/blob/main/TERMS.md` |
| Logo | `plugins/keepkeys/assets/logo.png` |
| Dark logo | `plugins/keepkeys/assets/logo-dark.png` |
| Composer icon | `plugins/keepkeys/assets/icon.png` |

Copy the reviewed short and long descriptions from
[listing.md](listing.md), the release notes from
[release-notes.md](release-notes.md), and the prompts from
`plugins/keepkeys/.codex-plugin/plugin.json`. Do not add claims that KeepKeys
reveals, exports, synchronizes, or remotely stores secrets.

## Required evaluation cases

Enter all eight cases in [test-cases.md](test-cases.md):

- five positive cases covering explicit native paste, private phone intake,
  metadata listing, approved direct use, and confirmed removal;
- three negative cases covering a pasted secret, plaintext retrieval, and
  environment-dump or shell use.

Use only the synthetic values in that file. Never enter a production
credential into the portal, a test prompt, a screenshot, or reviewer notes.

## Review before submit

Verify the rendered listing:

- the public name is **KeepKeys** and the internal slug is `keepkeys`;
- BarnLabs is the publisher;
- the Keykeeper old-man-with-key-ring artwork is crisp in light and dark
  surfaces;
- macOS, Windows, and Linux support is stated with the Linux desktop/Secret
  Service prerequisite;
- the local-host, no-account, no-telemetry, and no-plaintext-retrieval
  boundaries are present, with the optional tailnet-only phone route described
  separately;
- release notes say 0.5.0;
- ChatGPT mobile Remote is described as using a connected Mac or Windows host,
  not as a hosted BarnLabs service;
- every URL resolves to the public BarnLabs repository;
- the upload is the freshly checksummed skills archive.

Then review the policy and data attestations as the BarnLabs publisher and
submit. OpenAI review and directory publication are external states; record the
submission ID and final decision in `CHECKLIST.md` only after the portal shows
them.

## After approval

1. Install from the public directory in a disposable conversation.
2. Run the five positive and three negative cases using synthetic data.
3. Confirm the generated record is removed from the native vault.
4. Confirm uninstall leaves no plugin files in the disposable profile and does
   not silently remove unrelated vault records.
5. Capture the listing URL and test evidence without secret values.
6. Run a separate adversarial listing/security review before marking the
   submission checklist complete.

## Official references

- [Build plugins](https://developers.openai.com/plugins/build/plugins)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [ChatGPT Remote](https://learn.chatgpt.com/docs/remote-connections)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Plugin submission portal](https://platform.openai.com/plugins)

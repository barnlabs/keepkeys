# KeepKeys public submission

This directory contains the Neorome publisher handoff, reviewed listing copy,
release notes, and the required five positive plus three negative evaluation
cases for an OpenAI public plugin submission.

Start with [codex-market-guide.md](codex-market-guide.md).

## Distribution boundary

- The Neorome repository marketplace is the complete KeepKeys distribution. It includes the local MCP server and native helper source.
- The public submission ZIP is skills-only because the submission portal accepts skills, scripts, and assets but not a local MCP configuration. Its skill calls the bundled launcher directly when `keepkeys_*` MCP tools are unavailable.
- Repository publication and a prepared ZIP do not mean that OpenAI has reviewed, approved, or listed KeepKeys.
- A verified Neorome publisher must review the policy attestations and submit the ZIP at the portal. That human-owned step has not been represented as complete.

## Current official references

Checked July 25, 2026:

- [Build plugins](https://developers.openai.com/plugins/build/plugins)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [Plugin submission portal](https://platform.openai.com/plugins)

#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parse = (relative) =>
  JSON.parse(readFileSync(resolve(root, relative), "utf8"));
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const codex = parse("plugins/keepkeys/.codex-plugin/plugin.json");
const claude = parse("plugins/keepkeys/.claude-plugin/plugin.json");
const claudeMcp = parse("plugins/keepkeys/.mcp.claude.json");
const claudeMarketplace = parse(".claude-plugin/marketplace.json");
const ompMarketplace = parse(".omp-plugin/marketplace.json");
const grok = parse("plugins/keepkeys/.grok-plugin/plugin.json");
const grokMcp = parse("plugins/keepkeys/.mcp.grok.json");
const grokMarketplace = parse(".grok-plugin/marketplace.json");
const gemini = parse("gemini-extension.json");
const tools = parse("plugins/keepkeys/mcp/tools.json");
const update = parse("update.json");

const version = codex.version;
const releaseCommit = "9335564192b5d505d618a8413b84a9e2e6969b12";
const catalogCommit = "85c958738cef2f907b226622382cc2fe5276c4da";
assert.equal(version, "0.5.0");
const expectedUpdate =
  update.sourceCommit === releaseCommit
    ? {
        schemaVersion: 1,
        product: "KeepKeys",
        channel: "stable",
        version,
        sourceCommit: releaseCommit,
        catalogCommit,
        installGuide: "https://github.com/barnlabs/keepkeys/blob/main/INSTALL.md",
        releaseNotes: "https://github.com/barnlabs/keepkeys/blob/main/CHANGELOG.md",
      }
    : {
        schemaVersion: 1,
        product: "KeepKeys",
        channel: "stable",
        version: "0.5.0",
        sourceCommit: "7eba25e76778337cbcc3aff68dd9e3cbc843a31d",
        catalogCommit: "c046ff9c04b28b57a5c3a6c206389b4fa467046e",
        installGuide: "https://github.com/barnlabs/keepkeys/blob/main/INSTALL.md",
        releaseNotes: "https://github.com/barnlabs/keepkeys/blob/main/CHANGELOG.md",
      };
assert.deepEqual(update, expectedUpdate);
assert.equal(claude.version, version);
assert.equal(grok.version, version);
assert.equal(claudeMarketplace.version, version);
assert.equal(
  claudeMarketplace.plugins[0].version,
  undefined,
  "plugin version belongs in plugin.json so client caches have one source of truth",
);
assert.deepEqual(
  ompMarketplace,
  claudeMarketplace,
  "OMP and Claude Code marketplaces must describe the same release",
);
const installGuide = read("INSTALL.md");
for (const command of [
  "omp plugin marketplace add",
  "omp plugin install keepkeys@barnlabs",
  "omp plugin list",
]) {
  assert.match(
    installGuide,
    new RegExp(command.replaceAll(" ", "\\s+")),
    `OMP install guide is missing ${command}`,
  );
}
const hostEvidence = read("docs/host-contract-evidence.md");
assert.match(
  hostEvidence,
  /15184332b8dbb58e8fb66e874fe1ed27134f880e/,
  "OMP compatibility must cite the immutable reviewed specification",
);
assert.match(hostEvidence, /git-subdir/);
assert.match(hostEvidence, /source: "git-subdir"/);

assert.equal(claude.name, "keepkeys");
assert.equal(claude.displayName, "KeepKeys");
assert.equal(claude.skills, "./skills/");
assert.equal(claude.mcpServers, "./.mcp.claude.json");
assert.deepEqual(claudeMcp.mcpServers.keepkeys, {
  command: "node",
  args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs", "--stdio"],
  cwd: "${CLAUDE_PLUGIN_ROOT}",
});
assert.equal(claudeMarketplace.name, "barnlabs");
assert.equal(claudeMarketplace.plugins[0].displayName, "KeepKeys");
assert.deepEqual(claudeMarketplace.plugins[0].source, {
  source: "git-subdir",
  url: "https://github.com/barnlabs/keepkeys.git",
  path: "plugins/keepkeys",
  ref: "main",
  sha: releaseCommit,
});
assert.equal(claudeMarketplace.plugins[0].category, "security");

assert.equal(grok.name, "keepkeys");
assert.equal(grok.skills, "./skills/");
assert.equal(grok.mcpServers, "./.mcp.grok.json");
assert.deepEqual(grokMcp.mcpServers.keepkeys, {
  command: "node",
  args: ["${GROK_PLUGIN_ROOT}/mcp/server.mjs", "--stdio"],
  cwd: "${GROK_PLUGIN_ROOT}",
});
assert.equal(grokMarketplace.name, "barnlabs");
assert.equal(grokMarketplace.plugins[0].name, "keepkeys");
assert.equal(grokMarketplace.plugins[0].version, version);
assert.deepEqual(grokMarketplace.plugins[0].source, {
  type: "local",
  path: "./plugins/keepkeys",
});
assert.ok(
  grokMarketplace.plugins[0].description.startsWith("KeepKeys "),
  "Grok marketplace copy must use the KeepKeys brand",
);

assert.equal(gemini.name, "keepkeys");
assert.equal(gemini.version, version);
assert.deepEqual(gemini.mcpServers.keepkeys, {
  command: "node",
  args: [
    "${extensionPath}${/}plugins${/}keepkeys${/}mcp${/}server.mjs",
    "--stdio",
  ],
  cwd: "${extensionPath}${/}plugins${/}keepkeys",
});

const pluginYaml = read("plugin.yaml");
assert.match(pluginYaml, /^name: keepkeys$/m);
assert.match(pluginYaml, new RegExp(`^version: "${version.replaceAll(".", "\\.")}"$`, "m"));
for (const tool of tools) {
  assert.match(pluginYaml, new RegExp(`^  - ${tool.name}$`, "m"));
}

assert.equal(
  read("skills/keepkeys/SKILL.md"),
  read("plugins/keepkeys/skills/keepkeys/SKILL.md"),
  "root Agent Skill and bundled plugin skill must stay identical",
);
assert.match(read("adapters/hermes/plugin.py"), /ctx\.register_skill\("keepkeys", _SKILL\)/);
assert.doesNotMatch(read("adapters/hermes/plugin.py"), /shell\s*=\s*True/);
for (const helper of [
  "plugins/keepkeys/scripts/keepkeys.swift",
  "plugins/keepkeys/scripts/keepkeys.windows.ps1",
  "plugins/keepkeys/scripts/keepkeys.linux.py",
  "plugins/keepkeys/scripts/keepkeys-cli.mjs",
  "plugins/keepkeys/scripts/keepkeys-portal.mjs",
  "plugins/keepkeys/scripts/platform.mjs",
]) {
  assert.ok(read(helper).length > 0, `${helper} is missing`);
}
for (const document of ["README.md", "INSTALL.md"]) {
  assert.match(read(document), new RegExp(expectedUpdate.sourceCommit, "g"));
  assert.match(read(document), new RegExp(expectedUpdate.catalogCommit, "g"));
}

for (const tool of tools) {
  assert.match(tool.name, /^keepkeys_[a-z_]+$/);
  assert.equal(tool.inputSchema.additionalProperties, false);
  const properties = Object.keys(tool.inputSchema.properties);
  assert.equal(properties.includes("secret"), false, `${tool.name} accepts a secret`);
  assert.equal(properties.includes("value"), false, `${tool.name} accepts a value`);
}

process.stdout.write(
  "KeepKeys Codex, Grok Build, Claude Code, Oh My Pi, Hermes, Gemini CLI, and Agent Skills adapters are structurally valid.\n",
);

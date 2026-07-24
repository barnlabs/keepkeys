#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parse = (relative) =>
  JSON.parse(readFileSync(resolve(root, relative), "utf8"));
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const codex = parse("plugins/keep-keys/.codex-plugin/plugin.json");
const claude = parse("plugins/keep-keys/.claude-plugin/plugin.json");
const claudeMcp = parse("plugins/keep-keys/.mcp.claude.json");
const claudeMarketplace = parse(".claude-plugin/marketplace.json");
const ompMarketplace = parse(".omp-plugin/marketplace.json");
const gemini = parse("gemini-extension.json");
const tools = parse("plugins/keep-keys/mcp/tools.json");

const version = codex.version;
const releaseCommit = "243ffd36702d4961932538e55e7b01e95e372a84";
const catalogCommit = "6fb515c5edb7065e90efb8ce653139544388da80";
assert.equal(version, "0.2.0");
assert.equal(claude.version, version);
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

assert.equal(claude.name, "keep-keys");
assert.equal(claude.skills, "./skills/");
assert.equal(claude.mcpServers, "./.mcp.claude.json");
assert.deepEqual(claudeMcp.mcpServers.keepkeys, {
  command: "node",
  args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs", "--stdio"],
  cwd: "${CLAUDE_PLUGIN_ROOT}",
});
assert.equal(claudeMarketplace.name, "barnlabs");
assert.deepEqual(claudeMarketplace.plugins[0].source, {
  source: "git-subdir",
  url: "https://github.com/barnlabs/keep-keys.git",
  path: "plugins/keep-keys",
  ref: "main",
  sha: releaseCommit,
});
assert.equal(claudeMarketplace.plugins[0].category, "security");

assert.equal(gemini.name, "keep-keys");
assert.equal(gemini.version, version);
assert.deepEqual(gemini.mcpServers.keepkeys, {
  command: "node",
  args: [
    "${extensionPath}${/}plugins${/}keep-keys${/}mcp${/}server.mjs",
    "--stdio",
  ],
  cwd: "${extensionPath}${/}plugins${/}keep-keys",
});

const pluginYaml = read("plugin.yaml");
assert.match(pluginYaml, /^name: keep-keys$/m);
assert.match(pluginYaml, new RegExp(`^version: "${version.replaceAll(".", "\\.")}"$`, "m"));
for (const tool of tools) {
  assert.match(pluginYaml, new RegExp(`^  - ${tool.name}$`, "m"));
}

assert.equal(
  read("skills/keep-keys/SKILL.md"),
  read("plugins/keep-keys/skills/keep-keys/SKILL.md"),
  "root Agent Skill and bundled plugin skill must stay identical",
);
assert.match(read("adapters/hermes/plugin.py"), /ctx\.register_skill\("keep-keys", _SKILL\)/);
assert.doesNotMatch(read("adapters/hermes/plugin.py"), /shell\s*=\s*True/);
for (const document of ["README.md", "INSTALL.md"]) {
  assert.match(read(document), new RegExp(releaseCommit, "g"));
  assert.match(read(document), new RegExp(catalogCommit, "g"));
}

for (const tool of tools) {
  assert.match(tool.name, /^keepkeys_[a-z_]+$/);
  assert.equal(tool.inputSchema.additionalProperties, false);
  const properties = Object.keys(tool.inputSchema.properties);
  assert.equal(properties.includes("secret"), false, `${tool.name} accepts a secret`);
  assert.equal(properties.includes("value"), false, `${tool.name} accepts a value`);
}

process.stdout.write(
  "KeepKeys Codex, Claude Code, Oh My Pi, Hermes, Gemini CLI, and Agent Skills adapters are structurally valid.\n",
);

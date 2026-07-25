#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TOOLS } from "../plugins/keepkeys/mcp/server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugins", "keepkeys");
const attributes = readFileSync(resolve(root, ".gitattributes"), "utf8");
assert.match(
  attributes,
  /^\* text=auto eol=lf$/m,
  "Git text checkouts must use LF so signed helper sources are portable",
);
const manifestPath = resolve(pluginRoot, ".codex-plugin", "plugin.json");
const marketplacePath = resolve(root, ".agents", "plugins", "marketplace.json");
const mcpPath = resolve(pluginRoot, ".mcp.json");

const parse = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = parse(manifestPath);
const marketplace = parse(marketplacePath);
const mcp = parse(mcpPath);

assert.equal(manifest.name, "keepkeys");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.mcpServers, "./.mcp.json");
assert.equal(manifest.author.name, "BarnLabs");
assert.equal(manifest.license, "Apache-2.0");
assert.ok(Array.isArray(manifest.interface.defaultPrompt));
assert.ok(manifest.interface.defaultPrompt.length <= 3);

for (const prompt of manifest.interface.defaultPrompt) {
  assert.ok(prompt.length <= 128, "default prompts must be at most 128 characters");
}

for (const field of ["composerIcon", "logo", "logoDark"]) {
  const relative = manifest.interface[field];
  assert.ok(relative.startsWith("./assets/"), `${field} must stay inside plugin assets`);
  assert.ok(existsSync(resolve(pluginRoot, relative)), `${field} file is missing`);
}

assert.equal(marketplace.name, "barnlabs");
const entry = marketplace.plugins.find((plugin) => plugin.name === "keepkeys");
assert.ok(entry, "marketplace entry is missing");
assert.equal(entry.source.source, "local");
assert.equal(entry.source.path, "./plugins/keepkeys");
assert.equal(entry.policy.installation, "AVAILABLE");
assert.equal(entry.policy.authentication, "ON_INSTALL");
assert.equal(entry.category, "Productivity");

assert.equal(mcp.mcpServers.keepkeys.command, "node");
assert.equal(mcp.mcpServers.keepkeys.cwd, ".");
assert.deepEqual(mcp.mcpServers.keepkeys.args, ["./mcp/server.mjs", "--stdio"]);

for (const tool of TOOLS) {
  assert.match(tool.name, /^keepkeys_[a-z_]+$/);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
  assert.equal(typeof tool.annotations.openWorldHint, "boolean");
  assert.equal(typeof tool.annotations.destructiveHint, "boolean");
  const properties = Object.keys(tool.inputSchema.properties);
  assert.equal(properties.includes("secret"), false, `${tool.name} accepts a secret`);
  assert.equal(properties.includes("value"), false, `${tool.name} accepts a value`);
}

const storeTool = TOOLS.find((tool) => tool.name === "keepkeys_store");
assert.ok(storeTool, "keepkeys_store is missing");
assert.deepEqual(storeTool.inputSchema.required, [
  "name",
  "variable",
  "description",
  "provider",
  "documentation_urls",
]);

const skill = readFileSync(
  resolve(pluginRoot, "skills", "keepkeys", "SKILL.md"),
  "utf8",
).replaceAll("\r\n", "\n");
assert.match(skill, /^---\nname: keepkeys\n/m);
assert.match(skill, /Never ask the user to paste, type, dictate, attach, or expose a secret in chat/);
assert.match(skill, /Paste & Store/);
assert.match(skill, /AI-readable official\s+documentation/);

const launcher = readFileSync(resolve(pluginRoot, "scripts", "keepkeys"), "utf8");
const source = readFileSync(resolve(pluginRoot, "scripts", "keepkeys.swift"));
const sourceText = source.toString("utf8");
const windowsHelper = readFileSync(
  resolve(pluginRoot, "scripts", "keepkeys.windows.ps1"),
  "utf8",
);
const linuxHelper = readFileSync(
  resolve(pluginRoot, "scripts", "keepkeys.linux.py"),
  "utf8",
);
for (const [platform, helper, trigger] of [
  ["macOS", sourceText, "NSPasteboard.general.string"],
  ["Windows", windowsHelper, "[Windows.Clipboard]::GetText()"],
  ["Linux", linuxHelper, "window.clipboard_get()"],
]) {
  assert.match(helper, /Paste & Store/, `${platform} is missing the explicit paste action`);
  assert.ok(helper.includes(trigger), `${platform} is missing click-gated clipboard access`);
  assert.doesNotMatch(
    helper,
    /NSSecureTextField|Windows\.Controls\.PasswordBox|secret=True/,
    `${platform} still exposes manual secret entry`,
  );
}
for (const helper of [sourceText, windowsHelper, linuxHelper]) {
  assert.match(helper, /new-key/, "valid new-key regression is missing");
  assert.match(helper, /https:\/\/docs\./, "documentation URL validation test is missing");
}
const expectedSourceHash = launcher.match(/^expected_source_hash="([a-f0-9]{64})"$/m)?.[1];
assert.ok(expectedSourceHash, "launcher source-integrity digest is missing");
assert.equal(createHash("sha256").update(source).digest("hex"), expectedSourceHash);
for (const relative of [
  "scripts/keepkeys-cli.mjs",
  "scripts/keepkeys.linux.py",
  "scripts/keepkeys.windows.ps1",
  "scripts/platform.mjs",
]) {
  assert.ok(existsSync(resolve(pluginRoot, relative)), `${relative} is missing`);
}
const platformDispatcher = readFileSync(
  resolve(pluginRoot, "scripts", "platform.mjs"),
  "utf8",
);
for (const [constant, relative] of [
  ["WINDOWS_HELPER_SHA256", "scripts/keepkeys.windows.ps1"],
  ["LINUX_HELPER_SHA256", "scripts/keepkeys.linux.py"],
]) {
  const expected = platformDispatcher.match(
    new RegExp(`const ${constant} =\\s*\\n?\\s*"([a-f0-9]{64})"`),
  )?.[1];
  assert.ok(expected, `${constant} is missing`);
  const helper = readFileSync(resolve(pluginRoot, relative), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  assert.equal(
    createHash("sha256").update(helper, "utf8").digest("hex"),
    expected,
    `${relative} failed its pinned source-integrity check`,
  );
}

const testCases = readFileSync(resolve(root, "submission", "test-cases.md"), "utf8");
assert.equal((testCases.match(/^## Positive /gm) ?? []).length, 5);
assert.equal((testCases.match(/^## Negative /gm) ?? []).length, 3);

process.stdout.write("KeepKeys plugin structure and security invariants are valid.\n");

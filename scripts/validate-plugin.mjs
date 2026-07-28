#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TOOLS } from "../plugins/keepkeys/mcp/server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugins", "keepkeys");
const agentRules = readFileSync(resolve(root, "AGENTS.md"), "utf8");
assert.match(
  agentRules,
  /provider names, documentation links/,
  "Agent metadata allowlist must cover provider names and documentation links",
);
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
const storeFields = [
  "name",
  "variable",
  "description",
  "provider",
  "documentation_urls",
];
assert.deepEqual(storeTool.inputSchema.required, storeFields);
const phoneStoreTool = TOOLS.find(
  (tool) => tool.name === "keepkeys_store_from_phone",
);
assert.ok(phoneStoreTool, "keepkeys_store_from_phone is missing");
assert.deepEqual(phoneStoreTool.inputSchema.required, storeFields);
assert.deepEqual(
  phoneStoreTool.inputSchema.properties,
  storeTool.inputSchema.properties,
  "native and phone Store must accept the same metadata-only fields",
);
assert.match(phoneStoreTool.description, /Tailscale Serve/);
assert.match(phoneStoreTool.description, /never uses Tailscale Funnel/);

const skill = readFileSync(
  resolve(pluginRoot, "skills", "keepkeys", "SKILL.md"),
  "utf8",
).replaceAll("\r\n", "\n");
assert.match(skill, /^---\nname: keepkeys\n/m);
assert.match(skill, /Never ask the user to paste, type, dictate, attach, or expose a secret in chat/);
assert.match(skill, /Paste & Store/);
assert.match(skill, /AI-readable official\s+documentation/);
assert.match(
  skill,
  /Never open, fetch,\s+preview, screenshot, or test the link/,
);

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
  ["macOS", sourceText, "pasteboard.string(forType: .string)"],
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
for (const [platform, helper, clearAction] of [
  ["macOS", sourceText, "pasteboard.clearContents()"],
  ["Windows", windowsHelper, "[Windows.Clipboard]::Clear()"],
  ["Linux", linuxHelper, "window.clipboard_clear()"],
]) {
  assert.ok(
    helper.includes(clearAction),
    `${platform} must clear the current clipboard immediately after capture`,
  );
}
for (const [platform, helper, captureThenClearThenValidate] of [
  [
    "macOS",
    sourceText,
    /let captured = readClipboard\(\)[\s\S]{0,500}clearClipboard\(\)[\s\S]{0,500}validateSecret\(secret\)/,
  ],
  [
    "Windows",
    windowsHelper,
    /\$candidateSecret = & \$ReadClipboard[\s\S]{0,400}& \$ClearClipboard[\s\S]{0,400}Assert-KeepKeysSecret \$candidateSecret/,
  ],
  [
    "Linux",
    linuxHelper,
    /window\.clipboard_get\(\)[\s\S]{0,300}window\.clipboard_clear\(\)[\s\S]{0,300}validate_secret\(value\)/,
  ],
]) {
  assert.match(
    helper,
    captureThenClearThenValidate,
    `${platform} must clear even clipboard text that secret validation rejects`,
  );
}
for (const [platform, helper] of [
  ["macOS", sourceText],
  ["Windows", windowsHelper],
]) {
  assert.match(
    helper,
    /Paste & Store boundary self-test failed/,
    `${platform} must behaviorally test successful and rejected clipboard capture`,
  );
}
assert.match(
  sourceText,
  /let summaryScroll = NSScrollView/,
  "macOS Store metadata must remain fully reviewable",
);
assert.match(
  windowsHelper,
  /SystemParameters\]::WorkArea/,
  "Windows native windows must stay within the scaled work area",
);
assert.match(
  windowsHelper,
  /Windows\.Controls\.ScrollViewer/,
  "Windows Store metadata must remain reviewable on compact displays",
);
assert.match(
  windowsHelper,
  /HashSet\[string\]\]::new\([\s\S]{0,100}StringComparer\]::Ordinal/,
  "Windows documentation URL uniqueness must use ordinal case-sensitive comparison",
);
assert.match(
  windowsHelper,
  /\$Script:MaximumMetadataBytes = 2560/,
  "Windows metadata must respect Credential Manager's 2560-byte blob limit",
);
assert.match(
  windowsHelper,
  /\$serializedMetadata = ConvertTo-KeepKeysMetadataBytes \$Provider \$DocumentationUrls[\s\S]{0,120}\[Array\]::Clear/,
  "Windows must size-check serialized metadata before opening the Store UI",
);
assert.match(
  windowsHelper,
  /Credential Manager metadata-size self-test failed/,
  "Windows must regress serialized metadata expansion beyond the vault limit",
);
assert.match(
  linuxHelper,
  /winfo_screenheight\(\)/,
  "Linux native windows must stay within the screen work area",
);
assert.match(
  linuxHelper,
  /self\.tk\.Canvas/,
  "Linux Store metadata must scroll while actions stay visible",
);
for (const helper of [sourceText, windowsHelper, linuxHelper]) {
  assert.match(helper, /new-key/, "valid new-key regression is missing");
  assert.match(helper, /https:\/\/docs\./, "documentation URL validation test is missing");
}
const expectedSourceHash = launcher.match(/^expected_source_hash="([a-f0-9]{64})"$/m)?.[1];
assert.ok(expectedSourceHash, "launcher source-integrity digest is missing");
assert.equal(createHash("sha256").update(source).digest("hex"), expectedSourceHash);
for (const relative of [
  "scripts/keepkeys-cli.mjs",
  "scripts/keepkeys-portal.mjs",
  "scripts/keepkeys.linux.py",
  "scripts/keepkeys.windows.ps1",
  "scripts/platform.mjs",
]) {
  assert.ok(existsSync(resolve(pluginRoot, relative)), `${relative} is missing`);
}
const portalSource = readFileSync(
  resolve(pluginRoot, "scripts", "keepkeys-portal.mjs"),
  "utf8",
);
assert.match(portalSource, /SESSION_TTL_MS = 10 \* 60 \* 1000/);
assert.match(portalSource, /randomBytes\(24\)\.toString\("base64url"\)/);
assert.match(portalSource, /tailscale-user-login/);
assert.match(portalSource, /SameSite=Strict/);
assert.match(portalSource, /publicInternet: false/);
assert.match(portalSource, /\[\s*"serve",/);
assert.match(
  portalSource,
  /<form id="store-form" method="post">[\s\S]*?<fieldset id="store-controls" disabled>[\s\S]*?<input id="secret" type="password"/,
  "phone intake must keep the no-script form disabled and must not name the secret input",
);
assert.match(
  portalSource,
  /portalStartupProcessOptions\([\s\S]*?detached: false/,
  "portal startup children must remain in the detached portal process group",
);
assert.match(
  portalSource,
  /onTerminal: \(\) => \{\s+setTimeout\(\(\) => \{\s+cleanupAndExit\(\)/,
  "every terminal submission must schedule portal and Serve cleanup",
);
assert.match(
  portalSource,
  /stopOwnedServeProcess\([\s\S]*?verifyServePathRemoved\(tailscale, path\)[\s\S]*?process\.kill\(-process\.pid, "SIGTERM"\)/,
  "portal cleanup must confirm Serve exit and removal of the exact owned route",
);
assert.match(
  portalSource,
  /millisecondsUntilExpiry\(expiresAt\)/,
  "portal cleanup must be scheduled from the advertised expiry",
);
assert.doesNotMatch(
  portalSource,
  /["']funnel["']/i,
  "phone intake must never invoke Tailscale Funnel",
);
assert.deepEqual(
  portalSource.match(/https?:\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^"'\s]*)?/gi) ?? [],
  ["https://github.com/barnlabs/keepkeys"],
  "phone intake source may contain only the official self-test documentation URL, not a hosted relay",
);
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

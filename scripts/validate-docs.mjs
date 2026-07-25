#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const documents = [
  "README.md",
  "INSTALL.md",
  "AGENTS.md",
  "CHECKLIST.md",
  "CODE_REVIEW.md",
  "DESIGN.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "MAINTAINERS.md",
  "ROADMAP.md",
  "SECURITY.md",
  "docs/architecture.md",
  "docs/compatibility.md",
  "docs/privacy-and-data-handling.md",
  "docs/releasing.md",
  "docs/repository-design.md",
  "docs/threat-model.md",
  "docs/updating.md",
  "plugins/keepkeys/assets/brand-guidelines.md",
];

const findings = [];
const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

for (const projectPath of documents) {
  const absolute = resolve(root, projectPath);
  assert.ok(existsSync(absolute), `${projectPath} is missing`);
  const source = readFileSync(absolute, "utf8");
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1];
    if (
      target.startsWith("#") ||
      target.startsWith("https://") ||
      target.startsWith("http://") ||
      target.startsWith("mailto:")
    ) {
      continue;
    }
    const withoutFragment = decodeURIComponent(target.split("#", 1)[0]);
    const resolved = resolve(dirname(absolute), withoutFragment);
    if (!existsSync(resolved)) {
      findings.push(
        `${projectPath}: missing local link ${relative(root, resolved)}`,
      );
    }
  }
}

for (const projectPath of [
  "plugins/keepkeys/assets/icon.png",
  "plugins/keepkeys/assets/keykeeper.png",
  "plugins/keepkeys/assets/logo.png",
  "plugins/keepkeys/assets/logo-dark.png",
  "plugins/keepkeys/assets/social-preview.png",
]) {
  assert.equal(extname(projectPath), ".png");
  assert.ok(existsSync(resolve(root, projectPath)), `${projectPath} is missing`);
}

assert.deepEqual(findings, []);
process.stdout.write("KeepKeys documentation links and brand assets are valid.\n");

#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const excludedDirectories = new Set([".git", "dist", "__pycache__"]);
const excludedFiles = new Set(["submission/test-cases.md"]);
const excludedExtensions = new Set([".png", ".pyc", ".zip"]);
const patterns = [
  /BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
];
const findings = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) visit(join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const projectPath = relative(root, path).replaceAll("\\", "/");
    if (
      excludedFiles.has(projectPath) ||
      excludedExtensions.has(extname(entry.name).toLowerCase())
    ) {
      continue;
    }
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (patterns.some((pattern) => pattern.test(line))) {
        findings.push(`${projectPath}:${index + 1}`);
      }
    });
  }
}

visit(root);
if (findings.length > 0) {
  process.stderr.write(
    `Potential credential material found:\n${findings.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Credential-pattern scan passed.\n");
}

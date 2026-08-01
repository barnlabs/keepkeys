#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

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
  "docs/host-contract-evidence.md",
  "docs/privacy-and-data-handling.md",
  "docs/releasing.md",
  "docs/repository-design.md",
  "docs/threat-model.md",
  "docs/updating.md",
  ".github/assets/keepkeys/README.md",
  "plugins/keepkeys/assets/brand-guidelines.md",
  "submission/README.md",
  "submission/codex-market-guide.md",
  "submission/listing.md",
  "submission/release-notes.md",
  "submission/test-cases.md",
];

const findings = [];
const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

function pngMetadata(projectPath) {
  const source = readFileSync(resolve(root, projectPath));
  assert.deepEqual(
    source.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    `${projectPath} is not a PNG`,
  );

  const chunks = new Map();
  const idat = [];
  for (let offset = 8; offset < source.length; ) {
    const length = source.readUInt32BE(offset);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") idat.push(data);
    else chunks.set(type, data);
    offset += length + 12;
    if (type === "IEND") break;
  }

  const ihdr = chunks.get("IHDR");
  assert.ok(ihdr, `${projectPath} has no IHDR chunk`);
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    palette: chunks.get("PLTE"),
    pixels: Buffer.concat(idat),
  };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function indexedPngColors(projectPath) {
  const metadata = pngMetadata(projectPath);
  assert.equal(metadata.colorType, 3, `${projectPath} must use indexed color`);
  assert.equal(metadata.bitDepth, 2, `${projectPath} must use a 2-bit palette`);
  assert.ok(metadata.palette, `${projectPath} has no palette`);

  const bytesPerRow = Math.ceil((metadata.width * metadata.bitDepth) / 8);
  const inflated = inflateSync(metadata.pixels);
  const rows = [];
  let offset = 0;
  let previous = Buffer.alloc(bytesPerRow);

  for (let y = 0; y < metadata.height; y += 1) {
    const filter = inflated[offset];
    const raw = inflated.subarray(offset + 1, offset + 1 + bytesPerRow);
    const row = Buffer.alloc(bytesPerRow);
    for (let x = 0; x < bytesPerRow; x += 1) {
      const left = x > 0 ? row[x - 1] : 0;
      const up = previous[x];
      const upperLeft = x > 0 ? previous[x - 1] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      assert.notEqual(predictor, undefined, `${projectPath} has an invalid PNG filter`);
      row[x] = (raw[x] + predictor) & 0xff;
    }
    rows.push(row);
    previous = row;
    offset += bytesPerRow + 1;
  }

  const used = new Set();
  for (const row of rows) {
    for (let x = 0; x < metadata.width; x += 1) {
      const bitOffset = x * metadata.bitDepth;
      const shift = 8 - metadata.bitDepth - (bitOffset % 8);
      used.add((row[Math.floor(bitOffset / 8)] >> shift) & 0x03);
    }
  }

  return [...used].map((index) => {
    const offset = index * 3;
    return `#${metadata.palette.subarray(offset, offset + 3).toString("hex").toUpperCase()}`;
  }).sort();
}

function icoSizes(projectPath) {
  const source = readFileSync(resolve(root, projectPath));
  assert.equal(source.readUInt16LE(0), 0, `${projectPath} has an invalid ICO header`);
  assert.equal(source.readUInt16LE(2), 1, `${projectPath} is not an icon`);
  const count = source.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const width = source[offset] || 256;
    const height = source[offset + 1] || 256;
    return `${width}x${height}`;
  });
}

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

for (const projectPath of [
  ".github/assets/keepkeys/favicon-master.png",
  ".github/assets/keepkeys/favicon-micro-master.png",
  ".github/assets/keepkeys/favicon-16.png",
  ".github/assets/keepkeys/favicon-32.png",
  ".github/assets/keepkeys/favicon-48.png",
  ".github/assets/keepkeys/favicon.ico",
  ".github/assets/keepkeys/apple-touch-icon.png",
  ".github/assets/keepkeys/icon-192.png",
  ".github/assets/keepkeys/icon-512.png",
  ".github/assets/keepkeys/icon-maskable-512.png",
  ".github/assets/keepkeys/favicon-sizes.png",
]) {
  assert.ok(existsSync(resolve(root, projectPath)), `${projectPath} is missing`);
}

for (const [projectPath, width, height] of [
  [".github/assets/keepkeys/favicon-master.png", 1254, 1254],
  [".github/assets/keepkeys/favicon-micro-master.png", 1254, 1254],
  [".github/assets/keepkeys/favicon-16.png", 16, 16],
  [".github/assets/keepkeys/favicon-32.png", 32, 32],
  [".github/assets/keepkeys/favicon-48.png", 48, 48],
  [".github/assets/keepkeys/apple-touch-icon.png", 180, 180],
  [".github/assets/keepkeys/icon-192.png", 192, 192],
  [".github/assets/keepkeys/icon-512.png", 512, 512],
  [".github/assets/keepkeys/icon-maskable-512.png", 512, 512],
  [".github/assets/keepkeys/favicon-sizes.png", 768, 192],
]) {
  const metadata = pngMetadata(projectPath);
  assert.deepEqual(
    [metadata.width, metadata.height],
    [width, height],
    `${projectPath} has the wrong dimensions`,
  );
}

const faviconColors = ["#14211D", "#D9A83E", "#E56F51"].sort();
assert.deepEqual(
  indexedPngColors(".github/assets/keepkeys/favicon-master.png"),
  faviconColors,
  "the full favicon master must use only the approved palette",
);
assert.deepEqual(
  indexedPngColors(".github/assets/keepkeys/favicon-micro-master.png"),
  faviconColors,
  "the micro favicon master must use only the approved palette",
);
assert.deepEqual(
  icoSizes(".github/assets/keepkeys/favicon.ico"),
  ["16x16", "32x32", "48x48"],
  "favicon.ico must contain the 16px, 32px, and 48px entries",
);

const t3Project = JSON.parse(readFileSync(resolve(root, "t3.json"), "utf8"));
assert.equal(t3Project.$schema, "https://t3.codes/schema/t3.json");
assert.equal(
  t3Project.iconPath,
  ".github/assets/keepkeys/icon-192.png",
  "T3 Code must use the approved KeepKeys project icon",
);
assert.ok(
  existsSync(resolve(root, t3Project.iconPath)),
  `T3 Code project icon is missing: ${t3Project.iconPath}`,
);

process.stdout.write("KeepKeys documentation links and brand assets are valid.\n");

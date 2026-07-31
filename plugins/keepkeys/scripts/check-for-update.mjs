import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const UPDATE_MANIFEST_URL =
  "https://raw.githubusercontent.com/barnlabs/keepkeys/main/update.json";
export const UPDATE_MANIFEST_HOST = "raw.githubusercontent.com";

const EXPECTED_KEYS = [
  "catalogCommit",
  "channel",
  "installGuide",
  "product",
  "releaseNotes",
  "schemaVersion",
  "sourceCommit",
  "version",
];
const MAXIMUM_MANIFEST_BYTES = 16_384;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT = /^[a-f0-9]{40}$/;

export function validateUpdateManifest(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), EXPECTED_KEYS);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.product, "KeepKeys");
  assert.equal(value.channel, "stable");
  assert.match(value.version, SEMVER);
  assert.match(value.sourceCommit, COMMIT);
  assert.match(value.catalogCommit, COMMIT);
  for (const [name, url] of [
    ["installGuide", value.installGuide],
    ["releaseNotes", value.releaseNotes],
  ]) {
    assert.equal(typeof url, "string", `${name} must be a string`);
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hostname, "github.com");
    assert.equal(parsed.port, "");
    assert.equal(parsed.username, "");
    assert.equal(parsed.password, "");
    assert.equal(parsed.search, "");
    assert.equal(parsed.hash, "");
    assert.match(parsed.pathname, /^\/barnlabs\/keepkeys(?:\/|$)/);
  }
  return value;
}

export function compareVersions(left, right) {
  const leftParts = SEMVER.exec(left);
  const rightParts = SEMVER.exec(right);
  assert.ok(leftParts, `Invalid local KeepKeys version: ${left}`);
  assert.ok(rightParts, `Invalid stable KeepKeys version: ${right}`);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftParts[index]) - Number(rightParts[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function updateStatus(localVersion, manifest) {
  validateUpdateManifest(manifest);
  const comparison = compareVersions(localVersion, manifest.version);
  return {
    status:
      comparison < 0
        ? "update_available"
        : comparison > 0
          ? "ahead_of_stable"
          : "current",
    installedVersion: localVersion,
    stableVersion: manifest.version,
    sourceCommit: manifest.sourceCommit,
    catalogCommit: manifest.catalogCommit,
    installGuide: manifest.installGuide,
    releaseNotes: manifest.releaseNotes,
    requiresExplicitInstall: true,
    verification: "Review the pinned source and catalog commits before installing.",
    message:
      comparison < 0
        ? `KeepKeys ${manifest.version} is available. Review the immutable commits and install guide before updating.`
        : comparison > 0
          ? `Installed KeepKeys ${localVersion} is newer than the stable channel.`
          : `KeepKeys ${localVersion} matches the stable channel.`,
  };
}

async function readBoundedBody(response) {
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    const body = await response.text();
    assert.ok(
      Buffer.byteLength(body, "utf8") <= MAXIMUM_MANIFEST_BYTES,
      "Update manifest exceeded the 16 KiB safety limit.",
    );
    return body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    assert.ok(
      size <= MAXIMUM_MANIFEST_BYTES,
      "Update manifest exceeded the 16 KiB safety limit.",
    );
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

export async function fetchStableUpdate({
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  assert.equal(typeof fetchImpl, "function", "Node.js 18 or newer is required.");
  assert.equal(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000,
    true,
    "Update checks require a timeout from 1 to 60000 milliseconds.",
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(UPDATE_MANIFEST_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "BarnLabs-KeepKeys-update-check",
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    assert.equal(response.ok, true, `Update server returned HTTP ${response.status}.`);
    const responseUrl = new URL(response.url || UPDATE_MANIFEST_URL);
    assert.equal(responseUrl.protocol, "https:");
    assert.equal(responseUrl.hostname, UPDATE_MANIFEST_HOST);
    assert.equal(responseUrl.port, "");
    assert.equal(responseUrl.username, "");
    assert.equal(responseUrl.password, "");
    assert.equal(responseUrl.search, "");
    assert.equal(responseUrl.hash, "");
    assert.equal(responseUrl.pathname, "/barnlabs/keepkeys/main/update.json");
    return validateUpdateManifest(JSON.parse(await readBoundedBody(response)));
  } finally {
    clearTimeout(timeout);
  }
}

function localVersion() {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return JSON.parse(
    readFileSync(resolve(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
  ).version;
}

function humanOutput(result) {
  return [
    result.message,
    `Installed: ${result.installedVersion}`,
    `Stable: ${result.stableVersion}`,
    `Source commit: ${result.sourceCommit}`,
    `Catalog commit: ${result.catalogCommit}`,
    `Install guide: ${result.installGuide}`,
    `Release notes: ${result.releaseNotes}`,
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 0 || (args.length === 1 && args[0] === "--json"),
    "Usage: check-for-update.mjs [--json]",
  );
  const result = updateStatus(localVersion(), await fetchStableUpdate());
  process.stdout.write(
    args[0] === "--json" ? `${JSON.stringify(result)}\n` : `${humanOutput(result)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "Update check failed.",
      })}\n`,
    );
    process.exitCode = 1;
  });
}

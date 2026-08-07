import assert from "node:assert/strict";
import test from "node:test";

import {
  UPDATE_MANIFEST_URL,
  compareVersions,
  fetchStableUpdate,
  updateStatus,
  validateUpdateManifest,
} from "./check-for-update.mjs";

const manifest = {
  schemaVersion: 1,
  product: "KeepKeys",
  channel: "stable",
  version: "0.4.1",
  sourceCommit: "a".repeat(40),
  catalogCommit: "b".repeat(40),
  installGuide: "https://github.com/neorome/keepkeys/blob/main/INSTALL.md",
  releaseNotes: "https://github.com/neorome/keepkeys/blob/main/CHANGELOG.md",
};

test("semantic versions compare without coercion or prerelease ambiguity", () => {
  assert.equal(compareVersions("0.4.1", "0.4.1"), 0);
  assert.equal(compareVersions("0.4.0", "0.4.1"), -1);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.throws(() => compareVersions("main", "0.4.1"), /Invalid local/);
});

test("stable update manifests require immutable commits and Neorome URLs", () => {
  assert.deepEqual(validateUpdateManifest({ ...manifest }), manifest);
  assert.throws(
    () => validateUpdateManifest({ ...manifest, sourceCommit: "main" }),
    /regular expression/,
  );
  assert.throws(
    () =>
      validateUpdateManifest({
        ...manifest,
        installGuide: "https://example.com/install",
      }),
    /Expected values to be strictly equal/,
  );
});

test("update status returns deliberate review metadata, never an auto-install action", () => {
  assert.deepEqual(updateStatus("0.4.0", manifest), {
    status: "update_available",
    installedVersion: "0.4.0",
    stableVersion: "0.4.1",
    sourceCommit: "a".repeat(40),
    catalogCommit: "b".repeat(40),
    installGuide: manifest.installGuide,
    releaseNotes: manifest.releaseNotes,
    requiresExplicitInstall: true,
    verification: "Review the pinned source and catalog commits before installing.",
    message:
      "KeepKeys 0.4.1 is available. Review the immutable commits and install guide before updating.",
  });
});

test("network update checks use the fixed manifest URL and validate the response", async () => {
  let request;
  const value = await fetchStableUpdate({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        url: UPDATE_MANIFEST_URL,
        text: async () => JSON.stringify(manifest),
      };
    },
  });
  assert.deepEqual(value, manifest);
  assert.equal(request.url, UPDATE_MANIFEST_URL);
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.Accept, "application/json");
  assert.equal(request.options.cache, "no-store");
});

test("update checks reject unsafe manifest links and invalid timeouts", async () => {
  assert.throws(
    () => validateUpdateManifest({ ...manifest, releaseNotes: `${manifest.releaseNotes}?raw=1` }),
    /Expected values to be strictly equal/,
  );
  await assert.rejects(
    fetchStableUpdate({ timeoutMs: 0 }),
    /timeout from 1 to 60000/,
  );
});

test("network update checks stop reading oversized streaming responses", async () => {
  async function* oversized() {
    yield Buffer.alloc(16_000, 0x20);
    yield Buffer.alloc(500, 0x20);
    throw new Error("the reader should have stopped before a third chunk");
  }
  await assert.rejects(
    fetchStableUpdate({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: UPDATE_MANIFEST_URL,
        body: oversized(),
      }),
    }),
    /16 KiB safety limit/,
  );
});

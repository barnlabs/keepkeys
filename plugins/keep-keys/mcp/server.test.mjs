import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOLS,
  createRequestHandler,
  helperArguments,
} from "./server.mjs";

test("tool schemas never accept a plaintext secret", () => {
  for (const tool of TOOLS) {
    const propertyNames = Object.keys(tool.inputSchema.properties);
    assert.equal(propertyNames.includes("secret"), false, tool.name);
    assert.equal(propertyNames.includes("value"), false, tool.name);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean", tool.name);
    assert.equal(typeof tool.annotations.openWorldHint, "boolean", tool.name);
    assert.equal(typeof tool.annotations.destructiveHint, "boolean", tool.name);
  }
});

test("run arguments are passed directly without a shell command string", () => {
  assert.deepEqual(
    helperArguments("keepkeys_run", {
      name: "github-release",
      purpose: "Publish the approved release",
      program: "/usr/bin/curl",
      arguments: ["--fail", "https://example.invalid"],
      cwd: "/tmp",
    }),
    [
      "run",
      "--name",
      "github-release",
      "--purpose",
      "Publish the approved release",
      "--cwd",
      "/tmp",
      "--",
      "/usr/bin/curl",
      "--fail",
      "https://example.invalid",
    ],
  );
});

test("store carries metadata but never a secret value", () => {
  assert.deepEqual(
    helperArguments("keepkeys_store", {
      name: "github-release",
      variable: "GITHUB_TOKEN",
      description: "Publishes approved BarnLabs releases",
    }),
    [
      "store",
      "--name",
      "github-release",
      "--variable",
      "GITHUB_TOKEN",
      "--description",
      "Publishes approved BarnLabs releases",
    ],
  );
});

test("run rejects malformed argument arrays", () => {
  assert.throws(
    () =>
      helperArguments("keepkeys_run", {
        name: "demo",
        purpose: "test",
        program: "/usr/bin/true",
        arguments: ["ok", 7],
      }),
    /arguments must contain/,
  );
});

test("MCP handler returns structured helper output", async () => {
  const calls = [];
  const handler = createRequestHandler(async (name, args) => {
    calls.push({ name, args });
    return { status: "ok", platform: "macOS", version: "0.1.1" };
  });
  const response = await handler({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "keepkeys_status", arguments: {} },
  });
  assert.deepEqual(calls, [{ name: "keepkeys_status", args: {} }]);
  assert.deepEqual(response.result.structuredContent, {
    status: "ok",
    platform: "macOS",
    version: "0.1.1",
  });
});

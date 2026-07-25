import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TOOLS,
  createRequestHandler,
  helperArguments,
} from "./server.mjs";
import { helperInvocation } from "../scripts/platform.mjs";

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
    return { status: "ok", platform: "macOS", version: "0.4.0" };
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
    version: "0.4.0",
  });
});

test("platform dispatch keeps one argv contract across macOS, Windows, and Linux", () => {
  const helperArgs = ["status"];
  const macOS = helperInvocation(helperArgs, {
    platform: "darwin",
    environment: {},
    home: "/Users/example",
  });
  assert.match(macOS.command, /scripts[/\\]keepkeys$/);
  assert.deepEqual(macOS.args, helperArgs);
  assert.equal(macOS.env.HOME, "/Users/example");

  const windows = helperInvocation(helperArgs, {
    platform: "win32",
    environment: {
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\example",
      LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
    },
    home: "C:\\Users\\example",
  });
  assert.match(windows.command, /powershell\.exe$/i);
  assert.deepEqual(windows.args.slice(-2), [
    expectWindowsScript(windows.args.at(-2)),
    "status",
  ]);
  assert.equal(windows.env.USERPROFILE, "C:\\Users\\example");

  const linux = helperInvocation(helperArgs, {
    platform: "linux",
    environment: {
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      DISPLAY: ":0",
    },
    home: "/home/example",
  });
  assert.equal(linux.command, "python3");
  assert.match(linux.args[0], /keepkeys\.linux\.py$/);
  assert.equal(linux.args[1], "status");
  assert.equal(
    linux.env.DBUS_SESSION_BUS_ADDRESS,
    "unix:path=/run/user/1000/bus",
  );
  assert.equal(linux.env.DISPLAY, ":0");
});

function expectWindowsScript(value) {
  assert.match(value, /keepkeys\.windows\.ps1$/i);
  return value;
}

test("stdio server starts when the plugin path contains a symlink", () => {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "keepkeys-mcp-"));
  const alias = join(temporaryRoot, "plugin");
  try {
    symlinkSync(pluginRoot, alias, "dir");
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "keepkeys-test", version: "1" },
      },
    };
    const result = spawnSync(
      process.execPath,
      [join(alias, "mcp", "server.mjs"), "--stdio"],
      {
        input: `${JSON.stringify(request)}\n`,
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout.trim());
    assert.equal(response.result.serverInfo.name, "keepkeys");
    assert.equal(response.result.serverInfo.version, "0.4.0");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

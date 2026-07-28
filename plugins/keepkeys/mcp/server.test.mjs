import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TOOLS,
  createRequestHandler,
  helperArguments,
} from "./server.mjs";
import {
  canonicalTextSha256,
  helperInvocation,
  portalCommitInvocation,
} from "../scripts/platform.mjs";

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
      provider: "GitHub",
      documentation_urls: [
        "https://docs.github.com/en/rest",
        "https://github.com/github/rest-api-description",
      ],
    }),
    [
      "store",
      "--name",
      "github-release",
      "--variable",
      "GITHUB_TOKEN",
      "--description",
      "Publishes approved BarnLabs releases",
      "--provider",
      "GitHub",
      "--documentation-url",
      "https://docs.github.com/en/rest",
      "--documentation-url",
      "https://github.com/github/rest-api-description",
    ],
  );
  assert.deepEqual(
    helperArguments("keepkeys_store_from_phone", {
      name: "github-release",
      variable: "GITHUB_TOKEN",
      description: "Publishes approved BarnLabs releases",
      provider: "GitHub",
      documentation_urls: ["https://docs.github.com/en/rest"],
    }),
    [
      "portal-store",
      "--name",
      "github-release",
      "--variable",
      "GITHUB_TOKEN",
      "--description",
      "Publishes approved BarnLabs releases",
      "--provider",
      "GitHub",
      "--documentation-url",
      "https://docs.github.com/en/rest",
    ],
  );
});

test("store rejects missing, insecure, or excessive documentation links", () => {
  const base = {
    name: "github-release",
    variable: "GITHUB_TOKEN",
    description: "Publishes approved BarnLabs releases",
    provider: "GitHub",
  };
  for (const documentation_urls of [
    [],
    ["http://docs.example.com"],
    ["https://user:password@docs.example.com"],
    ["https://docs.example.com", "https://docs.example.com"],
    ["https://a.example", "https://b.example", "https://c.example", "https://d.example"],
  ]) {
    assert.throws(
      () =>
        helperArguments("keepkeys_store", {
          ...base,
          documentation_urls,
        }),
      /documentation_urls/,
    );
  }
});

test("store enforces the native 80-byte UTF-8 provider boundary", () => {
  const base = {
    name: "new-key",
    variable: "SECRET_KEY",
    description: "Credential for future approved agent commands",
    documentation_urls: ["https://docs.example.com/api"],
  };
  assert.doesNotThrow(() =>
    helperArguments("keepkeys_store", {
      ...base,
      provider: "鍵".repeat(26),
    }),
  );
  assert.throws(
    () =>
      helperArguments("keepkeys_store", {
        ...base,
        provider: "鍵".repeat(27),
      }),
    /provider must be a non-empty string of at most 80 UTF-8 bytes/,
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

test("runtime validation rejects every undeclared field before helper dispatch", async () => {
  for (const [toolName, argumentsValue] of [
    ["keepkeys_store", {
      name: "demo",
      variable: "DEMO_TOKEN",
      description: "Synthetic test metadata",
      provider: "Example",
      documentation_urls: ["https://docs.example.com"],
      secret: "synthetic-only-not-a-credential",
    }],
    ["keepkeys_store", {
      name: "demo",
      variable: "DEMO_TOKEN",
      description: "Synthetic test metadata",
      provider: "Example",
      documentation_urls: ["https://docs.example.com"],
      value: "synthetic-only-not-a-credential",
    }],
    ["keepkeys_store_from_phone", {
      name: "demo",
      variable: "DEMO_TOKEN",
      description: "Synthetic test metadata",
      provider: "Example",
      documentation_urls: ["https://docs.example.com"],
      secret: "synthetic-only-not-a-credential",
    }],
    ["keepkeys_run", {
      name: "demo",
      purpose: "Synthetic test",
      program: "/usr/bin/true",
      alias: { nested: "unsupported" },
    }],
    ["keepkeys_status", { unexpected: true }],
  ]) {
    assert.throws(
      () => helperArguments(toolName, argumentsValue),
      /^Error: Tool arguments contain an unsupported field\.$/,
    );
  }
  let called = false;
  const handler = createRequestHandler(async () => {
    called = true;
    return {};
  });
  await assert.rejects(
    handler({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "keepkeys_status",
        arguments: { secret: "synthetic-only-not-a-credential" },
      },
    }),
    /unsupported field/,
  );
  assert.equal(called, false);
});

test("MCP handler returns structured helper output", async () => {
  const calls = [];
  const handler = createRequestHandler(async (name, args) => {
    calls.push({ name, args });
    return { status: "ok", platform: "macOS", version: "0.5.0" };
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
    version: "0.5.0",
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
      KEEPKEYS_PYTHON: "/tmp/untrusted-python",
    },
    home: "/home/example",
  });
  assert.equal(linux.command, "/usr/bin/python3");
  assert.match(linux.args[0], /keepkeys\.linux\.py$/);
  assert.equal(linux.args[1], "status");
  assert.equal(
    linux.env.DBUS_SESSION_BUS_ADDRESS,
    "unix:path=/run/user/1000/bus",
  );
  assert.equal(linux.env.DISPLAY, ":0");

  for (const platform of ["darwin", "win32", "linux"]) {
    const portal = helperInvocation(["portal-store", "--name", "demo"], {
      platform,
      environment:
        platform === "win32"
          ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
          : {},
      home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
    });
    assert.equal(portal.command, process.execPath);
    assert.match(portal.args[0], /keepkeys-portal\.mjs$/u);
    assert.deepEqual(portal.args.slice(1), ["--name", "demo"]);
  }
});

test("native helper fingerprints are stable across LF and CRLF checkouts", () => {
  assert.equal(
    canonicalTextSha256("line one\nline two\n"),
    canonicalTextSha256("line one\r\nline two\r\n"),
  );
});

test("the native portal commit is unavailable through public dispatch", () => {
  for (const action of ["portal-commit", "_portal-commit"]) {
    assert.throws(
      () => helperInvocation([action]),
      /not a public KeepKeys action/u,
    );
  }
  const capabilitySha256 = "a".repeat(64);
  for (const platform of ["darwin", "win32", "linux"]) {
    const environment =
      platform === "win32"
        ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
        : {};
    const invocation = portalCommitInvocation(
      ["_portal-commit", "--name", "demo"],
      { capabilitySha256, parentPid: 1234 },
      {
        platform,
        environment,
        home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
      },
    );
    assert.equal(
      invocation.env.KEEPKEYS_PORTAL_CAPABILITY_SHA256,
      capabilitySha256,
    );
    assert.equal(invocation.env.KEEPKEYS_PORTAL_PARENT_PID, "1234");
    assert.equal(invocation.args.at(-2), "--name");
    assert.equal(invocation.args.at(-1), "demo");
  }
});

test("a non-portal Node parent cannot forge the native commit channel", () => {
  const capability = randomBytes(32);
  const capabilitySha256 = createHash("sha256")
    .update(capability)
    .digest("hex");
  const secret = randomBytes(24).toString("base64url");
  const input = Buffer.concat([capability, Buffer.from(secret, "utf8")]);
  capability.fill(0);
  try {
    const invocation = portalCommitInvocation(
      [
        "_portal-commit",
        "--name",
        `forged-parent-${process.pid}-${Date.now()}`,
        "--variable",
        "FORGED_PARENT_TOKEN",
        "--description",
        "Generated negative portal-channel test",
        "--provider",
        "KeepKeys test",
        "--documentation-url",
        "https://github.com/barnlabs/keepkeys",
        "--expect-existing",
        "yes",
      ],
      { capabilitySha256, parentPid: process.pid },
    );
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: invocation.env.KEEPKEYS_PLUGIN_ROOT,
      env: invocation.env,
      input,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.notEqual(result.status, 0);
    const response = JSON.parse(result.stdout.trim());
    assert.equal(response.status, "error");
    assert.match(response.message, /live KeepKeys portal channel/u);
  } finally {
    input.fill(0);
  }
});

function expectWindowsScript(value) {
  assert.match(value, /keepkeys\.windows\.ps1$/i);
  return value;
}

test("stdio server handles a complete protocol transcript through a symlinked plugin path", () => {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "keepkeys-mcp-"));
  const alias = join(temporaryRoot, "plugin");
  try {
    symlinkSync(pluginRoot, alias, "dir");
    const requests = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "keepkeys-test", version: "1" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "missing/method", params: {} },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "keepkeys_status",
          arguments: { secret: "synthetic-only-not-a-credential" },
        },
      },
      { malformed: "request without an id is a notification" },
    ];
    const result = spawnSync(
      process.execPath,
      [join(alias, "mcp", "server.mjs"), "--stdio"],
      {
        input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const responses = result.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(responses.length, 4, "notifications must not produce responses");
    assert.equal(responses[0].result.serverInfo.name, "keepkeys");
    assert.equal(responses[0].result.serverInfo.version, "0.5.0");
    assert.deepEqual(responses[1].result.tools, TOOLS);
    assert.deepEqual(responses[2], {
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601, message: "Method not found: missing/method" },
    });
    assert.deepEqual(responses[3], {
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: -32000,
        message: "Tool arguments contain an unsupported field.",
      },
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

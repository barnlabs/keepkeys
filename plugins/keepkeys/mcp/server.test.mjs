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
  nativeMutationInvocation,
  nativeStoreInvocation,
  portalCommitInvocation,
} from "../scripts/platform.mjs";
import {
  runSerializedMutation,
  runSerializedStore,
} from "../scripts/keepkeys-store.mjs";

test("tool schemas never accept a plaintext secret", () => {
  for (const tool of TOOLS) {
    const propertyNames = Object.keys(tool.inputSchema.properties);
    assert.equal(propertyNames.includes("secret"), false, tool.name);
    assert.equal(propertyNames.includes("value"), false, tool.name);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean", tool.name);
    assert.equal(typeof tool.annotations.openWorldHint, "boolean", tool.name);
    assert.equal(typeof tool.annotations.destructiveHint, "boolean", tool.name);
    assert.equal(typeof tool.outputSchema, "object", `${tool.name} has an output schema`);
    assert.equal(/"(?:secret|value)"\s*:/.test(JSON.stringify(tool.outputSchema)), false, tool.name);
  }
});

test("tool output schemas match the metadata-only helper receipts", () => {
  const schemaFor = (name) => TOOLS.find((tool) => tool.name === name).outputSchema;
  const requiredFor = (name) => schemaFor(name).required;
  const successVariant = (name) =>
    schemaFor(name).oneOf.find((variant) => variant.properties.status.const === "ok");

  assert.deepEqual(requiredFor("keepkeys_store_from_phone"), [
    "status", "message", "url", "expiresAt", "name", "variable", "replacing", "network", "publicInternet",
  ]);
  assert.equal(schemaFor("keepkeys_store_from_phone").properties.network.const, "Tailscale Serve");
  assert.equal(schemaFor("keepkeys_store_from_phone").properties.publicInternet.const, false);
  assert.deepEqual(requiredFor("keepkeys_list"), ["status", "entries"]);
  assert.deepEqual(schemaFor("keepkeys_list").properties.entries.items.required, [
    "name", "variable", "description", "provider", "documentationUrls",
  ]);
  assert.deepEqual(successVariant("keepkeys_remove").required, ["status", "message", "removed"]);
  assert.deepEqual(successVariant("keepkeys_run").required, [
    "status", "message", "exitCode", "stdout", "stderr", "stdoutTruncated", "stderrTruncated",
  ]);
  assert.deepEqual(requiredFor("keepkeys_status"), [
    "status", "message", "platform", "version", "vault", "plaintextRetrieval",
  ]);
  assert.equal(schemaFor("keepkeys_status").properties.plaintextRetrieval.const, false);
  assert.deepEqual(requiredFor("keepkeys_doctor"), ["status", "message", "platform", "version"]);
});

function assertReceiptMatchesSchema(toolName, receipt) {
  const tool = TOOLS.find((candidate) => candidate.name === toolName);
  assert.ok(tool, `missing tool descriptor for ${toolName}`);
  const candidates = tool.outputSchema.oneOf ?? [tool.outputSchema];
  const schema = candidates.find((candidate) =>
    Object.entries(candidate.properties ?? {}).every(([key, property]) =>
      property.const === undefined || receipt[key] === property.const,
    ),
  );
  assert.ok(schema, `${toolName} receipt did not match an output variant`);
  for (const key of schema.required ?? []) {
    assert.ok(Object.hasOwn(receipt, key), `${toolName} receipt is missing ${key}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(receipt)) {
      assert.ok(Object.hasOwn(schema.properties, key), `${toolName} added ${key}`);
    }
  }
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (!Object.hasOwn(receipt, key) || property.const !== undefined) continue;
    if (property.type === "string") assert.equal(typeof receipt[key], "string");
    if (property.type === "boolean") assert.equal(typeof receipt[key], "boolean");
    if (property.type === "integer") assert.equal(Number.isInteger(receipt[key]), true);
    if (property.type === "array") assert.equal(Array.isArray(receipt[key]), true);
  }
}

test("every public tool receipt variant is covered by its output schema", () => {
  const metadata = {
    name: "demo-service",
    variable: "DEMO_API_TOKEN",
    description: "Synthetic test metadata",
    provider: "Example",
    documentationUrls: ["https://docs.example.com/api"],
  };
  const receipts = [
    ["keepkeys_store", { status: "ok", message: "Stored.", ...metadata }],
    ["keepkeys_store", { status: "cancelled", message: "Cancelled." }],
    [
      "keepkeys_store_from_phone",
      {
        status: "ready",
        message: "Ready.",
        url: "https://keepkeys.example.ts.net/one-use",
        expiresAt: "2026-07-30T12:00:00.000Z",
        name: metadata.name,
        variable: metadata.variable,
        replacing: false,
        network: "Tailscale Serve",
        publicInternet: false,
      },
    ],
    ["keepkeys_list", { status: "ok", entries: [metadata] }],
    ["keepkeys_rotate", { status: "ok", message: "Rotated.", ...metadata }],
    ["keepkeys_rotate", { status: "cancelled", message: "Cancelled." }],
    ["keepkeys_revoke", { status: "ok", message: "Revoked.", revokedRules: 1 }],
    ["keepkeys_revoke", { status: "cancelled", message: "Cancelled." }],
    ["keepkeys_remove", { status: "ok", message: "Removed.", removed: true }],
    ["keepkeys_remove", { status: "cancelled", message: "Cancelled." }],
    [
      "keepkeys_run",
      {
        status: "ok",
        message: "Command completed.",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ],
    ["keepkeys_run", { status: "cancelled", message: "Cancelled." }],
    [
      "keepkeys_status",
      {
        status: "ok",
        message: "Ready.",
        platform: "macOS",
        version: "0.6.0",
        vault: "Keychain",
        plaintextRetrieval: false,
      },
    ],
    ["keepkeys_doctor", { status: "ok", message: "Doctor passed.", platform: "macOS", version: "0.6.0" }],
  ];
  for (const [toolName, receipt] of receipts) {
    assertReceiptMatchesSchema(toolName, receipt);
  }
});

test("rotation and policy revocation stay metadata-only", () => {
  assert.deepEqual(
    helperArguments("keepkeys_rotate", { name: "github-release" }),
    ["rotate", "--name", "github-release"],
  );
  assert.deepEqual(
    helperArguments("keepkeys_revoke", { name: "github-release" }),
    ["revoke", "--name", "github-release"],
  );
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
    return {
      status: "ok",
      message: "Ready.",
      platform: "macOS",
      version: "0.6.0",
      vault: "Keychain",
      plaintextRetrieval: false,
    };
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
    message: "Ready.",
    platform: "macOS",
    version: "0.6.0",
    vault: "Keychain",
    plaintextRetrieval: false,
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
    const store = helperInvocation(["store", "--name", "demo"], {
      platform,
      environment:
        platform === "win32"
          ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
          : {},
      home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
    });
    assert.equal(store.command, process.execPath);
    assert.match(store.args[0], /keepkeys-store\.mjs$/u);
    assert.deepEqual(store.args.slice(1), ["store", "--name", "demo"]);

    const nativeStore = nativeStoreInvocation(
      ["store", "--name", "demo"],
      {
        platform,
        environment:
          platform === "win32"
            ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
            : {},
        home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
      },
    );
    assert.notEqual(nativeStore.command, process.execPath);
    assert.equal(nativeStore.args.includes("store"), true);
    assert.equal(nativeStore.env.KEEPKEYS_SERIALIZED_MUTATION, "1");

    const remove = helperInvocation(["remove", "--name", "demo"], {
      platform,
      environment:
        platform === "win32"
          ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
          : {},
      home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
    });
    assert.equal(remove.command, process.execPath);
    assert.match(remove.args[0], /keepkeys-store\.mjs$/u);
    assert.deepEqual(remove.args.slice(1), ["remove", "--name", "demo"]);

    const nativeRemove = nativeMutationInvocation(
      ["remove", "--name", "demo"],
      {
        platform,
        environment:
          platform === "win32"
            ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
            : {},
        home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
      },
    );
    assert.notEqual(nativeRemove.command, process.execPath);
    assert.equal(nativeRemove.args.includes("remove"), true);
    assert.equal(nativeRemove.env.KEEPKEYS_SERIALIZED_MUTATION, "1");

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

    const rotate = helperInvocation(["rotate", "--name", "demo"], {
      platform,
      environment:
        platform === "win32"
          ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
          : {},
      home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
    });
    assert.equal(rotate.command, process.execPath);
    assert.match(rotate.args[0], /keepkeys-rotate\.mjs$/u);
    assert.deepEqual(rotate.args.slice(1), ["--name", "demo"]);

    const revoke = nativeMutationInvocation(["revoke", "--name", "demo"], {
      platform,
      environment:
        platform === "win32"
          ? { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\example" }
          : {},
      home: platform === "win32" ? "C:\\Users\\example" : "/home/example",
    });
    assert.notEqual(revoke.command, process.execPath);
    assert.equal(revoke.args.includes("revoke"), true);
    assert.equal(revoke.env.KEEPKEYS_SERIALIZED_MUTATION, "1");
  }
});

test("desktop stores, phone stores, and removals share the same per-name lock", async (context) => {
  const lockRoot = mkdtempSync(join(tmpdir(), "keepkeys-shared-store-lock-"));
  context.after(() => rmSync(lockRoot, { recursive: true, force: true }));
  let firstEnteredResolve;
  const firstEntered = new Promise((resolvePromise) => {
    firstEnteredResolve = resolvePromise;
  });
  let releaseFirst;
  const firstGate = new Promise((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  let secondEntered = false;
  const argumentsValue = ["store", "--name", "demo-service"];
  const first = runSerializedStore(argumentsValue, {
    lockOptions: { lockRoot, retryMs: 10 },
    storeRunner: async () => {
      firstEnteredResolve();
      await firstGate;
      return {
        code: 0,
        signal: null,
        stdout: Buffer.from('{"status":"ok","message":"Stored."}\n'),
        stderr: Buffer.alloc(0),
      };
    },
  });
  await firstEntered;
  const second = runSerializedMutation(
    ["remove", "--name", "demo-service"],
    {
      lockOptions: { lockRoot, retryMs: 10 },
      storeRunner: async () => {
        secondEntered = true;
        return {
          code: 0,
          signal: null,
          stdout: Buffer.from(
            '{"status":"ok","message":"Removed.","removed":true}\n',
          ),
          stderr: Buffer.alloc(0),
        };
      },
    },
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  assert.equal(secondEntered, false);
  releaseFirst();
  await first;
  await second;
  assert.equal(secondEntered, true);
});

test("desktop stores require a valid native commit receipt", async (context) => {
  const lockRoot = mkdtempSync(join(tmpdir(), "keepkeys-store-receipt-"));
  context.after(() => rmSync(lockRoot, { recursive: true, force: true }));
  const argumentsValue = ["store", "--name", "demo-service"];
  await assert.rejects(
    runSerializedStore(argumentsValue, {
      lockOptions: { lockRoot },
      storeRunner: async () => ({
        code: 0,
        signal: null,
        stdout: Buffer.from("not-json"),
        stderr: Buffer.alloc(0),
      }),
    }),
    {
      name: "CleanupError",
      cleanupKind: "native-receipt",
      storageState: "uncertain",
      stored: null,
    },
  );
  const cancelled = await runSerializedStore(argumentsValue, {
    lockOptions: { lockRoot },
    storeRunner: async () => ({
      code: 0,
      signal: null,
      stdout: Buffer.from('{"status":"cancelled","message":"Cancelled."}\n'),
      stderr: Buffer.alloc(0),
    }),
  });
  assert.equal(JSON.parse(cancelled.stdout.toString()).status, "cancelled");
  const nativeFailure = await runSerializedStore(argumentsValue, {
    lockOptions: { lockRoot },
    storeRunner: async () => ({
      code: 1,
      signal: null,
      stdout: Buffer.from('{"status":"error","message":"Rejected."}\n'),
      stderr: Buffer.alloc(0),
    }),
  });
  assert.equal(JSON.parse(nativeFailure.stdout.toString()).status, "error");
});

test("desktop removals require a complete native receipt", async (context) => {
  const lockRoot = mkdtempSync(join(tmpdir(), "keepkeys-remove-receipt-"));
  context.after(() => rmSync(lockRoot, { recursive: true, force: true }));
  await assert.rejects(
    runSerializedMutation(["remove", "--name", "demo-service"], {
      lockOptions: { lockRoot },
      storeRunner: async () => ({
        code: 0,
        signal: null,
        stdout: Buffer.from(
          '{"status":"ok","message":"Removal completed."}\n',
        ),
        stderr: Buffer.alloc(0),
      }),
    }),
    {
      name: "NativeMutationReceiptError",
      cleanupKind: "native-receipt",
      mutationKind: "remove",
      removed: null,
    },
  );
});

test("automatic-approval revocation requires an explicit native receipt", async (context) => {
  const lockRoot = mkdtempSync(join(tmpdir(), "keepkeys-revoke-receipt-"));
  context.after(() => rmSync(lockRoot, { recursive: true, force: true }));
  const result = await runSerializedMutation(["revoke", "--name", "demo-service"], {
    lockOptions: { lockRoot },
    storeRunner: async () => ({
      code: 0,
      signal: null,
      stdout: Buffer.from('{"status":"ok","message":"Revoked.","revokedRules":2}\n'),
      stderr: Buffer.alloc(0),
    }),
  });
  assert.equal(JSON.parse(result.stdout.toString()).revokedRules, 2);
  await assert.rejects(
    runSerializedMutation(["revoke", "--name", "demo-service"], {
      lockOptions: { lockRoot },
      storeRunner: async () => ({
        code: 0,
        signal: null,
        stdout: Buffer.from('{"status":"ok","message":"Revoked."}\n'),
        stderr: Buffer.alloc(0),
      }),
    }),
    { name: "NativeMutationReceiptError", mutationKind: "revoke", revokedRules: null },
  );
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
      timeout: 90_000,
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
    assert.equal(responses[0].result.serverInfo.version, "0.6.0");
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

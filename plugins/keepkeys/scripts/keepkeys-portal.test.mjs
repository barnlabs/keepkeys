import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  processHasExited,
  terminateProcessGracefullyAndWait,
  terminateProcessTreeGracefullyAndWait,
} from "./platform.mjs";
import {
  closePortalServer,
  commitToNativeVault,
  createPortalServer,
  millisecondsUntilExpiry,
  missingNativeCommitReceiptError,
  nativeCommitError,
  parsePortalMetadata,
  portalStartupProcessOptions,
  renderPortalHtml,
  runPortalStartupOperations,
  runProcess,
  serveStatusContainsPath,
  stopOwnedServeProcess,
  trackPortalCommit,
  waitForServeReady,
  watchLauncherConnection,
  withPortalCommitLock,
} from "./keepkeys-portal.mjs";

const metadata = Object.freeze({
  name: "demo-service",
  variable: "DEMO_API_TOKEN",
  description: "Authenticate an approved demo request.",
  provider: "Demo Provider",
  documentationUrls: ["https://example.com/docs/credentials"],
});

function argumentsFor(value = metadata) {
  return [
    "--name",
    value.name,
    "--variable",
    value.variable,
    "--description",
    value.description,
    "--provider",
    value.provider,
    "--documentation-url",
    value.documentationUrls[0],
  ];
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function delay(milliseconds) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

test("portal metadata uses the native KeepKeys limits", () => {
  assert.deepEqual(parsePortalMetadata(argumentsFor()), metadata);
  assert.throws(
    () =>
      parsePortalMetadata(
        argumentsFor({ ...metadata, name: "../wrong" }),
      ),
    /beginning with a letter/u,
  );
  assert.throws(
    () =>
      parsePortalMetadata(
        argumentsFor({ ...metadata, variable: "LD_PRELOAD" }),
      ),
    /path-control/u,
  );
  assert.throws(
    () =>
      parsePortalMetadata(
        argumentsFor({
          ...metadata,
          documentationUrls: ["http://example.com/docs"],
        }),
      ),
    /official HTTPS/u,
  );
});

test("portal teardown is scheduled from the advertised expiry", () => {
  const expiry = Date.parse("2026-07-28T18:00:00.000Z");
  assert.equal(
    millisecondsUntilExpiry("2026-07-28T18:00:00.000Z", expiry - 7500),
    7500,
  );
  assert.equal(
    millisecondsUntilExpiry("2026-07-28T18:00:00.000Z", expiry + 1000),
    0,
  );
  assert.throws(
    () => millisecondsUntilExpiry("not-a-timestamp", 0),
    /invalid portal expiry/u,
  );
});

test("process exit detection does not mistake PID-only cleanup handles for exited children", () => {
  assert.equal(processHasExited({ pid: 123, kill() {} }), false);
  assert.equal(
    processHasExited({ pid: 123, exitCode: null, signalCode: null }),
    false,
  );
  assert.equal(
    processHasExited({ pid: 123, exitCode: 0, signalCode: null }),
    true,
  );
  assert.equal(
    processHasExited({ pid: 123, exitCode: null, signalCode: "SIGKILL" }),
    true,
  );
});

test("portal HTML escapes metadata and loads no third-party resources", () => {
  const html = renderPortalHtml({
    metadata: {
      ...metadata,
      description: "<script>wrong()</script>",
    },
    replacing: true,
    nonce: "test-nonce",
    expiresAt: "2026-07-28T18:00:00.000Z",
  });
  assert.match(html, /&lt;script&gt;wrong\(\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>wrong\(\)<\/script>/u);
  assert.match(html, /This name already exists/u);
  assert.match(html, /KeepKeys cannot clear the phone's clipboard/u);
  assert.match(html, /<form id="store-form" method="post">/u);
  assert.match(html, /<fieldset id="store-controls" disabled>/u);
  assert.doesNotMatch(html, /<input[^>]*\sname=/u);
  assert.doesNotMatch(html, /\sminlength=/u);
  assert.match(html, /controls\.disabled = false/u);
  assert.match(html, /new TextEncoder\(\)\.encode\(input\.value\)\.byteLength/u);
  assert.match(html, /This form is disabled and will not submit a key/u);
  assert.doesNotMatch(html, /https:\/\/(?!example\.com)/u);
});

test("startup helpers receive their own process groups while Serve stays owned", () => {
  assert.deepEqual(
    portalStartupProcessOptions({
      cwd: "/tmp/keepkeys",
      environment: { PATH: "/usr/bin" },
    }),
    {
      cwd: "/tmp/keepkeys",
      env: { PATH: "/usr/bin" },
      detached: true,
    },
  );
  assert.deepEqual(
    portalStartupProcessOptions({
      cwd: "/tmp/keepkeys",
      environment: { PATH: "/usr/bin" },
      detached: false,
    }),
    {
      cwd: "/tmp/keepkeys",
      env: { PATH: "/usr/bin" },
      detached: false,
    },
  );
});

test("launcher disconnects stay armed until the ready link is accepted", () => {
  const connection = new EventEmitter();
  connection.connected = true;
  let disconnects = 0;
  const watcher = watchLauncherConnection(connection, () => {
    disconnects += 1;
  });
  connection.emit("disconnect");
  assert.equal(watcher.disconnected, true);
  assert.equal(disconnects, 1);

  const accepted = new EventEmitter();
  accepted.connected = true;
  const acceptedWatcher = watchLauncherConnection(accepted, () => {
    disconnects += 1;
  });
  acceptedWatcher.disarm();
  accepted.emit("disconnect");
  assert.equal(acceptedWatcher.disconnected, false);
  assert.equal(disconnects, 1);
});

test("portal startup aborts and awaits sibling work after one failure", async () => {
  let siblingSettled = false;
  await assert.rejects(
    runPortalStartupOperations([
      async () => {
        await delay(10);
        throw new Error("Tailscale startup failed.");
      },
      (signal) =>
        new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(resolvePromise, 1000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              setTimeout(() => {
                siblingSettled = true;
                const error = new Error("Sibling startup was aborted.");
                error.name = "AbortError";
                rejectPromise(error);
              }, 25);
            },
            { once: true },
          );
        }),
    ]),
    /Tailscale startup failed/u,
  );
  assert.equal(siblingSettled, true);
});

test("Serve cleanup recognizes only the exact owned path", () => {
  const path = "/keepkeys/store/owned-test-path";
  const status = {
    Foreground: {
      session: {
        Web: {
          "device.example.ts.net:443": {
            Handlers: {
              [path]: { Proxy: "http://127.0.0.1:12345" },
              "/unrelated": { Proxy: "http://127.0.0.1:54321" },
            },
          },
        },
      },
    },
  };
  assert.equal(serveStatusContainsPath(status, path), true);
  assert.equal(
    serveStatusContainsPath(status, "/keepkeys/store/different"),
    false,
  );
});

test("graceful process cleanup waits for confirmed exit", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)",
    ],
    {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await terminateProcessGracefullyAndWait(child);
  assert.equal(processHasExited(child), true);
});

test("a slow Serve startup is gracefully stopped before timeout rejection", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)",
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  await assert.rejects(
    waitForServeReady(child, 50),
    /Tailscale Serve did not become ready/u,
  );
  assert.equal(processHasExited(child), true);
});

test("Serve readiness stops capturing output for the active session", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "process.stdout.write('Available within your tailnet:\\n');",
        "setInterval(()=>process.stdout.write('later output\\n'),5);",
      ].join(""),
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  try {
    await waitForServeReady(child, 1000);
    assert.equal(child.stdout.listenerCount("data"), 0);
    assert.equal(child.stderr.listenerCount("data"), 0);
  } finally {
    await terminateProcessGracefullyAndWait(child);
  }
});

test("Serve exit after readiness is reported to the active portal", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "process.stdout.write('Available within your tailnet:\\n');",
        "setTimeout(()=>process.exit(0),25);",
      ].join(""),
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let unexpectedExitResolve;
  const unexpectedExit = new Promise((resolvePromise) => {
    unexpectedExitResolve = resolvePromise;
  });
  await waitForServeReady(child, 1000, unexpectedExitResolve);
  await unexpectedExit;
  assert.equal(processHasExited(child), true);
});

test("Serve cleanup fails closed when the route is absent but its child survives", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000)",
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    },
  );
  await once(child.stdout, "data");
  let routeChecks = 0;
  await assert.rejects(
    stopOwnedServeProcess(
      child,
      async () => {
        routeChecks += 1;
      },
      {
        platform: process.platform,
        timeoutMs: 50,
        signalProcessGroup: () => {},
      },
    ),
    /forced Tailscale Serve to stop/u,
  );
  assert.equal(routeChecks, 1);
  assert.equal(processHasExited(child), true);
});

test("Serve cleanup awaits process exit when route verification fails", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),50));setInterval(()=>{},1000)",
    ],
    {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await assert.rejects(
    stopOwnedServeProcess(
      child,
      async () => {
        throw new Error("Route verification failed.");
      },
      {
        platform: process.platform,
        timeoutMs: 1000,
        signalProcessGroup: () => {},
      },
    ),
    /Route verification failed/u,
  );
  assert.equal(processHasExited(child), true);
});

test("graceful process-tree cleanup waits for confirmed exit", async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), "keepkeys-tree-"));
  const marker = resolve(temporary, "survived");
  let grandchildPid;
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "const {spawn}=require('node:child_process');",
        "const child=spawn(process.execPath,['-e',",
        JSON.stringify(
          "process.on('SIGTERM',()=>process.exit(0));setTimeout(()=>require('node:fs').writeFileSync(process.env.KEEPKEYS_TREE_MARKER,'survived'),750);setInterval(()=>{},1000)",
        ),
        "],{env:{...process.env,KEEPKEYS_TREE_MARKER:process.env.KEEPKEYS_TREE_MARKER},stdio:'ignore'});",
        "process.stdout.write(`${child.pid}\\n`);",
        "process.on('SIGTERM',()=>process.exit(0));",
        "setInterval(()=>{},1000);",
      ].join(""),
    ],
    {
      detached: process.platform !== "win32",
      env: { ...process.env, KEEPKEYS_TREE_MARKER: marker },
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    },
  );
  try {
    const [pidOutput] = await once(child.stdout, "data");
    grandchildPid = Number.parseInt(pidOutput.toString("utf8"), 10);
    assert(Number.isSafeInteger(grandchildPid));
    await terminateProcessTreeGracefullyAndWait(child);
    assert.equal(processHasExited(child), true);
    await delay(1000);
    await assert.rejects(access(marker));
  } finally {
    if (!processHasExited(child)) child.kill("SIGKILL");
    if (grandchildPid) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // The expected path: the process tree is already gone.
      }
    }
    await rm(temporary, { recursive: true, force: true });
  }
});

test("portal cleanup closes active localhost connections", async () => {
  const server = createPortalServer({
    metadata,
    replacing: false,
    path: "/keepkeys/store/cleanup-test",
    cookieToken: "cleanup-cookie-token",
    expectedOrigin: "https://device.example.ts.net",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => ({ status: "ok" }),
  });
  const base = await listen(server);
  const address = new URL(base);
  const socket = createConnection({
    host: address.hostname,
    port: Number(address.port),
  });
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.write("GET /keepkeys/store/cleanup-test HTTP/1.1\r\n");
  await closePortalServer(server);
  if (!socket.destroyed) {
    await new Promise((resolvePromise) => {
      socket.once("close", resolvePromise);
    });
  }
  assert.equal(server.listening, false);
});

test("portal requires Tailscale identity, same-origin cookie, and one use", async (context) => {
  let committed;
  let storedResolve;
  const stored = new Promise((resolvePromise) => {
    storedResolve = resolvePromise;
  });
  const path = "/keepkeys/store/test-session";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "test-cookie-token",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async (secret) => {
      committed = Buffer.from(secret);
      return { status: "ok", message: "Stored the synthetic key." };
    },
    onTerminal: storedResolve,
  });
  context.after(() => {
    server.close();
    committed?.fill(0);
  });
  const base = await listen(server);

  const unauthenticated = await fetch(`${base}${path}`);
  assert.equal(unauthenticated.status, 403);

  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control") ?? "", /no-store/u);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/u);
  const setCookie = page.headers.get("set-cookie");
  assert(setCookie);
  const cookie = setCookie.split(";")[0];

  const wrongOrigin = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: "https://wrong.example.ts.net",
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(wrongOrigin.status, 403);

  const secret = "🔑🔐";
  assert.equal(Buffer.byteLength(secret, "utf8"), 8);
  const storedResponse = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: secret,
  });
  assert.equal(storedResponse.status, 200);
  assert.deepEqual(await storedResponse.json(), {
    status: "ok",
    message: "Stored the synthetic key.",
  });
  await stored;
  assert.equal(committed?.toString("utf8"), secret);

  const reused = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  assert.equal(reused.status, 410);
});

test("phone success waits for owned Serve cleanup confirmation", async (context) => {
  let finalizeStartedResolve;
  const finalizeStarted = new Promise((resolvePromise) => {
    finalizeStartedResolve = resolvePromise;
  });
  let releaseFinalize;
  const finalizeGate = new Promise((resolvePromise) => {
    releaseFinalize = resolvePromise;
  });
  const path = "/keepkeys/store/deferred-success";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "deferred-success-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => ({ status: "ok" }),
    finalizeSuccess: async () => {
      finalizeStartedResolve();
      await finalizeGate;
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
  let responseSettled = false;
  const submission = fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  }).finally(() => {
    responseSettled = true;
  });
  await finalizeStarted;
  await delay(25);
  assert.equal(responseSettled, false);
  releaseFinalize();
  assert.equal((await submission).status, 200);
});

test("post-store Serve cleanup failures are visible to the phone", async (context) => {
  let terminalResolve;
  const terminal = new Promise((resolvePromise) => {
    terminalResolve = resolvePromise;
  });
  const path = "/keepkeys/store/cleanup-failure";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "cleanup-failure-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => ({ status: "ok" }),
    finalizeSuccess: async () => {
      throw new Error("Synthetic Serve cleanup failure.");
    },
    onTerminal: terminalResolve,
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    status: "error",
    stored: true,
    message:
      "The key was stored, but KeepKeys could not verify that its private Tailscale route closed. Stop the owned KeepKeys Serve route before using this link again.",
  });
  await terminal;
});

test("post-commit lock cleanup failures stay visible as stored", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "keepkeys-lock-cleanup-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const commitState = {
    active: undefined,
    cleanupError: undefined,
  };
  const path = "/keepkeys/store/lock-cleanup-failure";
  const expectedOrigin = "https://device.example.ts.net";
  let nativeWriteCompleted = false;
  let finalizeCalled = false;
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "lock-cleanup-failure-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: () =>
      trackPortalCommit(
        withPortalCommitLock(
          metadata.name,
          async () => {
            nativeWriteCompleted = true;
            return { status: "ok" };
          },
          {
            lockRoot: temporary,
            removeLock: async () => {
              throw new Error("Synthetic lock removal failure.");
            },
          },
        ),
        commitState,
      ),
    finalizeSuccess: async () => {
      finalizeCalled = true;
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    status: "error",
    stored: true,
    message:
      "The key was stored, but KeepKeys could not remove its private commit lock. Check the connected host before retrying this name.",
  });
  assert.equal(nativeWriteCompleted, true);
  assert.equal(finalizeCalled, false);
  assert.equal(commitState.active, undefined);
  assert.equal(commitState.cleanupError?.name, "CleanupError");
  assert.equal(commitState.cleanupError?.stored, true);
});

test("portal refuses cross-identity submission and short values", async (context) => {
  let calls = 0;
  let terminalResolve;
  const terminal = new Promise((resolvePromise) => {
    terminalResolve = resolvePromise;
  });
  const path = "/keepkeys/store/test-session-two";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "second-cookie-token",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => {
      calls += 1;
      return { status: "ok" };
    },
    onTerminal: terminalResolve,
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];

  const crossIdentity = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "other@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(crossIdentity.status, 403);

  const short = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "short",
  });
  assert.equal(short.status, 400);
  await terminal;
  assert.equal(calls, 0);

  const retried = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(retried.status, 410);
});

test("portal refuses another browser, the wrong media type, and oversized values", async (context) => {
  let calls = 0;
  const path = "/keepkeys/store/test-session-three";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "third-cookie-token",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => {
      calls += 1;
      return { status: "ok" };
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];

  const secondBrowserPage = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  assert.equal(secondBrowserPage.status, 403);

  const originalBrowserRefresh = await fetch(`${base}${path}`, {
    headers: {
      Cookie: cookie,
      "Tailscale-User-Login": "owner@example.com",
    },
  });
  assert.equal(originalBrowserRefresh.status, 200);
  assert.equal(originalBrowserRefresh.headers.get("set-cookie"), null);

  const anotherBrowser = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(anotherBrowser.status, 403);

  const wrongType = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "\"synthetic_secret\"",
  });
  assert.equal(wrongType.status, 403);

  const oversized = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "x".repeat(2049),
  });
  assert.equal(oversized.status, 400);
  assert.equal(calls, 0);
});

test("portal refuses an expired page before binding a browser", async (context) => {
  let calls = 0;
  const path = "/keepkeys/store/expired-session";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "expired-cookie-token",
    expectedOrigin: "https://device.example.ts.net",
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    commitSecret: async () => {
      calls += 1;
      return { status: "ok" };
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  assert.equal(response.status, 410);
  assert.equal(calls, 0);
});

test("native commit failure makes the phone session terminal", async (context) => {
  let terminalCalls = 0;
  let terminalResolve;
  const terminal = new Promise((resolvePromise) => {
    terminalResolve = resolvePromise;
  });
  const path = "/keepkeys/store/failed-commit";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "failed-commit-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => {
      throw new Error("Synthetic native-vault failure.");
    },
    onTerminal: () => {
      terminalCalls += 1;
      terminalResolve();
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];

  const failed = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    status: "error",
    stored: false,
    message:
      "KeepKeys could not store this key. The value was discarded. Start a new phone intake and try again.",
  });
  await terminal;
  assert.equal(terminalCalls, 1);

  const reused = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "another_synthetic_secret",
  });
  assert.equal(reused.status, 410);
});

test("native rollback uncertainty never claims the value was discarded", async (context) => {
  const path = "/keepkeys/store/uncertain-rollback";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "uncertain-rollback-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => {
      throw nativeCommitError({
        status: "error",
        storageState: "uncertain",
        cleanupKind: "native-rollback",
      });
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];

  const failed = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    status: "error",
    stored: null,
    storageState: "uncertain",
    message:
      "KeepKeys could not confirm whether the key remained after native-vault rollback failed. Check the connected host and remove this name before retrying.",
  });
});

test("a missing native commit receipt is reported as uncertain", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "keepkeys-receipt-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const secret = Buffer.from("synthetic_secret", "utf8");
  context.after(() => secret.fill(0));
  const invocationBuilder = () => ({
    command: "synthetic-native-helper",
    args: [],
    env: { KEEPKEYS_PLUGIN_ROOT: temporary },
  });
  for (const processRunner of [
    async () => {
      throw new Error("Synthetic helper disconnect.");
    },
    async () => ({
      code: 0,
      stdout: Buffer.from("not-json", "utf8"),
      stderr: Buffer.alloc(0),
    }),
    async () => ({
      code: 1,
      stdout: Buffer.from('{"status":"ok"}\n', "utf8"),
      stderr: Buffer.alloc(0),
    }),
  ]) {
    await assert.rejects(
      commitToNativeVault(metadata, false, secret, undefined, {
        invocationBuilder,
        processRunner,
        lockOptions: { lockRoot: temporary },
      }),
      {
        name: "CleanupError",
        cleanupKind: "native-receipt",
        storageState: "uncertain",
        stored: null,
      },
    );
  }

  const path = "/keepkeys/store/missing-native-receipt";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "missing-native-receipt-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => {
      throw missingNativeCommitReceiptError(
        new Error("Synthetic helper disconnect."),
      );
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
  const failed = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    status: "error",
    stored: null,
    storageState: "uncertain",
    message:
      "KeepKeys did not receive a valid native commit receipt, so it cannot confirm whether the key was stored. Check the connected host and remove this name before retrying.",
  });
});

test("native rollback uncertainty survives simultaneous lock cleanup failure", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "keepkeys-uncertain-lock-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  let combinedError;
  await assert.rejects(
    withPortalCommitLock(
      metadata.name,
      async () => {
        throw nativeCommitError({
          status: "error",
          storageState: "uncertain",
          cleanupKind: "native-rollback",
        });
      },
      {
        lockRoot: temporary,
        removeLock: async () => {
          throw new Error("Synthetic lock removal failure.");
        },
      },
    ),
    (error) => {
      combinedError = error;
      return (
        error?.name === "CleanupError" &&
        error?.storageState === "uncertain" &&
        error?.cleanupKind === "native-rollback+portal-lock" &&
        error?.stored === null
      );
    },
  );

  const path = "/keepkeys/store/uncertain-rollback-and-lock";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "uncertain-rollback-and-lock-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => {
      throw combinedError;
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
  const failed = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    status: "error",
    stored: null,
    storageState: "uncertain",
    message:
      "KeepKeys could not confirm the final native-vault state, and it could not remove the private commit lock. Check the connected host, remove this name, and confirm the lock is gone before retrying.",
  });
});

test("the first valid POST atomically claims the one-time session", async (context) => {
  let calls = 0;
  let commitStartedResolve;
  const commitStarted = new Promise((resolvePromise) => {
    commitStartedResolve = resolvePromise;
  });
  let releaseCommit;
  const commitGate = new Promise((resolvePromise) => {
    releaseCommit = resolvePromise;
  });
  const path = "/keepkeys/store/concurrent-session";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "concurrent-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    commitSecret: async () => {
      calls += 1;
      commitStartedResolve();
      await commitGate;
      return { status: "ok" };
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  };
  const first = fetch(`${base}${path}`, requestOptions);
  await commitStarted;
  const second = await fetch(`${base}${path}`, requestOptions);
  assert.equal(second.status, 409);
  releaseCommit();
  assert.equal((await first).status, 200);
  assert.equal(calls, 1);
});

test("closing a portal aborts its in-flight commit", async (context) => {
  const controller = new AbortController();
  let observedSignal;
  let commitStartedResolve;
  const commitStarted = new Promise((resolvePromise) => {
    commitStartedResolve = resolvePromise;
  });
  const path = "/keepkeys/store/abort-session";
  const expectedOrigin = "https://device.example.ts.net";
  const server = createPortalServer({
    metadata,
    replacing: false,
    path,
    cookieToken: "abort-cookie",
    expectedOrigin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    abortSignal: controller.signal,
    commitSecret: async (_secret, signal) => {
      observedSignal = signal;
      commitStartedResolve();
      await new Promise((resolvePromise, rejectPromise) => {
        signal.addEventListener(
          "abort",
          () => rejectPromise(new Error("Synthetic abort.")),
          { once: true },
        );
      });
      return { status: "ok" };
    },
  });
  context.after(() => server.close());
  const base = await listen(server);
  const page = await fetch(`${base}${path}`, {
    headers: { "Tailscale-User-Login": "owner@example.com" },
  });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
  const submission = fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
      Origin: expectedOrigin,
      "Tailscale-User-Login": "owner@example.com",
    },
    body: "synthetic_secret",
  });
  await commitStarted;
  controller.abort();
  assert.equal(observedSignal, controller.signal);
  assert.equal(observedSignal.aborted, true);
  assert.equal((await submission).status, 500);
});

test("aborting a helper process prevents a delayed write", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "keepkeys-abort-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const ready = resolve(temporary, "ready");
  const marker = resolve(temporary, "late-write");
  const controller = new AbortController();
  const child = runProcess(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');setTimeout(()=>fs.writeFileSync(process.argv[2],'wrong'),2000);setInterval(()=>{},1000);",
      ready,
      marker,
    ],
    { signal: controller.signal },
  );
  let helperReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(ready);
      helperReady = true;
      break;
    } catch {
      await delay(50);
    }
  }
  assert.equal(helperReady, true);
  controller.abort();
  await assert.rejects(child, { name: "AbortError" });
  await delay(2200);
  await assert.rejects(access(marker));
});

test("aborting a startup helper terminates its descendants", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "keepkeys-tree-abort-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const ready = resolve(temporary, "ready");
  const marker = resolve(temporary, "descendant-late-write");
  const controller = new AbortController();
  const child = runProcess(
    process.execPath,
    [
      "-e",
      [
        "const {spawn}=require('node:child_process');",
        "const fs=require('node:fs');",
        "spawn(process.execPath,['-e',",
        "\"const fs=require('node:fs');setTimeout(()=>fs.writeFileSync(process.argv[1],'wrong'),2000);setInterval(()=>{},1000)\",",
        "process.argv[2]],{stdio:'ignore'});",
        "fs.writeFileSync(process.argv[1],'ready');",
        "setInterval(()=>{},1000);",
      ].join(""),
      ready,
      marker,
    ],
    {
      ...portalStartupProcessOptions(),
      signal: controller.signal,
    },
  );
  let helperReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(ready);
      helperReady = true;
      break;
    } catch {
      await delay(50);
    }
  }
  assert.equal(helperReady, true);
  controller.abort();
  await assert.rejects(child, { name: "AbortError" });
  await delay(2200);
  await assert.rejects(access(marker));
});

test("helper abort surfaces an unconfirmed termination", async () => {
  const controller = new AbortController();
  const child = runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    {
      signal: controller.signal,
      terminateProcessTree: async (processValue) => {
        processValue.kill("SIGKILL");
        throw new Error("Synthetic termination confirmation failure.");
      },
    },
  );
  controller.abort();
  await assert.rejects(child, {
    name: "CleanupError",
    message: /could not confirm that the native helper stopped/u,
  });
});

test("settled helper cleanup failures remain available to portal teardown", async () => {
  const cleanupError = new Error("Synthetic cleanup confirmation failure.");
  cleanupError.name = "CleanupError";
  const state = {
    active: undefined,
    cleanupError: undefined,
  };
  const tracked = trackPortalCommit(
    Promise.reject(cleanupError),
    state,
  );
  await assert.rejects(tracked, { name: "CleanupError" });
  assert.equal(state.active, undefined);
  assert.equal(state.cleanupError, cleanupError);
});

test("native rollback uncertainty remains available to portal teardown", async () => {
  const cleanupError = nativeCommitError({
    status: "error",
    storageState: "uncertain",
    cleanupKind: "native-rollback",
  });
  const state = {
    active: undefined,
    cleanupError: undefined,
  };
  const tracked = trackPortalCommit(
    Promise.reject(cleanupError),
    state,
  );
  await assert.rejects(tracked, {
    name: "CleanupError",
    cleanupKind: "native-rollback",
    storageState: "uncertain",
  });
  assert.equal(state.active, undefined);
  assert.equal(state.cleanupError, cleanupError);
});

test("the per-name portal lock serializes independent processes", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "keepkeys-lock-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const marker = resolve(temporary, "entered");
  let firstEnteredResolve;
  const firstEntered = new Promise((resolvePromise) => {
    firstEnteredResolve = resolvePromise;
  });
  let releaseFirst;
  const firstGate = new Promise((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  const first = withPortalCommitLock(
    "demo-service",
    async () => {
      firstEnteredResolve();
      await firstGate;
    },
    { lockRoot: temporary, retryMs: 10 },
  );
  await firstEntered;

  const moduleUrl = new URL("./keepkeys-portal.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {writeFile} from 'node:fs/promises';const {withPortalCommitLock}=await import(${JSON.stringify(moduleUrl)});process.stdout.write('waiting\\n');await withPortalCommitLock('demo-service',()=>writeFile(process.env.KEEPKEYS_TEST_MARKER,'entered'),{lockRoot:process.env.KEEPKEYS_TEST_LOCK_ROOT,retryMs:10});`,
    ],
    {
      env: {
        ...process.env,
        KEEPKEYS_TEST_LOCK_ROOT: temporary,
        KEEPKEYS_TEST_MARKER: marker,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await once(child.stdout, "data");
  await delay(100);
  await assert.rejects(access(marker));
  releaseFirst();
  await first;
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  assert.equal(await readFile(marker, "utf8"), "entered");
});

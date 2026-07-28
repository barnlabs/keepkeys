import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { processHasExited } from "./platform.mjs";
import {
  createPortalServer,
  millisecondsUntilExpiry,
  parsePortalMetadata,
  renderPortalHtml,
  runProcess,
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
  assert.doesNotMatch(html, /https:\/\/(?!example\.com)/u);
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

  const secret = "synthetic_secret";
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

import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import {
  createPortalServer,
  parsePortalMetadata,
  renderPortalHtml,
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
    onStored: storedResolve,
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
  assert.equal(calls, 0);
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

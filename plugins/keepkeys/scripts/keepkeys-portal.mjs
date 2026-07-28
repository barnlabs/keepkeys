#!/usr/bin/env node

import { fork, spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  helperInvocation,
  portalCommitInvocation,
  terminateProcessTree,
  terminateProcessTreeAndWait,
} from "./platform.mjs";

const MAX_SECRET_BYTES = 2048;
const MAX_PROCESS_OUTPUT = 1024 * 1024;
const SESSION_TTL_MS = 10 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 20 * 1000;
const PORTAL_PREFIX = "/keepkeys/store";
const PORTAL_CHILD_FLAG = "KEEPKEYS_PORTAL_SESSION_CHILD";
const PORTAL_NATIVE_TEST_FLAG = "KEEPKEYS_PORTAL_NATIVE_TEST";
const PORTAL_CAPABILITY_BYTES = 32;
const PORTAL_LOCK_TIMEOUT_MS = 30 * 1000;
const RESERVED_VARIABLES = new Set([
  "BASH_ENV",
  "CDPATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "ENV",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "HOME",
  "IFS",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "LOGNAME",
  "NODE_OPTIONS",
  "OLDPWD",
  "PATH",
  "PERL5OPT",
  "PWD",
  "PYTHONHOME",
  "PYTHONPATH",
  "RUBYOPT",
  "SHELL",
  "SSH_AUTH_SOCK",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
]);

function fail(message) {
  process.stdout.write(`${JSON.stringify({ status: "error", message })}\n`);
  process.exitCode = 1;
}

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function option(argumentsValue, name) {
  const index = argumentsValue.indexOf(name);
  if (index < 0) return undefined;
  const value = argumentsValue[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function requiredOption(argumentsValue, name) {
  const value = option(argumentsValue, name);
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}

function repeatedOptions(argumentsValue, name) {
  const values = [];
  for (let index = 0; index < argumentsValue.length; index += 1) {
    if (argumentsValue[index] !== name) continue;
    const value = argumentsValue[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    values.push(value);
  }
  return values;
}

export function parsePortalMetadata(argumentsValue) {
  const metadata = {
    name: requiredOption(argumentsValue, "--name"),
    variable: requiredOption(argumentsValue, "--variable").toUpperCase(),
    description: requiredOption(argumentsValue, "--description"),
    provider: requiredOption(argumentsValue, "--provider"),
    documentationUrls: repeatedOptions(argumentsValue, "--documentation-url"),
  };
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(metadata.name)) {
    throw new Error(
      "Use 1-128 ASCII letters, digits, periods, underscores, or hyphens, beginning with a letter.",
    );
  }
  if (
    !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(metadata.variable) ||
    RESERVED_VARIABLES.has(metadata.variable) ||
    metadata.variable.startsWith("DYLD_") ||
    metadata.variable.startsWith("LD_")
  ) {
    throw new Error(
      "Use an uppercase environment-variable name that is not a shell, loader, runtime, or path-control variable.",
    );
  }
  if (
    !metadata.description ||
    utf8Bytes(metadata.description) > 240 ||
    hasControlCharacters(metadata.description)
  ) {
    throw new Error("Use a one-line description of at most 240 UTF-8 bytes.");
  }
  if (
    !metadata.provider ||
    utf8Bytes(metadata.provider) > 80 ||
    hasControlCharacters(metadata.provider)
  ) {
    throw new Error("Use a visible provider name of at most 80 UTF-8 bytes.");
  }
  if (
    metadata.documentationUrls.length < 1 ||
    metadata.documentationUrls.length > 3 ||
    new Set(metadata.documentationUrls).size !== metadata.documentationUrls.length
  ) {
    throw new Error("Use one to three distinct official HTTPS documentation links.");
  }
  let documentationBytes = 0;
  for (const value of metadata.documentationUrls) {
    documentationBytes += utf8Bytes(value);
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Use one to three distinct official HTTPS documentation links.");
    }
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      utf8Bytes(value) > 1024 ||
      hasControlCharacters(value)
    ) {
      throw new Error("Use one to three distinct official HTTPS documentation links.");
    }
  }
  if (documentationBytes > 1800) {
    throw new Error("Official documentation links must total at most 1800 UTF-8 bytes.");
  }
  return metadata;
}

function metadataArguments(metadata) {
  const values = [
    "--name",
    metadata.name,
    "--variable",
    metadata.variable,
    "--description",
    metadata.description,
    "--provider",
    metadata.provider,
  ];
  for (const url of metadata.documentationUrls) {
    values.push("--documentation-url", url);
  }
  return values;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPortalHtml({ metadata, replacing, nonce, expiresAt }) {
  const links = metadata.documentationUrls
    .map(
      (url) =>
        `<li><a href="${escapeHtml(url)}" rel="noreferrer noopener">${escapeHtml(url)}</a></li>`,
    )
    .join("");
  const replacement = replacing
    ? `<div class="warning"><strong>This name already exists.</strong> Paste &amp; Store will replace its value and metadata.</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Store ${escapeHtml(metadata.name)} with KeepKeys</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #14211d; color: #1f2d27; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at top, #29433a 0, #14211d 58%); }
    main { width: min(100%, 560px); background: #fff8ec; border: 1px solid #c79a45; border-radius: 20px; padding: 26px; box-shadow: 0 20px 70px rgba(0,0,0,.35); }
    .eyebrow { margin: 0 0 8px; color: #41544c; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(27px, 7vw, 38px); line-height: 1.05; }
    .lede { margin: 12px 0 22px; color: #41544c; line-height: 1.5; }
    dl { display: grid; grid-template-columns: minmax(90px, auto) 1fr; gap: 9px 14px; margin: 0 0 18px; padding: 16px; background: #f4ead8; border-radius: 12px; }
    dt { color: #41544c; font-size: 13px; font-weight: 700; }
    dd { margin: 0; overflow-wrap: anywhere; }
    ul { margin: 7px 0 20px; padding-left: 20px; }
    a { color: #8b492f; }
    label { display: block; margin-bottom: 8px; font-weight: 800; }
    input { width: 100%; min-height: 52px; padding: 13px 14px; border: 2px solid #41544c; border-radius: 10px; background: white; color: #14211d; font: inherit; font-size: 16px; }
    input:focus { outline: 3px solid rgba(217,108,77,.35); border-color: #d96c4d; }
    button { width: 100%; min-height: 52px; margin-top: 12px; border: 0; border-radius: 10px; background: #d96c4d; color: white; font: inherit; font-weight: 850; cursor: pointer; }
    button:disabled { cursor: wait; opacity: .65; }
    .warning { margin: 0 0 18px; padding: 12px 14px; border-left: 4px solid #d96c4d; background: #f7dfd5; line-height: 1.4; }
    .fine { margin: 13px 0 0; color: #41544c; font-size: 13px; line-height: 1.45; }
    #status { min-height: 22px; margin: 11px 0 0; color: #8b2d1d; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">KeepKeys private phone intake</p>
    <h1>Paste the key on this device.</h1>
    <p class="lede">This one-time page is available only inside your Tailscale network. The key goes to this computer's operating-system vault. It is not returned to ChatGPT, Codex, or BarnLabs.</p>
    <dl>
      <dt>Name</dt><dd>${escapeHtml(metadata.name)}</dd>
      <dt>Variable</dt><dd>${escapeHtml(metadata.variable)}</dd>
      <dt>Provider</dt><dd>${escapeHtml(metadata.provider)}</dd>
      <dt>Purpose</dt><dd>${escapeHtml(metadata.description)}</dd>
    </dl>
    <p class="eyebrow">Official documentation</p>
    <ul>${links}</ul>
    ${replacement}
    <form id="store-form">
      <label for="secret">Key</label>
      <input id="secret" name="secret" type="password" minlength="8" maxlength="2048" autocomplete="off" autocapitalize="none" spellcheck="false" required autofocus>
      <button id="store-button" type="submit">Paste &amp; Store</button>
      <p id="status" role="status" aria-live="polite"></p>
    </form>
    <p class="fine">The page expires at ${escapeHtml(expiresAt)}. KeepKeys cannot clear the phone's clipboard or its clipboard history, so copy the key only when this page is ready and submit it right away.</p>
  </main>
  <script nonce="${nonce}">
    const form = document.getElementById("store-form");
    const input = document.getElementById("secret");
    const button = document.getElementById("store-button");
    const status = document.getElementById("status");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      status.textContent = "Storing…";
      try {
        const response = await fetch(window.location.href, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: input.value,
          cache: "no-store",
          redirect: "error"
        });
        const result = await response.json();
        input.value = "";
        if (!response.ok || result.status !== "ok") {
          throw new Error(result.message || "KeepKeys could not store this key.");
        }
        form.innerHTML = "<p><strong>Stored.</strong> You can close this page and return to ChatGPT.</p>";
      } catch (error) {
        input.value = "";
        status.textContent = error instanceof Error ? error.message : "KeepKeys could not store this key.";
        button.disabled = false;
        input.focus();
      }
    });
  </script>
</body>
</html>`;
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function securityHeaders(nonce) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": `default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(response, statusCode, payload, nonce) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(statusCode, {
    ...securityHeaders(nonce),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  response.end(body);
}

function suppliedSessionCookie(request) {
  const cookie = request.headers.cookie ?? "";
  return cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("keepkeys_session="))
    ?.slice("keepkeys_session=".length);
}

function validSessionCookie(request, cookieToken) {
  const suppliedCookie = suppliedSessionCookie(request);
  return (
    typeof suppliedCookie === "string" &&
    constantTimeEqual(suppliedCookie, cookieToken)
  );
}

function safeSendJson(response, statusCode, payload, nonce) {
  if (response.destroyed || response.headersSent) return;
  sendJson(response, statusCode, payload, nonce);
}

export function createPortalServer({
  metadata,
  replacing,
  path,
  cookieToken,
  expectedOrigin,
  expiresAt,
  commitSecret,
  abortSignal,
  onTerminal = () => {},
}) {
  const nonce = randomBytes(18).toString("base64url");
  let boundIdentity;
  let committing = false;
  let completed = false;
  let terminalNotified = false;
  const finishTerminal = () => {
    completed = true;
    committing = false;
    if (terminalNotified) return;
    terminalNotified = true;
    setImmediate(onTerminal);
  };
  const server = createServer((request, response) => {
    const identity = request.headers["tailscale-user-login"];
    if (typeof identity !== "string" || !identity) {
      sendJson(
        response,
        403,
        {
          status: "error",
          message: "Open this link from a signed-in device on the same Tailscale network.",
        },
        nonce,
      );
      request.resume();
      return;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(request.url ?? "/", expectedOrigin);
    } catch {
      sendJson(response, 400, { status: "error", message: "Invalid request." }, nonce);
      request.resume();
      return;
    }
    if (
      (parsedUrl.pathname !== path && parsedUrl.pathname !== "/") ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      sendJson(response, 404, { status: "error", message: "This KeepKeys link is not valid." }, nonce);
      request.resume();
      return;
    }
    if (Date.now() >= Date.parse(expiresAt)) {
      sendJson(response, 410, { status: "error", message: "This KeepKeys link has expired." }, nonce);
      request.resume();
      return;
    }
    if (request.method === "GET") {
      if (completed) {
        sendJson(response, 410, { status: "error", message: "This KeepKeys link has already been used." }, nonce);
        return;
      }
      if (boundIdentity && boundIdentity !== identity) {
        sendJson(response, 403, { status: "error", message: "This KeepKeys link is already open on another Tailscale identity." }, nonce);
        return;
      }
      if (boundIdentity && !validSessionCookie(request, cookieToken)) {
        sendJson(response, 403, { status: "error", message: "This KeepKeys link is already open in another browser." }, nonce);
        return;
      }
      const firstOpen = !boundIdentity;
      boundIdentity ??= identity;
      const body = Buffer.from(
        renderPortalHtml({ metadata, replacing, nonce, expiresAt }),
        "utf8",
      );
      const headers = {
        ...securityHeaders(nonce),
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
      };
      if (firstOpen) {
        headers["Set-Cookie"] =
          `keepkeys_session=${cookieToken}; Secure; HttpOnly; SameSite=Strict; Path=${path}`;
      }
      response.writeHead(200, headers);
      response.end(body);
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      sendJson(response, 405, { status: "error", message: "Method not allowed." }, nonce);
      request.resume();
      return;
    }
    if (completed) {
      sendJson(response, 410, { status: "error", message: "This KeepKeys link has already been used." }, nonce);
      request.resume();
      return;
    }
    if (committing) {
      sendJson(response, 409, { status: "error", message: "This KeepKeys link is already being used." }, nonce);
      request.resume();
      return;
    }
    if (!boundIdentity || boundIdentity !== identity) {
      sendJson(response, 403, { status: "error", message: "Open the KeepKeys page before submitting a key." }, nonce);
      request.resume();
      return;
    }
    const origin = request.headers.origin;
    if (
      origin !== expectedOrigin ||
      !validSessionCookie(request, cookieToken) ||
      !/^text\/plain(?:\s*;\s*charset=utf-8)?$/iu.test(
        String(request.headers["content-type"] ?? ""),
      )
    ) {
      sendJson(response, 403, { status: "error", message: "KeepKeys rejected this browser request." }, nonce);
      request.resume();
      return;
    }
    committing = true;
    const declaredLength = Number.parseInt(String(request.headers["content-length"] ?? ""), 10);
    if (!Number.isInteger(declaredLength) || declaredLength < 8 || declaredLength > MAX_SECRET_BYTES) {
      sendJson(response, 400, { status: "error", message: "Keys must contain 8-2048 UTF-8 bytes." }, nonce);
      request.resume();
      finishTerminal();
      return;
    }
    const chunks = [];
    let byteCount = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      byteCount += chunk.length;
      if (byteCount > MAX_SECRET_BYTES) {
        rejected = true;
        for (const value of chunks) value.fill(0);
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on("aborted", () => {
      for (const value of chunks) value.fill(0);
      chunks.length = 0;
      finishTerminal();
    });
    request.on("error", () => {
      for (const value of chunks) value.fill(0);
      chunks.length = 0;
      finishTerminal();
    });
    request.on("end", async () => {
      if (completed) {
        for (const value of chunks) value.fill(0);
        chunks.length = 0;
        return;
      }
      if (rejected || byteCount !== declaredLength || byteCount < 8) {
        for (const value of chunks) value.fill(0);
        chunks.length = 0;
        safeSendJson(
          response,
          400,
          { status: "error", message: "Keys must contain 8-2048 UTF-8 bytes." },
          nonce,
        );
        finishTerminal();
        return;
      }
      const secret = Buffer.concat(chunks, byteCount);
      for (const value of chunks) value.fill(0);
      chunks.length = 0;
      try {
        const result = await commitSecret(secret, abortSignal);
        safeSendJson(
          response,
          200,
          {
            status: "ok",
            message:
              typeof result?.message === "string"
                ? result.message
                : `Stored '${metadata.name}'.`,
          },
          nonce,
        );
      } catch {
        safeSendJson(
          response,
          500,
          {
            status: "error",
            message:
              "KeepKeys could not store this key. The value was discarded. Start a new phone intake and try again.",
          },
          nonce,
        );
      } finally {
        secret.fill(0);
        finishTerminal();
      }
    });
  });
  server.requestTimeout = 30 * 1000;
  server.headersTimeout = 15 * 1000;
  server.maxHeadersCount = 40;
  return server;
}

function appendBounded(current, chunk) {
  const next = Buffer.concat([current, chunk]);
  if (next.length > MAX_PROCESS_OUTPUT) {
    throw new Error("A KeepKeys helper exceeded its output safety limit.");
  }
  return next;
}

export function runProcess(command, argumentsValue, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argumentsValue, {
      cwd: options.cwd,
      env: options.env,
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        "pipe",
        "pipe",
      ],
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let terminating = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const terminateThenReject = async (error) => {
      if (settled || terminating) return;
      terminating = true;
      try {
        const terminate =
          options.terminateProcessTree ?? terminateProcessTreeAndWait;
        await terminate(child);
        finish(rejectPromise, error);
      } catch (terminationError) {
        const cleanupError = new Error(
          "KeepKeys could not confirm that the native helper stopped. The private portal closed with a cleanup failure.",
          { cause: terminationError },
        );
        cleanupError.name = "CleanupError";
        finish(rejectPromise, cleanupError);
      }
    };
    const abort = () => {
      const error = new Error("The private KeepKeys portal was closed.");
      error.name = "AbortError";
      void terminateThenReject(error);
    };
    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendBounded(stdout, chunk);
      } catch (error) {
        void terminateThenReject(error);
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendBounded(stderr, chunk);
      } catch (error) {
        void terminateThenReject(error);
      }
    });
    child.on("error", (error) => {
      if (!terminating) finish(rejectPromise, error);
    });
    child.on("close", (code) => {
      if (!terminating) finish(resolvePromise, { code, stdout, stderr });
    });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
  });
}

function tailscaleCandidates() {
  if (process.platform === "darwin") {
    return [
      "/usr/local/bin/tailscale",
      "/opt/homebrew/bin/tailscale",
      "/Applications/Tailscale.app/Contents/MacOS/tailscale",
    ];
  }
  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\Tailscale\\tailscale.exe",
      resolve(process.env.LOCALAPPDATA ?? "", "Tailscale", "tailscale.exe"),
    ];
  }
  return ["/usr/bin/tailscale", "/usr/local/bin/tailscale"];
}

export function resolveTailscaleBinary(candidates = tailscaleCandidates()) {
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    if (statSync(candidate).isFile()) return candidate;
  }
  throw new Error(
    "KeepKeys phone intake needs the Tailscale CLI on this computer. Install Tailscale, sign in, and try again.",
  );
}

async function tailscaleState(tailscale) {
  const versionResult = await runProcess(tailscale, ["version"], {
    cwd: homedir(),
    env: process.env,
  });
  const versionText = versionResult.stdout.toString("utf8");
  const match = versionText.match(/^(\d+)\.(\d+)\.(\d+)/u);
  if (
    versionResult.code !== 0 ||
    !match ||
    Number(match[1]) < 1 ||
    (Number(match[1]) === 1 && Number(match[2]) < 52)
  ) {
    throw new Error("KeepKeys phone intake needs Tailscale 1.52 or newer.");
  }
  const statusResult = await runProcess(tailscale, ["status", "--json"], {
    cwd: homedir(),
    env: process.env,
  });
  if (statusResult.code !== 0) {
    throw new Error("Tailscale is not available on this computer.");
  }
  let status;
  try {
    status = JSON.parse(statusResult.stdout.toString("utf8"));
  } catch {
    throw new Error("Tailscale returned an invalid local status response.");
  }
  const dnsName = status?.Self?.DNSName;
  if (
    status?.BackendState !== "Running" ||
    status?.Self?.Online !== true ||
    typeof dnsName !== "string" ||
    !dnsName.endsWith(".ts.net.")
  ) {
    throw new Error(
      "Tailscale must be running, online, and signed in with MagicDNS on this computer.",
    );
  }
  return { dnsName: dnsName.slice(0, -1) };
}

async function readExisting(metadata) {
  const invocation = helperInvocation(["list"]);
  const result = await runProcess(invocation.command, invocation.args, {
    cwd: invocation.env.KEEPKEYS_PLUGIN_ROOT,
    env: invocation.env,
  });
  if (result.code !== 0) {
    throw new Error("KeepKeys could not read local credential metadata.");
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8").trim());
  } catch {
    throw new Error("KeepKeys received an invalid local metadata response.");
  }
  if (parsed?.status !== "ok" || !Array.isArray(parsed.entries)) {
    throw new Error("KeepKeys could not read local credential metadata.");
  }
  return parsed.entries.some((entry) => entry?.name === metadata.name);
}

function defaultPortalLockRoot() {
  if (process.platform === "darwin") {
    return resolve(
      homedir(),
      "Library",
      "Caches",
      "net.barnlabs.keepkeys",
      "portal-locks",
    );
  }
  if (process.platform === "win32") {
    return resolve(
      process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData", "Local"),
      "BarnLabs",
      "KeepKeys",
      "portal-locks",
    );
  }
  return resolve(
    process.env.XDG_RUNTIME_DIR ?? resolve(homedir(), ".cache"),
    "keepkeys",
    "portal-locks",
  );
}

function abortError() {
  const error = new Error("The private KeepKeys portal was closed.");
  error.name = "AbortError";
  return error;
}

async function waitForLockRetry(milliseconds, signal) {
  if (signal?.aborted) throw abortError();
  await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      finish(rejectPromise, abortError());
    };
    const timer = setTimeout(() => finish(resolvePromise), milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function withPortalCommitLock(
  name,
  operation,
  {
    signal,
    lockRoot = defaultPortalLockRoot(),
    timeoutMs = PORTAL_LOCK_TIMEOUT_MS,
    retryMs = 50,
  } = {},
) {
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  const rootInfo = lstatSync(lockRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("KeepKeys portal lock storage is not a private directory.");
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    rootInfo.uid !== process.getuid()
  ) {
    throw new Error("KeepKeys portal lock storage is not owned by this user.");
  }
  if (process.platform !== "win32") chmodSync(lockRoot, 0o700);
  const lockName = createHash("sha256").update(name, "utf8").digest("hex");
  const lockPath = resolve(lockRoot, `${lockName}.lock`);
  const deadline = Date.now() + timeoutMs;
  let lockHandle;
  while (!lockHandle) {
    if (signal?.aborted) throw abortError();
    try {
      lockHandle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          "Another KeepKeys phone intake is still storing this name.",
        );
      }
      await waitForLockRetry(retryMs, signal);
    }
  }
  try {
    await lockHandle.writeFile(`${process.pid}\n`, { encoding: "utf8" });
    return await operation();
  } finally {
    await lockHandle.close();
    await rm(lockPath, { force: true });
  }
}

async function commitToNativeVault(
  metadata,
  replacing,
  secret,
  signal,
  { nativeSelfTest = false } = {},
) {
  return withPortalCommitLock(
    metadata.name,
    async () => {
      const capability = randomBytes(PORTAL_CAPABILITY_BYTES);
      const capabilitySha256 = createHash("sha256")
        .update(capability)
        .digest("hex");
      const input = Buffer.allocUnsafe(capability.length + secret.length);
      capability.copy(input, 0);
      secret.copy(input, capability.length);
      capability.fill(0);
      try {
        const helperArguments = [
          "_portal-commit",
          ...metadataArguments(metadata),
          "--expect-existing",
          replacing ? "yes" : "no",
        ];
        if (nativeSelfTest) {
          helperArguments.push("--native-self-test", "yes");
        }
        const invocation = portalCommitInvocation(
          helperArguments,
          { capabilitySha256, parentPid: process.pid },
        );
        if (nativeSelfTest) {
          invocation.env[PORTAL_NATIVE_TEST_FLAG] = "1";
        }
        const result = await runProcess(invocation.command, invocation.args, {
          cwd: invocation.env.KEEPKEYS_PLUGIN_ROOT,
          env: invocation.env,
          input,
          signal,
        });
        let parsed;
        try {
          parsed = JSON.parse(result.stdout.toString("utf8").trim());
        } catch {
          throw new Error("KeepKeys received an invalid native-vault response.");
        }
        if (result.code !== 0 || parsed?.status !== "ok") {
          if (nativeSelfTest && typeof parsed?.message === "string") {
            throw new Error(parsed.message);
          }
          throw new Error("KeepKeys could not store the submitted key.");
        }
        return parsed;
      } finally {
        input.fill(0);
      }
    },
    { signal },
  );
}

async function waitForServeReady(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    let settled = false;
    let terminating = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const terminateThenReject = async (error) => {
      if (settled || terminating) return;
      terminating = true;
      try {
        await terminateProcessTreeAndWait(child);
        finish(rejectPromise, error);
      } catch (terminationError) {
        finish(
          rejectPromise,
          new Error(
            "KeepKeys could not confirm that the Tailscale Serve process stopped.",
            { cause: terminationError },
          ),
        );
      }
    };
    const inspect = (chunk) => {
      output += chunk.toString("utf8");
      if (utf8Bytes(output) > MAX_PROCESS_OUTPUT) {
        void terminateThenReject(
          new Error("Tailscale Serve returned too much output."),
        );
        return;
      }
      if (output.includes("Available within your tailnet:")) {
        finish(resolvePromise);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.on("error", (error) => {
      if (!terminating) finish(rejectPromise, error);
    });
    child.on("close", () => {
      if (terminating) return;
      finish(
        rejectPromise,
        new Error(
          output.trim() ||
            "Tailscale Serve could not start. Enable HTTPS for this tailnet and try again.",
        ),
      );
    });
    const timer = setTimeout(() => {
      void terminateThenReject(
        new Error(
          "Tailscale Serve did not become ready. Enable HTTPS for this tailnet and try again.",
        ),
      );
    }, STARTUP_TIMEOUT_MS);
  });
}

async function startPortalSession(argumentsValue) {
  const metadata = parsePortalMetadata(argumentsValue);
  const tailscale = resolveTailscaleBinary();
  const [{ dnsName }, replacing] = await Promise.all([
    tailscaleState(tailscale),
    readExisting(metadata),
  ]);
  const path = `${PORTAL_PREFIX}/${randomBytes(24).toString("base64url")}`;
  const cookieToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const expectedOrigin = `https://${dnsName}`;
  let serveProcess;
  let expiryTimer;
  let cleanupPromise;
  let activeCommit;
  const commitController = new AbortController();
  const closeServer = () =>
    new Promise((resolvePromise, rejectPromise) => {
      if (!server.listening) {
        resolvePromise();
        return;
      }
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      commitController.abort();
      let commitCleanupError;
      if (activeCommit) {
        try {
          await activeCommit;
        } catch (error) {
          if (error?.name === "CleanupError") commitCleanupError = error;
        }
      }
      const cleanupResults = await Promise.allSettled([
        closeServer(),
        serveProcess
          ? terminateProcessTreeAndWait(serveProcess)
          : Promise.resolve(),
      ]);
      const cleanupFailures = cleanupResults
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (commitCleanupError) cleanupFailures.unshift(commitCleanupError);
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          "KeepKeys could not verify complete private portal cleanup.",
        );
      }
    })();
    return cleanupPromise;
  };
  const reportCleanupFailure = (error) => {
    process.exitCode = 1;
    process.stderr.write(
      `${JSON.stringify({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "KeepKeys could not verify private portal cleanup.",
      })}\n`,
    );
  };
  const server = createPortalServer({
    metadata,
    replacing,
    path,
    cookieToken,
    expectedOrigin,
    expiresAt,
    abortSignal: commitController.signal,
    commitSecret: (secret, signal) => {
      const operation = commitToNativeVault(
        metadata,
        replacing,
        secret,
        signal,
      );
      const tracked = operation.finally(() => {
        if (activeCommit === tracked) activeCommit = undefined;
      });
      activeCommit = tracked;
      return tracked;
    },
    onTerminal: () => {
      setTimeout(() => {
        void cleanup().catch(reportCleanupFailure);
      }, 500);
    },
  });
  process.once("SIGINT", () => {
    void cleanup().then(
      () => process.exit(130),
      (error) => {
        reportCleanupFailure(error);
        process.exit(1);
      },
    );
  });
  process.once("SIGTERM", () => {
    void cleanup().then(
      () => process.exit(143),
      (error) => {
        reportCleanupFailure(error);
        process.exit(1);
      },
    );
  });
  process.once("exit", () => {
    if (serveProcess) terminateProcessTree(serveProcess);
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    cleanup();
    throw new Error("KeepKeys could not bind its private local intake server.");
  }
  serveProcess = spawn(
    tailscale,
    [
      "serve",
      "--https=443",
      `--set-path=${path}`,
      `http://127.0.0.1:${address.port}`,
    ],
    {
      cwd: homedir(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  try {
    await waitForServeReady(serveProcess);
  } catch (error) {
    await cleanup();
    throw error;
  }
  expiryTimer = setTimeout(() => {
    void cleanup().catch(reportCleanupFailure);
  }, millisecondsUntilExpiry(expiresAt));
  expiryTimer.unref?.();
  const result = {
    status: "ready",
    message:
      "Open this one-time Tailscale link on your phone, paste the key, and press Paste & Store.",
    url: `${expectedOrigin}${path}`,
    expiresAt,
    name: metadata.name,
    variable: metadata.variable,
    replacing,
    network: "Tailscale Serve",
    publicInternet: false,
  };
  if (process.send) {
    process.send(result, () => process.disconnect?.());
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

export function millisecondsUntilExpiry(expiresAt, now = Date.now()) {
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error("KeepKeys received an invalid portal expiry.");
  }
  return Math.max(0, timestamp - now);
}

async function runNativePortalSelfTest() {
  if (process.env[PORTAL_NATIVE_TEST_FLAG] !== "1") {
    throw new Error(
      "The native portal integration test requires an explicit test environment.",
    );
  }
  delete process.env[PORTAL_NATIVE_TEST_FLAG];
  const metadata = {
    name: `keepkeys-portal-test-${randomBytes(12).toString("hex")}`,
    variable: "KEEPKEYS_PORTAL_TEST",
    description: "Temporary UTF-8 phone intake verification",
    provider: "BarnLabs",
    documentationUrls: ["https://github.com/barnlabs/keepkeys"],
  };
  const secret = Buffer.from(
    `keepkeys-portal-test-\u2713-${randomBytes(32).toString("base64url")}`,
    "utf8",
  );
  try {
    const result = await commitToNativeVault(
      metadata,
      false,
      secret,
      undefined,
      { nativeSelfTest: true },
    );
    if (result?.status !== "ok" || result?.cleaned !== true) {
      throw new Error(
        "KeepKeys did not verify native portal storage and cleanup.",
      );
    }
    return {
      status: "ok",
      message:
        "Generated UTF-8 portal value storage, metadata, existence check, and cleanup verified.",
      platform: process.platform,
      cleaned: true,
    };
  } finally {
    secret.fill(0);
  }
}

async function launchDetached(argumentsValue) {
  const child = fork(fileURLToPath(import.meta.url), argumentsValue, {
    detached: true,
    env: { ...process.env, [PORTAL_CHILD_FLAG]: "1" },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let terminating = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    child.once("message", (result) => {
      if (terminating) return;
      if (result?.status === "error") {
        finish(rejectPromise, new Error(result.message));
        return;
      }
      child.unref();
      finish(resolvePromise, result);
    });
    child.once("error", (error) => {
      if (!terminating) finish(rejectPromise, error);
    });
    child.once("exit", (code) => {
      if (terminating) return;
      if (code !== 0) {
        finish(
          rejectPromise,
          new Error("KeepKeys could not start the private phone intake."),
        );
      }
    });
    const timer = setTimeout(() => {
      if (settled || terminating) return;
      terminating = true;
      void terminateProcessTreeAndWait(child).then(
        () =>
          finish(
            rejectPromise,
            new Error("KeepKeys timed out while starting the private phone intake."),
          ),
        (error) =>
          finish(
            rejectPromise,
            new Error(
              "KeepKeys timed out and could not confirm that the private phone intake stopped.",
              { cause: error },
            ),
          ),
      );
    }, STARTUP_TIMEOUT_MS + 5000);
  });
}

async function main() {
  const argumentsValue = process.argv.slice(2);
  if (argumentsValue[0] === "--native-portal-self-test") {
    try {
      if (argumentsValue.length !== 1) {
        throw new Error("The native portal integration test takes no arguments.");
      }
      const result = await runNativePortalSelfTest();
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "KeepKeys native portal integration test failed.",
      );
    }
    return;
  }
  if (process.env[PORTAL_CHILD_FLAG] === "1") {
    try {
      await startPortalSession(argumentsValue);
    } catch (error) {
      const result = {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "KeepKeys could not start the private phone intake.",
      };
      if (process.send) {
        process.send(result, () => {
          process.disconnect?.();
          process.exit(1);
        });
      } else {
        fail(result.message);
      }
    }
    return;
  }
  try {
    const result = await launchDetached(argumentsValue);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : "KeepKeys could not start the private phone intake.",
    );
  }
}

const isMainModule =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMainModule) {
  main();
}

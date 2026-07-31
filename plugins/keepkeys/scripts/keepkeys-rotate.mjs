#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { helperInvocation } from "./platform.mjs";
import { runSerializedStore } from "./keepkeys-store.mjs";

const MAX_HELPER_OUTPUT = 2 * 1024 * 1024;

function requiredName(argumentsValue) {
  const index = argumentsValue.indexOf("--name");
  const value = index >= 0 ? argumentsValue[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--name is required.");
  }
  return value;
}

function runHelper(invocation) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.env.KEEPKEYS_PLUGIN_ROOT,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: false,
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_HELPER_OUTPUT) {
        child.kill("SIGKILL");
        throw new Error("KeepKeys helper output exceeded the 2 MiB safety limit.");
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      try {
        stdout = append(stdout, chunk);
      } catch (error) {
        finish(rejectPromise, error);
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = append(stderr, chunk);
      } catch (error) {
        finish(rejectPromise, error);
      }
    });
    child.once("error", (error) => finish(rejectPromise, error));
    child.once("close", (code, signal) =>
      finish(resolvePromise, { code, signal, stdout, stderr }),
    );
  });
}

async function existingMetadata(name) {
  const result = await runHelper(helperInvocation(["list"]));
  if (result.code !== 0 || result.signal !== null) {
    throw new Error("KeepKeys could not read local credential metadata.");
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8").trim());
  } catch {
    throw new Error("KeepKeys received an invalid local metadata response.");
  }
  const entry = parsed?.entries?.find((candidate) => candidate?.name === name);
  if (!entry) {
    throw new Error(`No KeepKeys secret is stored as '${name}'.`);
  }
  if (
    typeof entry.variable !== "string" ||
    typeof entry.description !== "string" ||
    typeof entry.provider !== "string" ||
    !Array.isArray(entry.documentationUrls)
  ) {
    throw new Error("KeepKeys returned incomplete metadata for this name.");
  }
  return entry;
}

async function main() {
  const name = requiredName(process.argv.slice(2));
  const entry = await existingMetadata(name);
  const result = await runSerializedStore([
    "store",
    "--name",
    entry.name,
    "--variable",
    entry.variable,
    "--description",
    entry.description,
    "--provider",
    entry.provider,
    ...entry.documentationUrls.flatMap((url) => ["--documentation-url", url]),
  ]);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.signal !== null || result.code !== 0) {
    process.exitCode = result.code ?? 1;
  }
}

const isMainModule =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMainModule) {
  main().catch((error) => {
    process.stdout.write(
      `${JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "KeepKeys rotation failed.",
      })}\n`,
    );
    process.exitCode = 1;
  });
}

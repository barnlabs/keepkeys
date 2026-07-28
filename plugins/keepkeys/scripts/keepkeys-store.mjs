#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  missingNativeCommitReceiptError,
  withPortalCommitLock,
} from "./keepkeys-portal.mjs";
import { nativeStoreInvocation } from "./platform.mjs";

const MAX_HELPER_OUTPUT = 2 * 1024 * 1024;

function option(argumentsValue, name) {
  const index = argumentsValue.indexOf(name);
  const value = index >= 0 ? argumentsValue[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function appendBounded(current, chunk) {
  const next = Buffer.concat([current, chunk]);
  if (next.length > MAX_HELPER_OUTPUT) {
    throw new Error("KeepKeys helper output exceeded the 2 MiB safety limit.");
  }
  return next;
}

export function runNativeStore(invocation) {
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
    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendBounded(stdout, chunk);
      } catch (error) {
        child.kill("SIGKILL");
        finish(rejectPromise, error);
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendBounded(stderr, chunk);
      } catch (error) {
        child.kill("SIGKILL");
        finish(rejectPromise, error);
      }
    });
    child.once("error", (error) => finish(rejectPromise, error));
    child.once("close", (code, signal) => {
      finish(resolvePromise, { code, signal, stdout, stderr });
    });
  });
}

function validateNativeStoreReceipt(result) {
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8").trim());
  } catch (error) {
    throw missingNativeCommitReceiptError(error);
  }
  if (
    result.code === 0 &&
    result.signal === null &&
    parsed?.status === "ok"
  ) {
    return result;
  }
  if (
    (parsed?.status === "cancelled" && result.code === 0) ||
    parsed?.status === "error"
  ) {
    const receipt = new Error(
      typeof parsed.message === "string"
        ? parsed.message
        : "KeepKeys native storage did not complete.",
    );
    receipt.name = "NativeStoreReceipt";
    receipt.nativeResult = result;
    receipt.stored =
      parsed.storageState === "uncertain"
        ? null
        : parsed.stored === true;
    if (parsed.storageState === "uncertain") {
      receipt.storageState = "uncertain";
      receipt.cleanupKind = parsed.cleanupKind ?? "native";
    }
    throw receipt;
  }
  throw missingNativeCommitReceiptError(
    new Error("The native helper returned an inconsistent commit receipt."),
  );
}

export async function runSerializedStore(
  argumentsValue,
  { lockOptions, storeRunner = runNativeStore } = {},
) {
  if (argumentsValue[0] !== "store") {
    throw new Error("KeepKeys rejected an invalid serialized store action.");
  }
  const name = option(argumentsValue, "--name");
  try {
    return await withPortalCommitLock(
      name,
      async () =>
        validateNativeStoreReceipt(
          await storeRunner(nativeStoreInvocation(argumentsValue)),
        ),
      lockOptions,
    );
  } catch (error) {
    if (error?.name === "NativeStoreReceipt" && error.nativeResult) {
      return error.nativeResult;
    }
    throw error;
  }
}

function emitFailure(error) {
  const stored =
    error?.storageState === "uncertain"
      ? null
      : error?.stored === true
      ? true
      : undefined;
  process.stdout.write(
    `${JSON.stringify({
      status: "error",
      ...(stored === undefined ? {} : { stored }),
      ...(error?.storageState === "uncertain"
        ? { storageState: "uncertain" }
        : {}),
      message:
        stored === null
          ? error?.cleanupKind?.endsWith("+portal-lock")
            ? "KeepKeys could not confirm the final native-vault state, and it could not remove the shared per-name commit lock. Check the local vault, remove this name, and confirm the lock is gone before retrying."
            : "KeepKeys did not receive a valid native commit receipt, so it cannot confirm whether the key was stored. Check the local vault and remove this name before retrying."
          : stored
          ? "The key was stored, but KeepKeys could not remove its shared per-name commit lock. Check the connected host before retrying this name."
          : error instanceof Error
          ? error.message
          : "KeepKeys could not complete the serialized local store.",
    })}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  try {
    const result = await runSerializedStore(process.argv.slice(2));
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.signal !== null || result.code !== 0) {
      process.exitCode = result.code ?? 1;
    }
  } catch (error) {
    emitFailure(error);
  }
}

const isMainModule =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMainModule) {
  main();
}

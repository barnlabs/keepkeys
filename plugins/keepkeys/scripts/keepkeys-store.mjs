#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  missingNativeCommitReceiptError,
  withPortalCommitLock,
} from "./keepkeys-portal.mjs";
import { nativeMutationInvocation } from "./platform.mjs";

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

function missingNativeMutationReceiptError(action, cause) {
  if (action === "store") return missingNativeCommitReceiptError(cause);
  const receiptError = new Error(
    "KeepKeys could not confirm whether the local removal completed because the native helper ended without a valid receipt.",
    { cause },
  );
  receiptError.name = "NativeMutationReceiptError";
  receiptError.mutationKind = "remove";
  receiptError.cleanupKind = "native-receipt";
  receiptError.removed = null;
  return receiptError;
}

function validateNativeMutationReceipt(result, action) {
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8").trim());
  } catch (error) {
    throw missingNativeMutationReceiptError(action, error);
  }
  if (
    result.code === 0 &&
    result.signal === null &&
    parsed?.status === "ok" &&
    typeof parsed?.message === "string" &&
    (action !== "remove" || typeof parsed?.removed === "boolean")
  ) {
    result.parsedReceipt = parsed;
    return result;
  }
  if (
    parsed?.status === "cancelled" &&
    result.code === 0 &&
    result.signal === null &&
    typeof parsed?.message === "string"
  ) {
    const receipt = new Error(
      parsed.message,
    );
    receipt.name = "NativeStoreReceipt";
    receipt.nativeResult = result;
    throw receipt;
  }
  if (
    parsed?.status === "error" &&
    Number.isInteger(result.code) &&
    result.code !== 0 &&
    result.signal === null &&
    typeof parsed?.message === "string" &&
    parsed.message.length > 0
  ) {
    const hasStorageState = Object.hasOwn(parsed, "storageState");
    const hasCleanupKind = Object.hasOwn(parsed, "cleanupKind");
    const keys = Object.keys(parsed).sort().join(",");
    const recognizedOrdinaryFailure =
      !hasStorageState &&
      !hasCleanupKind &&
      !Object.hasOwn(parsed, "stored") &&
      keys === "message,status";
    const recognizedUncertainStore =
      action === "store" &&
      parsed.storageState === "uncertain" &&
      parsed.cleanupKind === "native-rollback" &&
      !Object.hasOwn(parsed, "stored") &&
      keys === "cleanupKind,message,status,storageState";
    if (recognizedOrdinaryFailure || recognizedUncertainStore) {
      const receipt = new Error(parsed.message);
      receipt.name = "NativeStoreReceipt";
      receipt.nativeResult = result;
      if (recognizedUncertainStore) {
        receipt.stored = null;
        receipt.storageState = "uncertain";
        receipt.cleanupKind = "native-rollback";
      }
      throw receipt;
    }
  }
  throw missingNativeMutationReceiptError(
    action,
    new Error("The native helper returned an inconsistent commit receipt."),
  );
}

export async function runSerializedMutation(
  argumentsValue,
  { lockOptions, storeRunner = runNativeStore } = {},
) {
  const action = argumentsValue[0];
  if (action !== "store" && action !== "remove") {
    throw new Error("KeepKeys rejected an invalid serialized mutation.");
  }
  const name = option(argumentsValue, "--name");
  try {
    return await withPortalCommitLock(
      name,
      async () =>
        validateNativeMutationReceipt(
          await storeRunner(nativeMutationInvocation(argumentsValue)),
          action,
        ),
      { ...lockOptions, operationKind: action },
    );
  } catch (error) {
    if (error?.name === "NativeStoreReceipt" && error.nativeResult) {
      return error.nativeResult;
    }
    throw error;
  }
}

export function runSerializedStore(argumentsValue, options) {
  if (argumentsValue[0] !== "store") {
    throw new Error("KeepKeys rejected an invalid serialized store action.");
  }
  return runSerializedMutation(argumentsValue, options);
}

function emitFailure(error, action) {
  if (action === "remove") {
    const removalUncertain = error?.removed === null;
    process.stdout.write(
      `${JSON.stringify({
        status: "error",
        ...(error?.removed === true || removalUncertain
          ? { removed: error.removed }
          : {}),
        ...(removalUncertain ? { removalState: "uncertain" } : {}),
        message:
          error?.removed === true
            ? "The credential was removed, but KeepKeys could not remove its shared per-name mutation lock. Check the local vault and lock before retrying."
            : removalUncertain &&
              error?.cleanupKind === "native-receipt+portal-lock"
            ? "KeepKeys could not confirm whether the credential was removed, and it could not remove the shared per-name mutation lock. Check the local vault and lock before retrying."
            : error instanceof Error
            ? error.message
            : "KeepKeys could not complete the serialized local removal.",
      })}\n`,
    );
    process.exitCode = 1;
    return;
  }
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
  const argumentsValue = process.argv.slice(2);
  try {
    const result = await runSerializedMutation(argumentsValue);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.signal !== null || result.code !== 0) {
      process.exitCode = result.code ?? 1;
    }
  } catch (error) {
    emitFailure(error, argumentsValue[0]);
  }
}

const isMainModule =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMainModule) {
  main();
}

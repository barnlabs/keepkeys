#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSerializedRotate } from "./keepkeys-store.mjs";

function requiredName(argumentsValue) {
  const index = argumentsValue.indexOf("--name");
  const value = index >= 0 ? argumentsValue[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--name is required.");
  }
  return value;
}

async function main() {
  const name = requiredName(process.argv.slice(2));
  const result = await runSerializedRotate(name);
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

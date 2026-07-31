#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { withPortalCommitLock } from "./keepkeys-portal.mjs";
import { helperInvocation } from "./platform.mjs";

function requiredOption(argumentsValue, name) {
  const index = argumentsValue.indexOf(name);
  const value = index >= 0 ? argumentsValue[index + 1] : undefined;
  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export async function runKeepKeysAction(
  argumentsValue,
  { spawn = spawnSync, lock = withPortalCommitLock } = {},
) {
  const invocation = helperInvocation(argumentsValue);
  const run = () =>
    spawn(invocation.command, invocation.args, {
      cwd: invocation.env.KEEPKEYS_PLUGIN_ROOT,
      env: invocation.env,
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
      windowsHide: false,
    });
  if (argumentsValue[0] === "run") {
    return lock(
      requiredOption(argumentsValue, "--name"),
      run,
      { operationKind: "run" },
    );
  }
  return run();
}

async function main() {
  try {
    const result = await runKeepKeysAction(process.argv.slice(2));
    if (result.error) {
      throw new Error(
        `KeepKeys could not start its native ${process.platform} helper: ${result.error.message}`,
      );
    }
    process.exitCode = result.status ?? 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "KeepKeys helper failed."}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}

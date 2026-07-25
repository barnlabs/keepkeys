#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { helperInvocation } from "./platform.mjs";

const invocation = helperInvocation(process.argv.slice(2));
const result = spawnSync(invocation.command, invocation.args, {
  cwd: invocation.env.KEEPKEYS_PLUGIN_ROOT,
  env: invocation.env,
  stdio: ["ignore", "inherit", "inherit"],
  shell: false,
  windowsHide: false,
});

if (result.error) {
  process.stderr.write(
    `KeepKeys could not start its native ${process.platform} helper: ${result.error.message}\n`,
  );
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}

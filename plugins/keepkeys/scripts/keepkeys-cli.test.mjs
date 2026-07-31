import assert from "node:assert/strict";
import test from "node:test";

import { runKeepKeysAction } from "./keepkeys-cli.mjs";

test("the local CLI serializes approved run actions with same-name mutations", async () => {
  const events = [];
  const result = await runKeepKeysAction(
    [
      "run",
      "--name",
      "demo-service",
      "--purpose",
      "Synthetic test",
      "--",
      "/usr/bin/printf",
      "ok",
    ],
    {
      spawn(command, args, options) {
        events.push(["spawn", command, args, options.shell]);
        return { error: null, status: 0 };
      },
      async lock(name, operation, options) {
        events.push(["lock", name, options.operationKind]);
        const lockedResult = await operation();
        events.push(["unlock", name]);
        return lockedResult;
      },
    },
  );

  assert.equal(result.status, 0);
  assert.deepEqual(events[0], ["lock", "demo-service", "run"]);
  assert.equal(events[1][0], "spawn");
  if (process.platform === "linux") {
    assert.equal(events[1][1], "/usr/bin/python3");
  } else if (process.platform === "win32") {
    assert.match(events[1][1], /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/u);
  } else {
    assert.match(events[1][1], /plugins[\\/]keepkeys[\\/]scripts[\\/]keepkeys$/u);
  }
  assert.deepEqual(events[1][2], [
    "run",
    "--name",
    "demo-service",
    "--purpose",
    "Synthetic test",
    "--",
    "/usr/bin/printf",
    "ok",
  ]);
  assert.equal(events[1][3], false);
  assert.deepEqual(events[2], ["unlock", "demo-service"]);
});

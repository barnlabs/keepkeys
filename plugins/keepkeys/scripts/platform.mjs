import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_HELPER_SHA256 =
  "da18d09186a0868059e4cf545fae7dd239515899a86b3d66386be11f3b8c58cf";
const LINUX_HELPER_SHA256 =
  "a0cfdf180c0ddf9ffe006036429d40b0425fd11cf425b14e80fa3ce181742872";

function copyPresent(target, source, names) {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) target[name] = value;
  }
}

export function canonicalTextSha256(source) {
  return createHash("sha256")
    .update(source.replaceAll("\r\n", "\n"), "utf8")
    .digest("hex");
}

function verifiedHelper(relativePath, expectedHash) {
  const path = resolve(pluginRoot, relativePath);
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error("KeepKeys native helper source must not be a symbolic link.");
  }
  const actualHash = canonicalTextSha256(readFileSync(path, "utf8"));
  if (actualHash !== expectedHash) {
    throw new Error(
      "KeepKeys native helper source failed its pinned SHA-256 integrity check.",
    );
  }
  return path;
}

function routedInvocation(helperArguments, nativeInvocation) {
  if (helperArguments[0] === "portal-store") {
    return {
      command: process.execPath,
      args: [
        resolve(pluginRoot, "scripts", "keepkeys-portal.mjs"),
        ...helperArguments.slice(1),
      ],
      env: nativeInvocation.env,
    };
  }
  if (
    helperArguments[0] === "store" ||
    helperArguments[0] === "remove"
  ) {
    return {
      command: process.execPath,
      args: [
        resolve(pluginRoot, "scripts", "keepkeys-store.mjs"),
        ...helperArguments,
      ],
      env: nativeInvocation.env,
    };
  }
  return nativeInvocation;
}

function buildInvocation(
  helperArguments,
  {
    platform = process.platform,
    environment = process.env,
    home = homedir(),
  } = {},
  routePortalStore = true,
) {
  const common = {
    KEEPKEYS_CALLED_FROM_MCP: "1",
    KEEPKEYS_PLUGIN_ROOT: pluginRoot,
  };

  if (platform === "darwin") {
    const env = {
      ...common,
      HOME: home,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      KEEPKEYS_ASSETS_DIR: resolve(pluginRoot, "assets"),
    };
    copyPresent(env, environment, ["LANG", "LC_ALL", "TMPDIR"]);
    const invocation = {
      command: resolve(pluginRoot, "scripts", "keepkeys"),
      args: helperArguments,
      env,
    };
    return routePortalStore
      ? routedInvocation(helperArguments, invocation)
      : invocation;
  }

  if (platform === "win32") {
    const helper = verifiedHelper(
      "scripts/keepkeys.windows.ps1",
      WINDOWS_HELPER_SHA256,
    );
    const systemRoot =
      environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows";
    const powershell = resolve(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const env = {
      ...common,
      USERPROFILE: environment.USERPROFILE ?? home,
      SystemRoot: systemRoot,
      WINDIR: environment.WINDIR ?? systemRoot,
      PATH: [
        resolve(systemRoot, "System32"),
        resolve(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
      ].join(delimiter),
      KEEPKEYS_ASSETS_DIR: resolve(pluginRoot, "assets"),
    };
    copyPresent(env, environment, [
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
      "USERNAME",
      "USERDOMAIN",
    ]);
    const invocation = {
      command: powershell,
      args: [
        "-NoLogo",
        "-NoProfile",
        "-Sta",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helper,
        ...helperArguments,
      ],
      env,
    };
    return routePortalStore
      ? routedInvocation(helperArguments, invocation)
      : invocation;
  }

  if (platform === "linux") {
    const helper = verifiedHelper(
      "scripts/keepkeys.linux.py",
      LINUX_HELPER_SHA256,
    );
    const env = {
      ...common,
      HOME: home,
      PATH: "/usr/local/bin:/usr/bin:/bin",
      KEEPKEYS_ASSETS_DIR: resolve(pluginRoot, "assets"),
    };
    copyPresent(env, environment, [
      "DBUS_SESSION_BUS_ADDRESS",
      "DISPLAY",
      "LANG",
      "LC_ALL",
      "WAYLAND_DISPLAY",
      "XAUTHORITY",
      "XDG_CURRENT_DESKTOP",
      "XDG_RUNTIME_DIR",
      "XDG_SESSION_TYPE",
    ]);
    const invocation = {
      command: "/usr/bin/python3",
      args: [
        helper,
        ...helperArguments,
      ],
      env,
    };
    return routePortalStore
      ? routedInvocation(helperArguments, invocation)
      : invocation;
  }

  throw new Error(
    `KeepKeys does not support platform '${platform}'. Supported platforms are macOS, Windows, and Linux.`,
  );
}

export function helperInvocation(helperArguments, options = {}) {
  if (
    helperArguments[0] === "portal-commit" ||
    helperArguments[0] === "_portal-commit"
  ) {
    throw new Error(
      "The private phone-intake commit is not a public KeepKeys action.",
    );
  }
  return buildInvocation(helperArguments, options, true);
}

export function portalCommitInvocation(
  helperArguments,
  { capabilitySha256, parentPid },
  options = {},
) {
  if (
    helperArguments[0] !== "_portal-commit" ||
    !/^[a-f0-9]{64}$/u.test(capabilitySha256) ||
    !Number.isSafeInteger(parentPid) ||
    parentPid <= 0
  ) {
    throw new Error("KeepKeys rejected an invalid private portal channel.");
  }
  const invocation = buildInvocation(helperArguments, options, false);
  invocation.env.KEEPKEYS_PORTAL_CAPABILITY_SHA256 = capabilitySha256;
  invocation.env.KEEPKEYS_PORTAL_PARENT_PID = String(parentPid);
  return invocation;
}

export function nativeMutationInvocation(helperArguments, options = {}) {
  if (
    helperArguments[0] !== "store" &&
    helperArguments[0] !== "remove"
  ) {
    throw new Error("KeepKeys rejected an invalid serialized mutation.");
  }
  const invocation = buildInvocation(helperArguments, options, false);
  invocation.env.KEEPKEYS_SERIALIZED_MUTATION = "1";
  return invocation;
}

export function nativeStoreInvocation(helperArguments, options = {}) {
  if (helperArguments[0] !== "store") {
    throw new Error("KeepKeys rejected an invalid serialized store action.");
  }
  return nativeMutationInvocation(helperArguments, options);
}

export function processHasExited(child) {
  return Boolean(
    child &&
      ((child.exitCode !== undefined && child.exitCode !== null) ||
        (child.signalCode !== undefined && child.signalCode !== null)),
  );
}

function signalProcessTree(child, platform, signal) {
  if (!child?.pid) return { requested: true, processGroup: false };
  if (platform === "win32") {
    const result = spawnSync(
      resolve(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      [
        "/PID",
        `${child.pid}`,
        "/T",
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    return {
      requested: !result.error && result.status === 0,
      processGroup: false,
    };
  }
  try {
    process.kill(-child.pid, signal);
    return { requested: true, processGroup: true };
  } catch (error) {
    if (error?.code === "ESRCH" && processHasExited(child)) {
      return { requested: true, processGroup: true };
    }
    try {
      return {
        requested: processHasExited(child) ? false : child.kill(signal),
        processGroup: false,
      };
    } catch {
      return { requested: false, processGroup: false };
    }
  }
}

export function terminateProcessTree(child, platform = process.platform) {
  return signalProcessTree(child, platform, "SIGKILL").requested;
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function waitForProcessGroupExit(pid, timeoutMs, message) {
  return new Promise((resolvePromise, rejectPromise) => {
    const deadline = Date.now() + timeoutMs;
    const inspect = () => {
      if (!processGroupExists(pid)) {
        resolvePromise();
        return;
      }
      if (Date.now() >= deadline) {
        rejectPromise(new Error(message));
        return;
      }
      setTimeout(inspect, 25);
    };
    inspect();
  });
}

function requestGracefulTermination(child, platform, tree) {
  if (tree) {
    return signalProcessTree(child, platform, "SIGTERM");
  }
  if (processHasExited(child)) {
    return { requested: true, processGroup: false };
  }
  try {
    return { requested: child.kill("SIGTERM"), processGroup: false };
  } catch {
    return { requested: false, processGroup: false };
  }
}

function waitForTermination(child, platform, timeoutMs, processGroup, message) {
  if (platform !== "win32" && processGroup) {
    return waitForProcessGroupExit(child.pid, timeoutMs, message);
  }
  if (processHasExited(child)) return Promise.resolve();
  return waitForProcessClose(child, timeoutMs, message);
}

function waitForProcessClose(child, timeoutMs, message) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("close", close);
      callback(value);
    };
    const close = () => finish(resolvePromise);
    child.once("close", close);
    const timer = setTimeout(
      () => finish(rejectPromise, new Error(message)),
      timeoutMs,
    );
    if (processHasExited(child)) close();
  });
}

async function terminateGracefullyAndWait(
  child,
  platform,
  timeoutMs,
  tree,
) {
  if (!child?.pid) return;
  if (
    typeof child.once !== "function" ||
    typeof child.removeListener !== "function" ||
    typeof child.kill !== "function"
  ) {
    throw new Error("KeepKeys cannot confirm graceful process termination.");
  }
  const termination = requestGracefulTermination(child, platform, tree);
  if (!termination.requested) {
    throw new Error("KeepKeys could not request graceful process termination.");
  }
  await waitForTermination(
    child,
    platform,
    timeoutMs,
    termination.processGroup,
    "KeepKeys could not confirm graceful process termination.",
  );
}

export function terminateProcessGracefullyAndWait(
  child,
  platform = process.platform,
  timeoutMs = 5000,
) {
  return terminateGracefullyAndWait(child, platform, timeoutMs, false);
}

export async function terminateProcessTreeGracefullyAndWait(
  child,
  platform = process.platform,
  timeoutMs = 5000,
) {
  try {
    await terminateGracefullyAndWait(child, platform, timeoutMs, true);
  } catch (error) {
    await terminateProcessTreeAndWait(child, platform, timeoutMs);
    throw new Error(
      "KeepKeys forced a process tree to stop after graceful cleanup could not be confirmed.",
      { cause: error },
    );
  }
}

export async function terminateProcessTreeAndWait(
  child,
  platform = process.platform,
  timeoutMs = 5000,
) {
  if (!child?.pid) return;
  if (typeof child.once !== "function") {
    throw new Error("KeepKeys cannot confirm termination for this process.");
  }
  const termination = signalProcessTree(child, platform, "SIGKILL");
  if (!termination.requested) {
    throw new Error(
      "KeepKeys could not request process-tree termination or confirm exit.",
    );
  }
  await waitForTermination(
    child,
    platform,
    timeoutMs,
    termination.processGroup,
    "KeepKeys could not confirm that the process tree exited.",
  );
}

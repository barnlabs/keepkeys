import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_HELPER_SHA256 =
  "a5aae17ddb5abd105add5808406a6f69c859ec3e46a92b1f762f8bdedf8fad6a";
const LINUX_HELPER_SHA256 =
  "0c0d04d22600e3bfbcf8308f7bd8dc1f839836ef3eddb60e7a1d593d39fa70d6";

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
  if (helperArguments[0] !== "portal-store") return nativeInvocation;
  return {
    command: process.execPath,
    args: [
      resolve(pluginRoot, "scripts", "keepkeys-portal.mjs"),
      ...helperArguments.slice(1),
    ],
    env: nativeInvocation.env,
  };
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

export function terminateProcessTree(child, platform = process.platform) {
  if (!child?.pid) return;
  if (platform === "win32") {
    spawnSync(
      resolve(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/PID", `${child.pid}`, "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

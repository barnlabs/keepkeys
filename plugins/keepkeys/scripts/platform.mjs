import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_HELPER_SHA256 =
  "982d72c9e67f5fefbaa124a1b94413ff8484a7ee1a43a1c5e56b05b312cdcfcc";
const LINUX_HELPER_SHA256 =
  "14e90be94b799662910d9245eafd54e43b897c409781585152a641bb46ae0646";

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

export function helperInvocation(
  helperArguments,
  {
    platform = process.platform,
    environment = process.env,
    home = homedir(),
  } = {},
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
    return {
      command: resolve(pluginRoot, "scripts", "keepkeys"),
      args: helperArguments,
      env,
    };
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
    return {
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
    return {
      command: "/usr/bin/python3",
      args: [
        helper,
        ...helperArguments,
      ],
      env,
    };
  }

  throw new Error(
    `KeepKeys does not support platform '${platform}'. Supported platforms are macOS, Windows, and Linux.`,
  );
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

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_HELPER_SHA256 =
  "f7b4306e8b5d29f6d8b444727d5465da08aef86ac5dfd1396b89c6ee2eef459c";
const LINUX_HELPER_SHA256 =
  "38e36d7e753bf17d8381664691b51a728eb841e4f561d8155a027901590cfab4";

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
    return routedInvocation(helperArguments, {
      command: resolve(pluginRoot, "scripts", "keepkeys"),
      args: helperArguments,
      env,
    });
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
    return routedInvocation(helperArguments, {
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
    });
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
    return routedInvocation(helperArguments, {
      command: "/usr/bin/python3",
      args: [
        helper,
        ...helperArguments,
      ],
      env,
    });
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

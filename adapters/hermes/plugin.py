"""Thin Hermes adapter for the KeepKeys native helper."""

from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
from typing import Any

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
_PLUGIN_ROOT = _REPOSITORY_ROOT / "plugins" / "keepkeys"
_TOOL_SPEC = _PLUGIN_ROOT / "mcp" / "tools.json"
_SKILL = _PLUGIN_ROOT / "skills" / "keepkeys" / "SKILL.md"
_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
_DEFAULT_TIMEOUT_SECONDS = 15 * 60


def _required_string(args: dict[str, Any], key: str, maximum: int) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValueError(f"{key} must be a non-empty string of at most {maximum} characters.")
    return value


def _optional_string(args: dict[str, Any], key: str, maximum: int) -> str | None:
    value = args.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValueError(f"{key} must be a non-empty string of at most {maximum} characters.")
    return value


def _helper_arguments(tool_name: str, raw_args: Any) -> list[str]:
    if not isinstance(raw_args, dict):
        raise ValueError("Tool arguments must be an object.")
    args: dict[str, Any] = raw_args

    if tool_name == "keepkeys_store":
        return [
            "store",
            "--name",
            _required_string(args, "name", 128),
            "--variable",
            _required_string(args, "variable", 128),
            "--description",
            _required_string(args, "description", 240),
        ]
    if tool_name == "keepkeys_list":
        return ["list"]
    if tool_name == "keepkeys_remove":
        return ["remove", "--name", _required_string(args, "name", 128)]
    if tool_name == "keepkeys_status":
        return ["status"]
    if tool_name == "keepkeys_doctor":
        return ["doctor"]
    if tool_name == "keepkeys_run":
        command = [
            "run",
            "--name",
            _required_string(args, "name", 128),
            "--purpose",
            _required_string(args, "purpose", 240),
        ]
        cwd = _optional_string(args, "cwd", 4096)
        if cwd:
            command.extend(["--cwd", cwd])
        arguments = args.get("arguments", [])
        if (
            not isinstance(arguments, list)
            or len(arguments) > 64
            or any(not isinstance(value, str) or len(value) > 4096 for value in arguments)
        ):
            raise ValueError(
                "arguments must contain at most 64 strings of at most 4096 characters."
            )
        command.extend(
            ["--", _required_string(args, "program", 4096), *arguments]
        )
        return command
    raise ValueError(f"Unknown KeepKeys tool: {tool_name}")


def _run_helper(tool_name: str, args: Any) -> dict[str, Any]:
    helper_arguments = _helper_arguments(tool_name, args)
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("KeepKeys requires Node.js 18 or newer.")
    environment: dict[str, str] = {
        "KEEPKEYS_CALLED_FROM_MCP": "1",
        "KEEPKEYS_PLUGIN_ROOT": str(_PLUGIN_ROOT),
        "KEEPKEYS_ASSETS_DIR": str(_PLUGIN_ROOT / "assets"),
    }
    if sys.platform == "darwin":
        environment.update(
            {
                "HOME": str(Path.home()),
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            }
        )
        for key in ("LANG", "LC_ALL", "TMPDIR"):
            if value := os.environ.get(key):
                environment[key] = value
    elif sys.platform == "win32":
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        environment.update(
            {
                "USERPROFILE": os.environ.get("USERPROFILE", str(Path.home())),
                "SystemRoot": system_root,
                "WINDIR": os.environ.get("WINDIR", system_root),
                "PATH": os.pathsep.join(
                    [
                        str(Path(system_root) / "System32"),
                        str(
                            Path(system_root)
                            / "System32"
                            / "WindowsPowerShell"
                            / "v1.0"
                        ),
                    ]
                ),
            }
        )
        for key in (
            "APPDATA",
            "LOCALAPPDATA",
            "TEMP",
            "TMP",
            "USERNAME",
            "USERDOMAIN",
        ):
            if value := os.environ.get(key):
                environment[key] = value
    elif sys.platform.startswith("linux"):
        environment.update(
            {
                "HOME": str(Path.home()),
                "PATH": "/usr/local/bin:/usr/bin:/bin",
            }
        )
        for key in (
            "DBUS_SESSION_BUS_ADDRESS",
            "DISPLAY",
            "LANG",
            "LC_ALL",
            "WAYLAND_DISPLAY",
            "XAUTHORITY",
            "XDG_CURRENT_DESKTOP",
            "XDG_RUNTIME_DIR",
            "XDG_SESSION_TYPE",
        ):
            if value := os.environ.get(key):
                environment[key] = value
    else:
        raise RuntimeError(
            f"KeepKeys does not support platform {sys.platform!r}. "
            "Supported platforms are macOS, Windows, and Linux."
        )

    command = [
        node,
        str(_PLUGIN_ROOT / "scripts" / "keepkeys-cli.mjs"),
        *helper_arguments,
    ]
    timeout = int(os.environ.get("KEEPKEYS_TIMEOUT_SECONDS", _DEFAULT_TIMEOUT_SECONDS))
    popen_options: dict[str, Any] = {}
    if sys.platform == "win32":
        popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_options["start_new_session"] = True
    process = subprocess.Popen(
        command,
        cwd=_PLUGIN_ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        **popen_options,
    )
    try:
        stdout, _stderr = process.communicate(timeout=max(timeout, 1))
    except subprocess.TimeoutExpired:
        if sys.platform == "win32":
            subprocess.run(
                [
                    str(
                        Path(os.environ.get("SystemRoot", r"C:\Windows"))
                        / "System32"
                        / "taskkill.exe"
                    ),
                    "/PID",
                    str(process.pid),
                    "/T",
                    "/F",
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise RuntimeError("KeepKeys timed out and terminated the local helper process group.")

    if len(stdout) > _MAX_OUTPUT_BYTES:
        raise RuntimeError("KeepKeys helper output exceeded the 2 MiB safety limit.")
    try:
        parsed = json.loads(stdout.decode("utf-8").strip() or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("KeepKeys helper returned invalid output.") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("KeepKeys helper returned an invalid result.")
    if process.returncode != 0 or parsed.get("status") == "error":
        message = parsed.get("message")
        raise RuntimeError(
            message if isinstance(message, str) else "KeepKeys helper failed."
        )
    return parsed


def _handler_for(tool_name: str):
    def handler(args: dict[str, Any], **_kwargs: Any) -> str:
        try:
            return json.dumps(_run_helper(tool_name, args), separators=(",", ":"))
        except (RuntimeError, ValueError, OSError) as error:
            return json.dumps({"error": str(error)}, separators=(",", ":"))

    return handler


def register(ctx: Any) -> None:
    """Register the shared KeepKeys schemas and native-helper bridge with Hermes."""
    tools = json.loads(_TOOL_SPEC.read_text(encoding="utf-8"))
    for tool in tools:
        schema = {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["inputSchema"],
        }
        ctx.register_tool(
            name=tool["name"],
            toolset="keepkeys",
            schema=schema,
            handler=_handler_for(tool["name"]),
            description=tool["description"],
        )
    ctx.register_skill("keepkeys", _SKILL)

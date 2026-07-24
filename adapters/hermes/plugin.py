"""Thin Hermes adapter for the KeepKeys native helper."""

from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import subprocess
from typing import Any

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
_PLUGIN_ROOT = _REPOSITORY_ROOT / "plugins" / "keep-keys"
_LAUNCHER = _PLUGIN_ROOT / "scripts" / "keepkeys"
_TOOL_SPEC = _PLUGIN_ROOT / "mcp" / "tools.json"
_SKILL = _PLUGIN_ROOT / "skills" / "keep-keys" / "SKILL.md"
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
    command = [str(_LAUNCHER), *_helper_arguments(tool_name, args)]
    timeout = int(os.environ.get("KEEPKEYS_TIMEOUT_SECONDS", _DEFAULT_TIMEOUT_SECONDS))
    process = subprocess.Popen(
        command,
        cwd=_PLUGIN_ROOT,
        env={
            "HOME": str(Path.home()),
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "KEEPKEYS_CALLED_FROM_MCP": "1",
        },
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, _stderr = process.communicate(timeout=max(timeout, 1))
    except subprocess.TimeoutExpired:
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
    ctx.register_skill("keep-keys", _SKILL)

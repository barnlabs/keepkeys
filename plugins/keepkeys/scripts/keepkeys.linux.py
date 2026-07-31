#!/usr/bin/env python3
"""KeepKeys native Linux helper.

Secrets live in a freedesktop Secret Service implementation. They enter this
process after a local graphical paste or through the private stdin pipe owned
by a one-time KeepKeys Tailscale portal. This module has no plaintext retrieval
action.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
from typing import Any, NoReturn
from urllib.parse import quote, urlsplit

VERSION = "0.6.0"
METADATA_SERVICE = "net.barnlabs.keepkeys.metadata"
SECRET_SERVICE = "net.barnlabs.keepkeys.secret"
LABEL_PREFIX_V1 = "KeepKeys|v1|"
LABEL_PREFIX_V2 = "KeepKeys|v2|"
LABEL_PREFIX_V3 = "KeepKeys|v3|"
MAX_SECRET_BYTES = 2_048
MAX_ALLOW_RULES = 8
MAX_ALLOW_RULE_BYTES = 12_288
PORTAL_CAPABILITY_BYTES = 32
MAX_CAPTURED_BYTES = 1_048_576
OMITTED_OUTPUT = (
    "[OUTPUT OMITTED BY KEEPKEYS: stream exceeded the 1 MiB safety limit]"
)

NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,127}$")
VARIABLE_PATTERN = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
RESERVED_VARIABLES = {
    "BASH_ENV",
    "CDPATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "ENV",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "HOME",
    "IFS",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "LOGNAME",
    "NODE_OPTIONS",
    "OLDPWD",
    "PATH",
    "PERL5OPT",
    "PWD",
    "PYTHONHOME",
    "PYTHONPATH",
    "RUBYOPT",
    "SHELL",
    "SSH_AUTH_SOCK",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
}
BLOCKED_EXECUTABLES = {
    "bash",
    "csh",
    "dash",
    "env",
    "fish",
    "ksh",
    "printenv",
    "sh",
    "tcsh",
    "zsh",
}
NETWORK_EXECUTABLES = {
    "aws",
    "az",
    "curl",
    "docker",
    "gcloud",
    "gh",
    "git",
    "kubectl",
    "npm",
    "pnpm",
    "rsync",
    "scp",
    "ssh",
    "wget",
    "yarn",
}
INTERPRETERS = {
    "bun",
    "deno",
    "java",
    "node",
    "perl",
    "php",
    "python",
    "python3",
    "ruby",
}


class KeepKeysError(Exception):
    """Expected user-facing helper failure."""


class PortalStorageUncertainError(KeepKeysError):
    """A portal write whose rollback could not prove the final vault state."""


@dataclass(frozen=True)
class Metadata:
    name: str
    variable: str
    description: str
    provider: str = ""
    documentation_urls: tuple[str, ...] = ()
    allow_rules: tuple["AllowRule", ...] = ()


@dataclass(frozen=True)
class AllowRule:
    """A metadata-only grant for one immutable command identity."""

    name: str
    variable: str
    description: str
    provider: str
    documentation_urls: tuple[str, ...]
    purpose: str
    program: str
    fingerprint: str
    arguments: tuple[str, ...]
    cwd: str | None
    entrypoint: str | None
    entrypoint_fingerprint: str | None


@dataclass(frozen=True)
class RunRequest:
    name: str
    purpose: str
    program: Path
    arguments: list[str]
    cwd: Path | None
    fingerprint: str
    risk: str
    entrypoint: Path | None
    entrypoint_fingerprint: str | None


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True), flush=True)


def fail(message: str, **details: Any) -> NoReturn:
    emit({"status": "error", "message": message, **details})
    raise SystemExit(1)


def valid_name(value: str) -> bool:
    return bool(NAME_PATTERN.fullmatch(value))


def valid_variable(value: str) -> bool:
    return (
        bool(VARIABLE_PATTERN.fullmatch(value))
        and value not in RESERVED_VARIABLES
        and not value.startswith(("DYLD_", "LD_"))
    )


def valid_description(value: str) -> bool:
    return (
        bool(value)
        and len(value.encode("utf-8")) <= 240
        and all(ord(character) >= 32 and ord(character) != 127 for character in value)
    )

def valid_provider(value: str) -> bool:
    return (
        bool(value)
        and len(value.encode("utf-8")) <= 80
        and all(ord(character) >= 32 and ord(character) != 127 for character in value)
    )


def valid_documentation_url(value: str) -> bool:
    if (
        not value
        or len(value.encode("utf-8")) > 1_024
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return (
        parsed.scheme.lower() == "https"
        and bool(parsed.hostname)
        and parsed.username is None
        and parsed.password is None
    )


def valid_purpose(value: str) -> bool:
    return valid_description(value)


def valid_sha256(value: str) -> bool:
    return bool(re.fullmatch(r"[a-f0-9]{64}", value))


def allow_rule_payload(rule: AllowRule) -> dict[str, Any]:
    return {
        "name": rule.name,
        "variable": rule.variable,
        "description": rule.description,
        "provider": rule.provider,
        "documentationUrls": list(rule.documentation_urls),
        "purpose": rule.purpose,
        "program": rule.program,
        "fingerprint": rule.fingerprint,
        "arguments": list(rule.arguments),
        "cwd": rule.cwd,
        "entrypoint": rule.entrypoint,
        "entrypointFingerprint": rule.entrypoint_fingerprint,
    }


def validate_allow_rule(rule: AllowRule) -> None:
    size = len(
        json.dumps(allow_rule_payload(rule), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )
    if (
        not valid_name(rule.name)
        or not valid_variable(rule.variable)
        or not valid_description(rule.description)
        or not valid_provider(rule.provider)
        or not 1 <= len(rule.documentation_urls) <= 3
        or len(set(rule.documentation_urls)) != len(rule.documentation_urls)
        or sum(len(url.encode("utf-8")) for url in rule.documentation_urls) > 1_800
        or not all(valid_documentation_url(url) for url in rule.documentation_urls)
        or not valid_purpose(rule.purpose)
        or not rule.program.startswith("/")
        or any(ord(character) < 32 for character in rule.program)
        or not valid_sha256(rule.fingerprint)
        or len(rule.arguments) > 64
        or any(len(value.encode("utf-8")) > 4_096 or any(ord(character) < 32 for character in value) for value in rule.arguments)
        or (rule.cwd is not None and (not rule.cwd.startswith("/") or any(ord(character) < 32 for character in rule.cwd)))
        or (rule.entrypoint is None) != (rule.entrypoint_fingerprint is None)
        or (rule.entrypoint is not None and (not rule.entrypoint.startswith("/") or any(ord(character) < 32 for character in rule.entrypoint) or not valid_sha256(rule.entrypoint_fingerprint or "")))
        or size > MAX_ALLOW_RULE_BYTES
    ):
        raise KeepKeysError("KeepKeys persistent allow rule is invalid.")


def validate_secret(value: str) -> None:
    size = len(value.encode("utf-8"))
    if size < 8:
        raise KeepKeysError("Secret values must contain at least 8 UTF-8 bytes.")
    if size > MAX_SECRET_BYTES:
        raise KeepKeysError(
            f"Secret values must not exceed {MAX_SECRET_BYTES} UTF-8 bytes."
        )


def validate_metadata(metadata: Metadata, *, allow_legacy: bool = False) -> None:
    if not valid_name(metadata.name):
        raise KeepKeysError(
            "Use 1–128 ASCII letters, digits, periods, underscores, or hyphens, "
            "beginning with a letter."
        )
    if not valid_variable(metadata.variable):
        raise KeepKeysError(
            "Use an uppercase environment-variable name that is not a shell, "
            "loader, runtime, or path-control variable."
        )
    if not valid_description(metadata.description):
        raise KeepKeysError("Use a one-line description of at most 240 UTF-8 bytes.")
    if allow_legacy and not metadata.provider and not metadata.documentation_urls:
        if metadata.allow_rules:
            raise KeepKeysError("Legacy metadata cannot contain persistent allow rules.")
        return
    if not valid_provider(metadata.provider):
        raise KeepKeysError("Use a visible provider name of at most 80 UTF-8 bytes.")
    if (
        not 1 <= len(metadata.documentation_urls) <= 3
        or len(set(metadata.documentation_urls)) != len(metadata.documentation_urls)
        or sum(len(url.encode("utf-8")) for url in metadata.documentation_urls) > 1_800
        or not all(valid_documentation_url(url) for url in metadata.documentation_urls)
    ):
        raise KeepKeysError(
            "Use one to three distinct official HTTPS documentation links."
        )
    if len(metadata.allow_rules) > MAX_ALLOW_RULES:
        raise KeepKeysError("KeepKeys permits at most eight persistent allow rules.")
    if len(set(metadata.allow_rules)) != len(metadata.allow_rules):
        raise KeepKeysError("KeepKeys persistent allow rules must be distinct.")
    for rule in metadata.allow_rules:
        validate_allow_rule(rule)


def encode_label(metadata: Metadata, *, legacy: bool = False) -> str:
    validate_metadata(metadata, allow_legacy=legacy)
    if legacy:
        payload = json.dumps(
            {
                "name": metadata.name,
                "variable": metadata.variable,
                "description": metadata.description,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
        return LABEL_PREFIX_V1 + encoded
    record = {
            "name": metadata.name,
            "variable": metadata.variable,
            "description": metadata.description,
            "provider": metadata.provider,
            "documentationUrls": list(metadata.documentation_urls),
    }
    prefix = LABEL_PREFIX_V2
    if metadata.allow_rules:
        record["allowRules"] = [allow_rule_payload(rule) for rule in metadata.allow_rules]
        prefix = LABEL_PREFIX_V3
    payload = json.dumps(
        record,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return prefix + encoded


def decode_label(label: str) -> Metadata | None:
    if label.startswith(LABEL_PREFIX_V3):
        encoded = label[len(LABEL_PREFIX_V3) :]
        legacy = False
        rules_allowed = True
    elif label.startswith(LABEL_PREFIX_V2):
        encoded = label[len(LABEL_PREFIX_V2) :]
        legacy = False
        rules_allowed = False
    elif label.startswith(LABEL_PREFIX_V1):
        encoded = label[len(LABEL_PREFIX_V1) :]
        legacy = True
        rules_allowed = False
    else:
        return None
    encoded += "=" * (-len(encoded) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        rules = tuple(
            AllowRule(
                name=rule["name"],
                variable=rule["variable"],
                description=rule["description"],
                provider=rule["provider"],
                documentation_urls=tuple(rule["documentationUrls"]),
                purpose=rule["purpose"],
                program=rule["program"],
                fingerprint=rule["fingerprint"],
                arguments=tuple(rule["arguments"]),
                cwd=rule["cwd"],
                entrypoint=rule["entrypoint"],
                entrypoint_fingerprint=rule["entrypointFingerprint"],
            )
            for rule in payload.get("allowRules", [])
        )
        if rules and not rules_allowed:
            return None
        metadata = Metadata(
            name=payload["name"],
            variable=payload["variable"],
            description=payload["description"],
            provider=payload.get("provider", ""),
            documentation_urls=tuple(payload.get("documentationUrls", [])),
            allow_rules=rules,
        )
        validate_metadata(metadata, allow_legacy=legacy)
        return metadata
    except (
        AttributeError,
        KeyError,
        TypeError,
        ValueError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ):
        return None


def require_linux_runtime(require_ui: bool) -> str:
    if sys.platform != "linux":
        raise KeepKeysError("The Linux helper can run only on Linux.")
    secret_tool = shutil.which("secret-tool")
    if secret_tool is None:
        raise KeepKeysError(
            "KeepKeys requires secret-tool from libsecret-tools. Install it with "
            "your distribution package manager, then retry."
        )
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        raise KeepKeysError(
            "KeepKeys requires a live desktop Secret Service on the D-Bus user session."
        )
    if require_ui and not (
        os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
    ):
        raise KeepKeysError(
            "KeepKeys requires a graphical desktop session for secure entry and approval."
        )
    return secret_tool


def run_secret_tool(
    arguments: list[str],
    *,
    secret_input: str | None = None,
    required: bool = True,
) -> subprocess.CompletedProcess[bytes]:
    executable = require_linux_runtime(require_ui=False)
    payload = None if secret_input is None else secret_input.encode("utf-8")
    result = subprocess.run(
        [executable, *arguments],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=30,
        env={
            key: value
            for key, value in os.environ.items()
            if key
            in {
                "DBUS_SESSION_BUS_ADDRESS",
                "DISPLAY",
                "HOME",
                "LANG",
                "LC_ALL",
                "PATH",
                "WAYLAND_DISPLAY",
                "XDG_CURRENT_DESKTOP",
                "XDG_RUNTIME_DIR",
                "XDG_SESSION_TYPE",
            }
        },
    )
    if required and result.returncode != 0:
        raise KeepKeysError(
            "The desktop Secret Service rejected the operation. Unlock the login "
            "keyring and verify that a Secret Service provider is running."
        )
    return result


def search_metadata(name: str | None = None) -> list[Metadata]:
    arguments = [
        "search",
        "--all",
        "--unlock",
        "service",
        METADATA_SERVICE,
    ]
    if name is not None:
        arguments.extend(["name", name])
    result = run_secret_tool(arguments)
    output = result.stdout.decode("utf-8", errors="replace")
    entries: dict[str, Metadata] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if line.startswith("secret = "):
            metadata = decode_label(line.removeprefix("secret = "))
            if metadata is not None and (name is None or metadata.name == name):
                entries[metadata.name] = metadata
    return sorted(entries.values(), key=lambda item: item.name.casefold())


def lookup_secret(name: str) -> str:
    result = run_secret_tool(
        ["lookup", "service", SECRET_SERVICE, "name", name]
    )
    try:
        secret = result.stdout.decode("utf-8")
    except UnicodeDecodeError as error:
        raise KeepKeysError("The Secret Service item is not valid UTF-8.") from error
    validate_secret(secret)
    return secret


def store_value(name: str, secret: str) -> None:
    if not valid_name(name):
        raise KeepKeysError("The requested KeepKeys name is invalid.")
    validate_secret(secret)
    run_secret_tool(
        [
            "store",
            f"--label=KeepKeys · {name}",
            "service",
            SECRET_SERVICE,
            "name",
            name,
        ],
        secret_input=secret,
    )


def store_metadata(metadata: Metadata, *, allow_legacy: bool = False) -> None:
    validate_metadata(metadata, allow_legacy=allow_legacy)
    run_secret_tool(
        [
            "store",
            f"--label=KeepKeys metadata · {metadata.name}",
            "service",
            METADATA_SERVICE,
            "name",
            metadata.name,
        ],
        secret_input=encode_label(metadata, legacy=allow_legacy),
    )


def clear_item(service: str, name: str) -> bool:
    result = run_secret_tool(
        ["clear", "service", service, "name", name],
        required=False,
    )
    return result.returncode == 0


def clear_native_portal_test_record(name: str) -> None:
    failures: list[BaseException] = []
    for service in (METADATA_SERVICE, SECRET_SERVICE):
        try:
            if not clear_item(service, name):
                failures.append(
                    KeepKeysError(
                        "Secret Service did not remove a temporary portal item."
                    )
                )
        except (
            KeepKeysError,
            OSError,
            subprocess.SubprocessError,
        ) as error:
            failures.append(error)
    if not failures:
        try:
            if search_metadata(name):
                failures.append(
                    KeepKeysError(
                        "Temporary portal metadata remained after cleanup."
                    )
                )
        except (
            KeepKeysError,
            OSError,
            subprocess.SubprocessError,
        ) as error:
            failures.append(error)
    if failures:
        raise KeepKeysError(
            "The temporary native portal Secret Service cleanup could not "
            "be confirmed."
        ) from failures[0]


def remove_secret(name: str) -> bool:
    existed = bool(search_metadata(name))
    removed_metadata = clear_item(METADATA_SERVICE, name)
    removed_secret = clear_item(SECRET_SERVICE, name)
    return existed and (removed_metadata or removed_secret)


class BrandedUI:
    """Small native Tk surface with the shared KeepKeys visual language."""

    def __init__(self) -> None:
        require_linux_runtime(require_ui=True)
        try:
            import tkinter as tk
            from tkinter import messagebox
        except ImportError as error:
            raise KeepKeysError(
                "KeepKeys requires Python Tk support for its secure desktop interface "
                "(for example, python3-tk)."
            ) from error
        self.tk = tk
        self.messagebox = messagebox
        try:
            self.root = tk.Tk(className="KeepKeys")
        except tk.TclError as error:
            raise KeepKeysError(
                "KeepKeys could not open its secure desktop window in this session."
            ) from error
        self.root.withdraw()
        self.root.option_add("*Font", "Sans 10")
        self.pine = "#1f2d27"
        self.night = "#14211d"
        self.paper = "#fff8ec"
        self.sage = "#41544c"
        self.ember = "#d96c4d"
        self.brass = "#c79a45"
        self.photo: Any = None

    def _window(self, title: str, width: int, height: int) -> Any:
        window = self.tk.Toplevel(self.root)
        window.title(title)
        window.configure(bg=self.paper)
        screen_width = window.winfo_screenwidth()
        screen_height = window.winfo_screenheight()
        safe_width = min(width, max(320, screen_width - 32))
        safe_height = min(height, max(300, screen_height - 48))
        x = max(0, (screen_width - safe_width) // 2)
        y = max(0, (screen_height - safe_height) // 2)
        window.geometry(f"{safe_width}x{safe_height}+{x}+{y}")
        window.minsize(min(480, safe_width), min(420, safe_height))
        window.resizable(True, True)
        window.protocol("WM_DELETE_WINDOW", window.destroy)
        window.attributes("-topmost", True)
        window.after(200, lambda: window.attributes("-topmost", False))
        return window

    def _header(self, window: Any, eyebrow: str, title: str, body: str) -> Any:
        frame = self.tk.Frame(window, bg=self.pine, padx=24, pady=18)
        frame.pack(fill="x")
        copy = self.tk.Frame(frame, bg=self.pine)
        copy.pack(side="left", fill="both", expand=True)
        self.tk.Label(
            copy,
            text=eyebrow.upper(),
            bg=self.pine,
            fg=self.brass,
            font=("Sans", 9, "bold"),
            anchor="w",
        ).pack(fill="x")
        self.tk.Label(
            copy,
            text=title,
            bg=self.pine,
            fg="white",
            font=("Sans", 19, "bold"),
            anchor="w",
        ).pack(fill="x", pady=(2, 4))
        self.tk.Label(
            copy,
            text=body,
            bg=self.pine,
            fg="#d9e2dd",
            font=("Sans", 10),
            anchor="w",
            justify="left",
            wraplength=430,
        ).pack(fill="x")

        image_path = Path(os.environ.get("KEEPKEYS_ASSETS_DIR", "")) / "keykeeper.png"
        if image_path.is_file():
            try:
                image = self.tk.PhotoImage(file=str(image_path))
                scale = max(1, image.width() // 76)
                self.photo = image.subsample(scale, scale)
                self.tk.Label(frame, image=self.photo, bg=self.pine).pack(
                    side="right", padx=(16, 0)
                )
            except self.tk.TclError:
                pass
        return window

    def _field(
        self,
        parent: Any,
        label: str,
        value: str,
        *,
        readonly: bool = False,
    ) -> Any:
        self.tk.Label(
            parent,
            text=label,
            bg=self.paper,
            fg=self.sage,
            font=("Sans", 9, "bold"),
            anchor="w",
        ).pack(fill="x", pady=(8, 3))
        entry = self.tk.Entry(
            parent,
            bg="white",
            fg=self.night,
            relief="solid",
            borderwidth=1,
            highlightthickness=2,
            highlightbackground="#d9d4c9",
            highlightcolor=self.ember,
            insertbackground=self.night,
        )
        entry.insert(0, value)
        if readonly:
            entry.configure(
                state="readonly",
                readonlybackground="#f4f0e7",
            )
        entry.pack(fill="x", ipady=7)
        return entry

    def store(self, metadata: Metadata) -> tuple[Metadata, str] | None:
        validate_metadata(metadata)
        result: list[tuple[Metadata, str] | None] = [None]
        window = self._window("KeepKeys — Store a secret", 640, 680)
        self._header(
            window,
            "Local vault",
            "Your key goes straight to Secret Service.",
            "The agent prepared everything else. You only copy the key and approve the paste.",
        )
        body = self.tk.Frame(window, bg=self.paper, padx=26, pady=16)
        body.pack(fill="both", expand=True)
        footer = self.tk.Frame(body, bg=self.paper)
        footer.pack(fill="x", side="bottom")
        error = self.tk.Label(
            footer,
            text="",
            bg=self.paper,
            fg="#a43d2b",
            anchor="w",
            justify="left",
            wraplength=550,
        )
        error.pack(fill="x", pady=(4, 8))
        buttons = self.tk.Frame(footer, bg=self.paper)
        buttons.pack(fill="x")

        scroll_shell = self.tk.Frame(body, bg=self.paper)
        scroll_shell.pack(fill="both", expand=True)
        canvas = self.tk.Canvas(
            scroll_shell,
            bg=self.paper,
            borderwidth=0,
            highlightthickness=0,
        )
        scrollbar = self.tk.Scrollbar(
            scroll_shell,
            orient="vertical",
            command=canvas.yview,
        )
        content = self.tk.Frame(canvas, bg=self.paper)
        content_window = canvas.create_window((0, 0), window=content, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        content.bind(
            "<Configure>",
            lambda _event: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.bind(
            "<Configure>",
            lambda event: canvas.itemconfigure(content_window, width=event.width),
        )
        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)

        self._field(content, "Friendly name", metadata.name, readonly=True)
        self._field(content, "Environment variable", metadata.variable, readonly=True)
        self._field(content, "Provider", metadata.provider, readonly=True)
        self._field(content, "Description", metadata.description, readonly=True)
        self._field(
            content,
            "Official documentation",
            "   ·   ".join(metadata.documentation_urls),
            readonly=True,
        )
        hint = self.tk.Label(
            content,
            text=(
                "Copy the key immediately before clicking. KeepKeys clears the "
                "current clipboard after reading it, but same-user software or "
                "clipboard history may still observe it. The value never enters "
                "chat or a tool call."
            ),
            bg=self.paper,
            fg=self.sage,
            justify="left",
            anchor="w",
            wraplength=550,
        )
        hint.pack(fill="x", pady=(10, 4))

        def cancel() -> None:
            window.destroy()

        def submit() -> None:
            try:
                value = window.clipboard_get()
                window.clipboard_clear()
                window.update_idletasks()
                validate_secret(value)
            except (self.tk.TclError, KeepKeysError):
                value = ""
                error.configure(
                    text=(
                        "No usable key was found or KeepKeys could not clear the "
                        "clipboard. Copy the complete key, then press Paste & "
                        "Store again."
                    )
                )
                return
            if search_metadata(metadata.name) and not self.messagebox.askyesno(
                f"Replace “{metadata.name}”?",
                "This replaces the existing KeepKeys value and metadata.",
                parent=window,
                default="no",
                icon="warning",
            ):
                value = ""
                error.configure(
                    text=(
                        "Replacement was cancelled. KeepKeys already cleared "
                        "the clipboard; copy the key again if you retry."
                    )
                )
                return
            result[0] = (metadata, value)
            value = ""
            window.destroy()

        self.tk.Button(
            buttons,
            text="Cancel",
            command=cancel,
            bg="#e8e2d7",
            fg=self.night,
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right")
        store_button = self.tk.Button(
            buttons,
            text="Paste & Store",
            command=submit,
            bg=self.ember,
            fg="white",
            activebackground="#bf5c41",
            activeforeground="white",
            relief="flat",
            padx=18,
            pady=9,
            default="active",
        )
        store_button.pack(side="right", padx=(0, 10))
        window.bind("<Escape>", lambda _event: cancel())
        store_button.bind("<Return>", lambda _event: store_button.invoke())
        store_button.focus_set()
        window.grab_set()
        self.root.wait_window(window)
        self.root.destroy()
        return result[0]

    def confirm_remove(self, metadata: Metadata) -> bool:
        result = [False]
        window = self._window("KeepKeys — Remove a secret", 600, 390)
        self._header(
            window,
            "Destructive action",
            f"Remove “{metadata.name}”?",
            "This deletes the complete Secret Service item. KeepKeys cannot undo it.",
        )
        body = self.tk.Frame(window, bg=self.paper, padx=26, pady=20)
        body.pack(fill="both", expand=True)
        self.tk.Label(
            body,
            text=f"{metadata.variable}\n{metadata.description}",
            bg="white",
            fg=self.night,
            justify="left",
            anchor="w",
            padx=16,
            pady=14,
            relief="solid",
            borderwidth=1,
        ).pack(fill="x")
        buttons = self.tk.Frame(body, bg=self.paper)
        buttons.pack(fill="x", side="bottom")

        def finish(value: bool) -> None:
            result[0] = value
            window.destroy()

        self.tk.Button(
            buttons,
            text="Cancel",
            command=lambda: finish(False),
            bg="#e8e2d7",
            fg=self.night,
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right")
        self.tk.Button(
            buttons,
            text="Remove secret",
            command=lambda: finish(True),
            bg="#a43d2b",
            fg="white",
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right", padx=(0, 10))
        window.bind("<Escape>", lambda _event: finish(False))
        window.grab_set()
        self.root.wait_window(window)
        self.root.destroy()
        return result[0]

    def confirm_revoke(self, metadata: Metadata) -> bool:
        result = [False]
        window = self._window("KeepKeys - Disable automatic approvals", 620, 420)
        self._header(
            window,
            "Approval policy",
            f"Disable automatic approvals for '{metadata.name}'?",
            f"This removes {len(metadata.allow_rules)} exact-command rule(s). Future uses will show the native approval window again.",
        )
        body = self.tk.Frame(window, bg=self.paper, padx=26, pady=20)
        body.pack(fill="both", expand=True)
        self.tk.Label(
            body,
            text=f"{metadata.variable}\n{metadata.description}",
            bg="white",
            fg=self.night,
            justify="left",
            anchor="w",
            padx=16,
            pady=14,
            relief="solid",
            borderwidth=1,
        ).pack(fill="x")
        buttons = self.tk.Frame(body, bg=self.paper)
        buttons.pack(fill="x", side="bottom")

        def finish(value: bool) -> None:
            result[0] = value
            window.destroy()

        self.tk.Button(
            buttons,
            text="Cancel",
            command=lambda: finish(False),
            bg="#e8e2d7",
            fg=self.night,
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right")
        self.tk.Button(
            buttons,
            text="Disable automatic approvals",
            command=lambda: finish(True),
            bg=self.brass,
            fg=self.night,
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right", padx=(0, 10))
        window.bind("<Escape>", lambda _event: finish(False))
        window.grab_set()
        self.root.wait_window(window)
        self.root.destroy()
        return result[0]

    def approve(self, request: RunRequest, metadata: Metadata) -> str:
        result = ["cancel"]
        window = self._window("KeepKeys — Approve secret use", 720, 650)
        self._header(
            window,
            request.risk,
            f"Allow this command to use “{request.name}”?",
            "Allow once is one-time. Always allow saves only this exact command identity.",
        )
        body = self.tk.Frame(window, bg=self.paper, padx=26, pady=18)
        body.pack(fill="both", expand=True)
        details = [
            ("Purpose", request.purpose),
            ("Secret", f"{request.name} → {metadata.variable}"),
            ("Description", metadata.description),
            ("Provider", metadata.provider or "(legacy record)"),
            (
                "Official documentation",
                "\n".join(metadata.documentation_urls)
                if metadata.documentation_urls
                else "(legacy record)",
            ),
            ("Executable", str(request.program)),
            ("SHA-256", request.fingerprint),
            (
                "Arguments",
                "(none)"
                if not request.arguments
                else "\n".join(f"[{index}] {value}" for index, value in enumerate(request.arguments)),
            ),
            ("Working directory", str(request.cwd) if request.cwd else "(none)"),
            (
                "Environment",
                f"Cleared, then {metadata.variable} is added for this child only.",
            ),
        ]
        if request.entrypoint is not None:
            details.insert(
                5,
                (
                    "Script entrypoint",
                    f"{request.entrypoint}\nSHA-256 {request.entrypoint_fingerprint}",
                ),
            )
        text = "\n\n".join(f"{label.upper()}\n{value}" for label, value in details)
        detail = self.tk.Text(
            body,
            bg="white",
            fg=self.night,
            relief="solid",
            borderwidth=1,
            wrap="word",
            font=("Monospace", 9),
            padx=14,
            pady=12,
            height=21,
        )
        detail.insert("1.0", text)
        detail.configure(state="disabled")
        detail.pack(fill="both", expand=True)
        buttons = self.tk.Frame(body, bg=self.paper)
        buttons.pack(fill="x", pady=(14, 0))

        def finish(value: str) -> None:
            result[0] = value
            window.destroy()

        self.tk.Button(
            buttons,
            text="Cancel",
            command=lambda: finish("cancel"),
            bg="#e8e2d7",
            fg=self.night,
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right")
        self.tk.Button(
            buttons,
            text="Allow once",
            command=lambda: finish("once"),
            bg=self.ember,
            fg="white",
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right", padx=(0, 10))
        self.tk.Button(
            buttons,
            text="Always allow this exact command",
            command=lambda: finish("always"),
            bg=self.brass,
            fg=self.night,
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right", padx=(0, 10))
        window.bind("<Escape>", lambda _event: finish("cancel"))
        window.grab_set()
        self.root.wait_window(window)
        self.root.destroy()
        return result[0]


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(128 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise KeepKeysError("KeepKeys could not read the requested executable.") from error
    return digest.hexdigest()


def resolved_executable(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute() or any(ord(character) < 32 for character in raw_path):
        raise KeepKeysError("KeepKeys requires an absolute executable path.")
    resolved = path.resolve(strict=True)
    if not resolved.is_file() or not os.access(resolved, os.X_OK):
        raise KeepKeysError("The requested program is not an executable file.")
    if resolved.name.casefold() in BLOCKED_EXECUTABLES:
        raise KeepKeysError(
            "KeepKeys rejects shells and environment-dump programs. Use a direct executable."
        )
    return resolved


def resolved_cwd(raw_path: str | None) -> Path | None:
    if raw_path is None:
        return None
    path = Path(raw_path)
    if not path.is_absolute() or any(ord(character) < 32 for character in raw_path):
        raise KeepKeysError("The working directory must be an absolute path.")
    resolved = path.resolve(strict=True)
    if not resolved.is_dir():
        raise KeepKeysError("The requested working directory does not exist.")
    return resolved


def make_run_request(
    name: str,
    purpose: str,
    program: str,
    arguments: list[str],
    cwd: str | None,
) -> RunRequest:
    if not valid_name(name):
        raise KeepKeysError("The requested KeepKeys name is invalid.")
    if not valid_purpose(purpose):
        raise KeepKeysError("The purpose must be one visible line of at most 240 bytes.")
    if len(arguments) > 64 or any(
        len(value.encode("utf-8")) > 4_096
        or any(ord(character) < 32 for character in value)
        for value in arguments
    ):
        raise KeepKeysError("Arguments must be visible strings within KeepKeys limits.")
    executable = resolved_executable(program)
    risk = "DIRECT EXECUTABLE"
    if executable.name.casefold() in NETWORK_EXECUTABLES:
        risk = "NETWORK-CAPABLE EXECUTABLE"
    elif executable.name.casefold() in INTERPRETERS:
        risk = "SCRIPT INTERPRETER"
    entrypoint = None
    entrypoint_fingerprint = None
    if risk == "SCRIPT INTERPRETER" and arguments:
        candidate = Path(arguments[0])
        if not candidate.is_absolute() and cwd is not None:
            candidate = Path(cwd) / candidate
        try:
            candidate = candidate.resolve(strict=True)
        except OSError:
            candidate = Path()
        if candidate.is_file():
            entrypoint = candidate
            entrypoint_fingerprint = fingerprint(candidate)
    return RunRequest(
        name=name,
        purpose=purpose,
        program=executable,
        arguments=arguments,
        cwd=resolved_cwd(cwd),
        fingerprint=fingerprint(executable),
        risk=risk,
        entrypoint=entrypoint,
        entrypoint_fingerprint=entrypoint_fingerprint,
    )


def allow_rule_for(request: RunRequest, metadata: Metadata) -> AllowRule:
    return AllowRule(
        name=metadata.name,
        variable=metadata.variable,
        description=metadata.description,
        provider=metadata.provider,
        documentation_urls=metadata.documentation_urls,
        purpose=request.purpose,
        program=str(request.program),
        fingerprint=request.fingerprint,
        arguments=tuple(request.arguments),
        cwd=str(request.cwd) if request.cwd else None,
        entrypoint=str(request.entrypoint) if request.entrypoint else None,
        entrypoint_fingerprint=request.entrypoint_fingerprint,
    )


def matching_allow_rule(request: RunRequest, metadata: Metadata) -> bool:
    return allow_rule_for(request, metadata) in metadata.allow_rules


def metadata_with_allow_rule(metadata: Metadata, rule: AllowRule) -> Metadata:
    rules = metadata.allow_rules
    if rule not in rules:
        rules = (*rules, rule)
    updated = Metadata(
        name=metadata.name,
        variable=metadata.variable,
        description=metadata.description,
        provider=metadata.provider,
        documentation_urls=metadata.documentation_urls,
        allow_rules=rules,
    )
    validate_metadata(updated)
    return updated


def redaction_patterns(secret: str) -> list[str]:
    encoded = secret.encode("utf-8")
    patterns = {
        secret,
        base64.b64encode(encoded).decode("ascii"),
        encoded.hex(),
        encoded.hex().upper(),
        quote(secret, safe=""),
        json.dumps(secret, ensure_ascii=False)[1:-1],
    }
    return sorted((pattern for pattern in patterns if pattern), key=len, reverse=True)


def redact(value: str, secret: str) -> str:
    for pattern in redaction_patterns(secret):
        value = value.replace(pattern, "[REDACTED BY KEEPKEYS]")
    return value


class Capture:
    def __init__(self) -> None:
        self.data = bytearray()
        self.truncated = False
        self.lock = threading.Lock()

    def append(self, chunk: bytes) -> None:
        with self.lock:
            available = MAX_CAPTURED_BYTES - len(self.data)
            if available <= 0:
                self.truncated = True
            elif len(chunk) > available:
                self.data.extend(chunk[:available])
                self.truncated = True
            else:
                self.data.extend(chunk)


def drain(stream: Any, capture: Capture) -> None:
    try:
        for chunk in iter(lambda: stream.read(8_192), b""):
            capture.append(chunk)
    finally:
        stream.close()


def safe_output(capture: Capture, secret: str) -> tuple[str, bool]:
    if capture.truncated:
        return OMITTED_OUTPUT, True
    return redact(capture.data.decode("utf-8", errors="replace"), secret), False


def execute(request: RunRequest, metadata: Metadata, secret: str) -> dict[str, Any]:
    if fingerprint(request.program) != request.fingerprint:
        raise KeepKeysError(
            "The executable changed after approval details were prepared. "
            "KeepKeys refused to run it."
        )
    if request.entrypoint is not None and (
        fingerprint(request.entrypoint) != request.entrypoint_fingerprint
    ):
        raise KeepKeysError(
            "The script entrypoint changed after approval details were prepared. "
            "KeepKeys refused to run it."
        )
    process = subprocess.Popen(
        [str(request.program), *request.arguments],
        cwd=request.cwd,
        env={metadata.variable: secret},
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    stdout = Capture()
    stderr = Capture()
    threads = [
        threading.Thread(target=drain, args=(process.stdout, stdout), daemon=True),
        threading.Thread(target=drain, args=(process.stderr, stderr), daemon=True),
    ]
    for thread in threads:
        thread.start()
    exit_code = process.wait()
    for thread in threads:
        thread.join()
    stdout_text, stdout_truncated = safe_output(stdout, secret)
    stderr_text, stderr_truncated = safe_output(stderr, secret)
    return {
        "status": "ok",
        "exitCode": exit_code,
        "stdout": stdout_text,
        "stderr": stderr_text,
        "stdoutTruncated": stdout_truncated,
        "stderrTruncated": stderr_truncated,
        "message": f"Approved command finished with exit code {exit_code}.",
    }


def option(arguments: list[str], name: str) -> str | None:
    try:
        index = arguments.index(name)
    except ValueError:
        return None
    if index + 1 >= len(arguments) or arguments[index + 1].startswith("--"):
        raise KeepKeysError(f"{name} requires a value.")
    return arguments[index + 1]


def require_option(arguments: list[str], name: str) -> str:
    value = option(arguments, name)
    if value is None:
        raise KeepKeysError(f"{name} is required.")
    return value


def repeated_options(arguments: list[str], name: str) -> tuple[str, ...]:
    values: list[str] = []
    for index, argument in enumerate(arguments):
        if argument != name:
            continue
        if index + 1 >= len(arguments) or arguments[index + 1].startswith("--"):
            raise KeepKeysError(f"{name} requires a value.")
        values.append(arguments[index + 1])
    return tuple(values)


def portal_parent_is_bundled_portal(parent_pid: int) -> bool:
    try:
        executable_name = Path(
            os.readlink(f"/proc/{parent_pid}/exe")
        ).name.lower()
        arguments = Path(f"/proc/{parent_pid}/cmdline").read_bytes().split(
            b"\0"
        )
        expected_portal = Path(__file__).with_name(
            "keepkeys-portal.mjs"
        ).resolve()
        parent_script = Path(
            arguments[1].decode("utf-8", errors="strict")
        ).resolve()
    except (IndexError, OSError, UnicodeError, ValueError):
        return False
    return (
        executable_name in {"node", "nodejs"}
        and parent_script == expected_portal
    )


def action_store(arguments: list[str]) -> dict[str, Any]:
    metadata = Metadata(
        name=require_option(arguments, "--name"),
        variable=require_option(arguments, "--variable").upper(),
        description=require_option(arguments, "--description"),
        provider=require_option(arguments, "--provider"),
        documentation_urls=repeated_options(arguments, "--documentation-url"),
    )
    validate_metadata(metadata)
    entered = BrandedUI().store(metadata)
    if entered is None:
        return {"status": "cancelled", "message": "Secret storage was cancelled."}
    final_metadata, secret = entered
    return store_record(final_metadata, secret)


def action_rotate(arguments: list[str]) -> dict[str, Any]:
    name = require_option(arguments, "--name")
    if not valid_name(name):
        raise KeepKeysError("The requested KeepKeys name is invalid.")
    matches = search_metadata(name)
    if not matches:
        raise KeepKeysError(f"No KeepKeys secret is stored as '{name}'.")
    metadata = matches[0]
    rotation_metadata = Metadata(
        name=metadata.name,
        variable=metadata.variable,
        description=metadata.description,
        provider=metadata.provider,
        documentation_urls=metadata.documentation_urls,
    )
    entered = BrandedUI().store(rotation_metadata)
    if entered is None:
        return {"status": "cancelled", "message": "Secret rotation was cancelled."}
    final_metadata, secret = entered
    return store_record(final_metadata, secret, expected_existing=True)


def store_record(
    final_metadata: Metadata,
    secret: str,
    *,
    expected_existing: bool | None = None,
) -> dict[str, Any]:
    validate_metadata(final_metadata)
    validate_secret(secret)
    previous_metadata_items = search_metadata(final_metadata.name)
    previous_metadata = (
        previous_metadata_items[0] if previous_metadata_items else None
    )
    if (
        expected_existing is not None
        and (previous_metadata is not None) != expected_existing
    ):
        raise KeepKeysError(
            "The stored KeepKeys name changed after the phone page opened. "
            "Start a new phone intake and review the replacement warning."
        )
    previous_secret = (
        lookup_secret(final_metadata.name)
        if previous_metadata is not None
        else None
    )
    try:
        store_value(final_metadata.name, secret)
        store_metadata(final_metadata)
    except (
        KeepKeysError,
        OSError,
        subprocess.SubprocessError,
    ) as write_error:
        rollback_errors: list[BaseException] = []
        try:
            if previous_secret is None:
                if not clear_item(SECRET_SERVICE, final_metadata.name):
                    rollback_errors.append(
                        KeepKeysError(
                            "Secret Service did not remove the failed value."
                        )
                    )
            else:
                store_value(final_metadata.name, previous_secret)
        except (
            KeepKeysError,
            OSError,
            subprocess.SubprocessError,
        ) as rollback_error:
            rollback_errors.append(rollback_error)
        try:
            if previous_metadata is None:
                if not clear_item(METADATA_SERVICE, final_metadata.name):
                    rollback_errors.append(
                        KeepKeysError(
                            "Secret Service did not remove the failed metadata."
                        )
                    )
            else:
                store_metadata(
                    previous_metadata,
                    allow_legacy=(
                        not previous_metadata.provider
                        and not previous_metadata.documentation_urls
                    ),
                )
        except (
            KeepKeysError,
            OSError,
            subprocess.SubprocessError,
        ) as rollback_error:
            rollback_errors.append(rollback_error)
        if rollback_errors:
            raise PortalStorageUncertainError(
                f"Secret Service failed during storage and rollback. Remove "
                f"'{final_metadata.name}' from KeepKeys before retrying."
            ) from rollback_errors[0]
        raise write_error
    finally:
        secret = ""
        previous_secret = None
    return {
        "status": "ok",
        "message": f"Stored '{final_metadata.name}' in the desktop Secret Service.",
        "name": final_metadata.name,
        "variable": final_metadata.variable,
        "description": final_metadata.description,
        "provider": final_metadata.provider,
        "documentationUrls": list(final_metadata.documentation_urls),
    }


def read_portal_secret() -> bytearray:
    expected_digest = os.environ.pop(
        "KEEPKEYS_PORTAL_CAPABILITY_SHA256", ""
    )
    expected_parent = os.environ.pop("KEEPKEYS_PORTAL_PARENT_PID", "")
    if (
        sys.stdin.isatty()
        or not re.fullmatch(r"[a-f0-9]{64}", expected_digest)
        or not expected_parent.isascii()
        or not expected_parent.isdigit()
        or int(expected_parent) != os.getppid()
        or not portal_parent_is_bundled_portal(int(expected_parent))
    ):
        raise KeepKeysError(
            "The private phone-intake commit requires the live KeepKeys "
            "portal channel."
        )
    capability = bytearray()
    while len(capability) < PORTAL_CAPABILITY_BYTES:
        chunk = sys.stdin.buffer.read(
            PORTAL_CAPABILITY_BYTES - len(capability)
        )
        if not chunk:
            break
        capability.extend(chunk)
    try:
        if len(capability) != PORTAL_CAPABILITY_BYTES:
            raise KeepKeysError(
                "The private phone-intake channel ended before authorization."
            )
        actual_digest = hashlib.sha256(capability).hexdigest()
        if not hmac.compare_digest(actual_digest, expected_digest):
            raise KeepKeysError(
                "The private phone-intake channel was not authorized."
            )
    finally:
        for index in range(len(capability)):
            capability[index] = 0
    return bytearray(sys.stdin.buffer.read(MAX_SECRET_BYTES + 1))


def action_portal_commit(arguments: list[str]) -> dict[str, Any]:
    metadata = Metadata(
        name=require_option(arguments, "--name"),
        variable=require_option(arguments, "--variable").upper(),
        description=require_option(arguments, "--description"),
        provider=require_option(arguments, "--provider"),
        documentation_urls=repeated_options(arguments, "--documentation-url"),
    )
    validate_metadata(metadata)
    expected_value = require_option(arguments, "--expect-existing")
    if expected_value not in {"yes", "no"}:
        raise KeepKeysError(
            "The private phone-intake replacement state is invalid."
        )
    native_self_test_value = option(arguments, "--native-self-test") or "no"
    if native_self_test_value not in {
        "no",
        "round-trip",
        "create-to-replace",
        "replace-to-create",
    }:
        raise KeepKeysError(
            "The private native portal test request is invalid."
        )
    native_self_test = native_self_test_value != "no"
    native_self_test_flag = os.environ.pop(
        "KEEPKEYS_PORTAL_NATIVE_TEST", ""
    )
    if native_self_test and (
        native_self_test_flag != "1"
        or not metadata.name.startswith("keepkeys-portal-test-")
        or (
            native_self_test_value == "replace-to-create"
            and expected_value != "yes"
        )
        or (
            native_self_test_value != "replace-to-create"
            and expected_value != "no"
        )
    ):
        raise KeepKeysError(
            "KeepKeys rejected an unauthorized native portal test."
        )
    secret_bytes = read_portal_secret()
    try:
        if len(secret_bytes) > MAX_SECRET_BYTES:
            raise KeepKeysError(
                f"Secret values must not exceed {MAX_SECRET_BYTES} UTF-8 bytes."
            )
        try:
            secret = secret_bytes.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise KeepKeysError(
                "The phone submitted an invalid UTF-8 key."
            ) from error
        try:
            if not native_self_test:
                return store_record(
                    metadata,
                    secret,
                    expected_existing=expected_value == "yes",
                )
            race_secret = f"{secret}-replacement-race"
            validate_secret(race_secret)
            replacement_state_message = (
                "The stored KeepKeys name changed after the phone page opened. "
                "Start a new phone intake and review the replacement warning."
            )
            record_created = False
            try:
                if native_self_test_value == "round-trip":
                    result = store_record(
                        metadata,
                        secret,
                        expected_existing=False,
                    )
                    record_created = True
                    verified = (
                        result.get("status") == "ok"
                        and lookup_secret(metadata.name) == secret
                        and search_metadata(metadata.name) == [metadata]
                    )
                elif native_self_test_value == "create-to-replace":
                    store_record(
                        metadata,
                        secret,
                        expected_existing=False,
                    )
                    record_created = True
                    rejected = False
                    try:
                        store_record(
                            metadata,
                            race_secret,
                            expected_existing=False,
                        )
                    except KeepKeysError as error:
                        if str(error) != replacement_state_message:
                            raise
                        rejected = True
                    verified = (
                        rejected
                        and lookup_secret(metadata.name) == secret
                        and search_metadata(metadata.name) == [metadata]
                    )
                else:
                    rejected = False
                    try:
                        store_record(
                            metadata,
                            race_secret,
                            expected_existing=True,
                        )
                    except KeepKeysError as error:
                        if str(error) != replacement_state_message:
                            raise
                        rejected = True
                    verified = (
                        rejected
                        and not search_metadata(metadata.name)
                    )
            finally:
                if record_created:
                    clear_native_portal_test_record(metadata.name)
                race_secret = ""
            if (
                not verified
                or search_metadata(metadata.name)
            ):
                raise KeepKeysError(
                    "The temporary native portal Secret Service scenario or "
                    "cleanup did not verify."
                )
            return {
                "status": "ok",
                "message": (
                    "Temporary native portal Secret Service scenario and "
                    "cleanup verified."
                ),
                "cleaned": True,
                "scenario": native_self_test_value,
            }
        finally:
            secret = ""
    finally:
        for index in range(len(secret_bytes)):
            secret_bytes[index] = 0


def action_remove(arguments: list[str]) -> dict[str, Any]:
    name = require_option(arguments, "--name")
    if not valid_name(name):
        raise KeepKeysError("The requested KeepKeys name is invalid.")
    matches = search_metadata(name)
    if not matches:
        return {
            "status": "ok",
            "message": f"No KeepKeys item named '{name}' exists.",
            "removed": False,
        }
    if not BrandedUI().confirm_remove(matches[0]):
        return {"status": "cancelled", "message": "Secret removal was cancelled."}
    removed = remove_secret(name)
    return {
        "status": "ok",
        "message": f"Removed '{name}' from the desktop Secret Service.",
        "removed": removed,
    }


def action_revoke(arguments: list[str]) -> dict[str, Any]:
    name = require_option(arguments, "--name")
    if not valid_name(name):
        raise KeepKeysError("The requested KeepKeys name is invalid.")
    matches = search_metadata(name)
    if not matches:
        return {
            "status": "ok",
            "message": f"No KeepKeys item named '{name}' exists.",
            "revokedRules": 0,
        }
    metadata = matches[0]
    if not metadata.allow_rules:
        return {
            "status": "ok",
            "message": f"No always-allow rules are stored for '{name}'.",
            "revokedRules": 0,
        }
    if not BrandedUI().confirm_revoke(metadata):
        return {
            "status": "cancelled",
            "message": "Always-allow revocation was cancelled.",
        }
    current = search_metadata(name)
    if not current or current[0] != metadata:
        raise KeepKeysError(
            "The secret metadata changed before approval rules could be revoked. Try again."
        )
    cleared = Metadata(
        name=metadata.name,
        variable=metadata.variable,
        description=metadata.description,
        provider=metadata.provider,
        documentation_urls=metadata.documentation_urls,
    )
    store_metadata(cleared)
    return {
        "status": "ok",
        "message": f"Disabled automatic approvals for '{name}'.",
        "revokedRules": len(metadata.allow_rules),
    }


def action_run(arguments: list[str]) -> dict[str, Any]:
    try:
        separator = arguments.index("--")
    except ValueError as error:
        raise KeepKeysError("Run requests require '--' before the executable.") from error
    options = arguments[:separator]
    command = arguments[separator + 1 :]
    if not command:
        raise KeepKeysError("Run requests require an executable.")
    request = make_run_request(
        name=require_option(options, "--name"),
        purpose=require_option(options, "--purpose"),
        program=command[0],
        arguments=command[1:],
        cwd=option(options, "--cwd"),
    )
    matches = search_metadata(request.name)
    if not matches:
        raise KeepKeysError(f"No KeepKeys secret is stored as '{request.name}'.")
    metadata = matches[0]
    if matching_allow_rule(request, metadata):
        decision = "always"
    else:
        decision = BrandedUI().approve(request, metadata)
    if decision == "cancel":
        return {"status": "cancelled", "message": "Command use was cancelled."}
    if decision not in {"once", "always"}:
        raise KeepKeysError("KeepKeys received an invalid approval decision.")
    refreshed = search_metadata(request.name)
    if not refreshed or refreshed[0] != metadata:
        raise KeepKeysError(
            "The secret metadata changed after approval. KeepKeys refused to run."
        )
    if decision == "always" and not matching_allow_rule(request, metadata):
        # Store only metadata after explicit UI approval; a rotation replaces this with no rules.
        metadata = metadata_with_allow_rule(metadata, allow_rule_for(request, metadata))
        store_metadata(metadata)
    secret = lookup_secret(request.name)
    try:
        refreshed = search_metadata(request.name)
        if not refreshed or refreshed[0] != metadata:
            raise KeepKeysError(
                "The secret metadata changed after approval. KeepKeys refused to run."
            )
        return execute(request, metadata, secret)
    finally:
        secret = ""


def action_doctor() -> dict[str, Any]:
    require_linux_runtime(require_ui=False)
    name = f"keepkeys-doctor-{os.urandom(12).hex()}"
    first = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
    second = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
    first_metadata = Metadata(
        name=name,
        variable="KEEPKEYS_DOCTOR",
        description="Temporary KeepKeys Secret Service verification",
        provider="BarnLabs",
        documentation_urls=("https://github.com/barnlabs/keepkeys",),
    )
    second_metadata = Metadata(
        name=name,
        variable="KEEPKEYS_DOCTOR_UPDATED",
        description="Updated temporary KeepKeys verification",
        provider="BarnLabs",
        documentation_urls=(
            "https://github.com/barnlabs/keepkeys/blob/main/README.md",
        ),
    )
    try:
        store_value(name, first)
        store_metadata(first_metadata)
        first_matches = (
            lookup_secret(name) == first and search_metadata(name) == [first_metadata]
        )
        store_value(name, second)
        store_metadata(second_metadata)
        second_matches = (
            lookup_secret(name) == second and search_metadata(name) == [second_metadata]
        )
    finally:
        clear_item(METADATA_SERVICE, name)
        clear_item(SECRET_SERVICE, name)
        first = ""
        second = ""
    if not first_matches or not second_matches or search_metadata(name):
        raise KeepKeysError("The temporary Secret Service round trip did not verify.")
    return {
        "status": "ok",
        "message": (
            "Temporary Secret Service add, metadata list, update, read, and deletion "
            "all verified."
        ),
        "platform": "Linux",
        "version": VERSION,
    }


def action_self_test() -> dict[str, Any]:
    if not (
        valid_name("github-release")
        and valid_name("new-key")
        and not valid_name("../../escape")
        and valid_variable("GITHUB_TOKEN")
        and not valid_variable("PATH")
        and not valid_variable("LD_PRELOAD")
        and valid_provider("GitHub")
        and valid_documentation_url("https://docs.github.com/en/rest")
        and not valid_documentation_url("http://docs.example.com")
    ):
        raise KeepKeysError("Validation self-test failed.")
    metadata = Metadata(
        name="self-test",
        variable="KEEPKEYS_TEST",
        description="Synthetic scoped-process self-test",
        provider="BarnLabs",
        documentation_urls=("https://github.com/barnlabs/keepkeys",),
    )
    label = encode_label(metadata)
    if decode_label(label) != metadata:
        raise KeepKeysError("Metadata self-test failed.")
    marker = "synthetic-test-secret"
    sample = f"before {marker} {base64.b64encode(marker.encode()).decode()} after"
    redacted = redact(sample, marker)
    if marker in redacted or base64.b64encode(marker.encode()).decode() in redacted:
        raise KeepKeysError("Redaction self-test failed.")
    process = subprocess.run(
        ["/usr/bin/env"],
        env={metadata.variable: marker},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output = redact(process.stdout.decode("utf-8"), marker)
    if (
        process.returncode != 0
        or "KEEPKEYS_TEST=[REDACTED BY KEEPKEYS]" not in output
        or marker in output
    ):
        raise KeepKeysError("Scoped-process self-test failed.")
    return {
        "status": "ok",
        "message": (
            "KeepKeys Linux validation, metadata, scoped-process, and redaction "
            "self-tests passed."
        ),
        "version": VERSION,
    }


def main(arguments: list[str]) -> None:
    if not arguments:
        fail("Usage: keepkeys <store|rotate|revoke|list|remove|run|status|doctor|--self-test>")
    action, rest = arguments[0], arguments[1:]
    try:
        if action == "store":
            if os.environ.pop("KEEPKEYS_SERIALIZED_MUTATION", "") != "1":
                raise KeepKeysError(
                    "KeepKeys store and remove actions must use the shared "
                    "per-name coordinator."
                )
            result = action_store(rest)
        elif action == "rotate":
            if os.environ.pop("KEEPKEYS_SERIALIZED_MUTATION", "") != "1":
                raise KeepKeysError(
                    "KeepKeys rotate actions must use the shared per-name coordinator."
                )
            result = action_rotate(rest)
        elif action == "revoke":
            if os.environ.pop("KEEPKEYS_SERIALIZED_MUTATION", "") != "1":
                raise KeepKeysError(
                    "KeepKeys revoke actions must use the shared per-name coordinator."
                )
            result = action_revoke(rest)
        elif action == "_portal-commit":
            result = action_portal_commit(rest)
        elif action == "list":
            result = {
                "status": "ok",
                "entries": [
                    {
                        "name": item.name,
                        "variable": item.variable,
                        "description": item.description,
                        "provider": item.provider,
                        "documentationUrls": list(item.documentation_urls),
                    }
                    for item in search_metadata()
                ],
            }
        elif action == "remove":
            if os.environ.pop("KEEPKEYS_SERIALIZED_MUTATION", "") != "1":
                raise KeepKeysError(
                    "KeepKeys store, rotate, revoke, and remove actions must use the shared "
                    "per-name coordinator."
                )
            result = action_remove(rest)
        elif action == "run":
            result = action_run(rest)
        elif action == "status":
            secret_tool = require_linux_runtime(require_ui=False)
            result = {
                "status": "ok",
                "message": "KeepKeys Linux helper is available.",
                "platform": "Linux",
                "version": VERSION,
                "vault": "freedesktop Secret Service",
                "secretTool": secret_tool,
                "graphicalSession": bool(
                    os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
                ),
                "plaintextRetrieval": False,
            }
        elif action == "doctor":
            result = action_doctor()
        elif action == "--self-test":
            result = action_self_test()
        else:
            raise KeepKeysError(f"Unknown KeepKeys action '{action}'.")
        emit(result)
    except PortalStorageUncertainError as error:
        fail(
            str(error),
            storageState="uncertain",
            cleanupKind="native-rollback",
        )
    except KeepKeysError as error:
        fail(str(error))
    except (OSError, subprocess.SubprocessError) as error:
        fail(f"KeepKeys could not complete the local operation: {error.__class__.__name__}.")


if __name__ == "__main__":
    main(sys.argv[1:])

#!/usr/bin/env python3
"""KeepKeys native Linux helper.

Secrets live in a freedesktop Secret Service implementation and enter this
process only after a local graphical approval. This module intentionally has no
plaintext retrieval action.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
from typing import Any, NoReturn
from urllib.parse import quote

VERSION = "0.4.1"
METADATA_SERVICE = "net.barnlabs.keepkeys.metadata"
SECRET_SERVICE = "net.barnlabs.keepkeys.secret"
LABEL_PREFIX = "KeepKeys|v1|"
MAX_SECRET_BYTES = 2_048
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


@dataclass(frozen=True)
class Metadata:
    name: str
    variable: str
    description: str


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


def fail(message: str) -> NoReturn:
    emit({"status": "error", "message": message})
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


def valid_purpose(value: str) -> bool:
    return valid_description(value)


def validate_secret(value: str) -> None:
    size = len(value.encode("utf-8"))
    if size < 8:
        raise KeepKeysError("Secret values must contain at least 8 UTF-8 bytes.")
    if size > MAX_SECRET_BYTES:
        raise KeepKeysError(
            f"Secret values must not exceed {MAX_SECRET_BYTES} UTF-8 bytes."
        )


def validate_metadata(metadata: Metadata) -> None:
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


def encode_label(metadata: Metadata) -> str:
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
    return LABEL_PREFIX + encoded


def decode_label(label: str) -> Metadata | None:
    if not label.startswith(LABEL_PREFIX):
        return None
    encoded = label[len(LABEL_PREFIX) :]
    encoded += "=" * (-len(encoded) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        metadata = Metadata(
            name=payload["name"],
            variable=payload["variable"],
            description=payload["description"],
        )
        validate_metadata(metadata)
        return metadata
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
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
    result = run_secret_tool(arguments, required=False)
    if result.returncode != 0:
        return []
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


def lookup_secret_optional(name: str) -> str | None:
    result = run_secret_tool(
        ["lookup", "service", SECRET_SERVICE, "name", name],
        required=False,
    )
    if result.returncode != 0:
        return None
    try:
        secret = result.stdout.decode("utf-8")
        validate_secret(secret)
        return secret
    except (UnicodeDecodeError, KeepKeysError):
        return None


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


def store_metadata(metadata: Metadata) -> None:
    validate_metadata(metadata)
    run_secret_tool(
        [
            "store",
            f"--label=KeepKeys metadata · {metadata.name}",
            "service",
            METADATA_SERVICE,
            "name",
            metadata.name,
        ],
        secret_input=encode_label(metadata),
    )


def clear_item(service: str, name: str) -> bool:
    result = run_secret_tool(
        ["clear", "service", service, "name", name],
        required=False,
    )
    return result.returncode == 0


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
        window.geometry(f"{width}x{height}")
        window.resizable(False, False)
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
        secret: bool = False,
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
            show="•" if secret else "",
        )
        entry.insert(0, value)
        entry.pack(fill="x", ipady=7)
        return entry

    def store(self, metadata: Metadata) -> tuple[Metadata, str] | None:
        result: list[tuple[Metadata, str] | None] = [None]
        window = self._window("KeepKeys — Store a secret", 620, 600)
        self._header(
            window,
            "Local vault",
            "You type the key. The agent never sees it.",
            "Review the reusable name and variable, then enter only the secret value.",
        )
        body = self.tk.Frame(window, bg=self.paper, padx=26, pady=16)
        body.pack(fill="both", expand=True)
        name = self._field(body, "Friendly name", metadata.name)
        variable = self._field(body, "Environment variable", metadata.variable)
        description = self._field(body, "Description", metadata.description)
        secret = self._field(body, "Secret value", "", secret=True)
        hint = self.tk.Label(
            body,
            text="Stored in your desktop Secret Service. Never written to a .env file or returned to chat.",
            bg=self.paper,
            fg=self.sage,
            justify="left",
            anchor="w",
            wraplength=550,
        )
        hint.pack(fill="x", pady=(10, 4))
        error = self.tk.Label(
            body,
            text="",
            bg=self.paper,
            fg="#a43d2b",
            anchor="w",
            justify="left",
            wraplength=550,
        )
        error.pack(fill="x")

        buttons = self.tk.Frame(body, bg=self.paper)
        buttons.pack(fill="x", side="bottom", pady=(10, 0))

        def cancel() -> None:
            window.destroy()

        def submit() -> None:
            candidate = Metadata(
                name=name.get().strip(),
                variable=variable.get().strip().upper(),
                description=description.get().strip(),
            )
            value = secret.get()
            try:
                validate_metadata(candidate)
                validate_secret(value)
            except KeepKeysError as caught:
                error.configure(text=str(caught))
                secret.focus_set()
                return
            if search_metadata(candidate.name) and not self.messagebox.askyesno(
                f"Replace “{candidate.name}”?",
                "This replaces the existing KeepKeys value and metadata.",
                parent=window,
                default="no",
                icon="warning",
            ):
                return
            result[0] = (candidate, value)
            secret.delete(0, self.tk.END)
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
        self.tk.Button(
            buttons,
            text="Store securely",
            command=submit,
            bg=self.ember,
            fg="white",
            activebackground="#bf5c41",
            activeforeground="white",
            relief="flat",
            padx=18,
            pady=9,
        ).pack(side="right", padx=(0, 10))
        secret.focus_set()
        window.bind("<Escape>", lambda _event: cancel())
        window.bind("<Return>", lambda _event: submit())
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

    def approve(self, request: RunRequest, metadata: Metadata) -> bool:
        result = [False]
        window = self._window("KeepKeys — Approve secret use", 720, 650)
        self._header(
            window,
            request.risk,
            f"Allow this command to use “{request.name}”?",
            "Approval is one-time. The executable and its child processes can read the secret.",
        )
        body = self.tk.Frame(window, bg=self.paper, padx=26, pady=18)
        body.pack(fill="both", expand=True)
        details = [
            ("Purpose", request.purpose),
            ("Secret", f"{request.name} → {metadata.variable}"),
            ("Description", metadata.description),
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
            text="Allow once",
            command=lambda: finish(True),
            bg=self.ember,
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


def action_store(arguments: list[str]) -> dict[str, Any]:
    metadata = Metadata(
        name=require_option(arguments, "--name"),
        variable=require_option(arguments, "--variable").upper(),
        description=require_option(arguments, "--description"),
    )
    validate_metadata(metadata)
    entered = BrandedUI().store(metadata)
    if entered is None:
        return {"status": "cancelled", "message": "Secret storage was cancelled."}
    final_metadata, secret = entered
    previous_metadata_items = search_metadata(final_metadata.name)
    previous_metadata = (
        previous_metadata_items[0] if previous_metadata_items else None
    )
    previous_secret = (
        lookup_secret_optional(final_metadata.name)
        if previous_metadata is not None
        else None
    )
    try:
        store_value(final_metadata.name, secret)
        store_metadata(final_metadata)
    except KeepKeysError as write_error:
        try:
            if previous_secret is None:
                clear_item(SECRET_SERVICE, final_metadata.name)
            else:
                store_value(final_metadata.name, previous_secret)
            if previous_metadata is None:
                clear_item(METADATA_SERVICE, final_metadata.name)
            else:
                store_metadata(previous_metadata)
        except KeepKeysError as rollback_error:
            raise KeepKeysError(
                f"Secret Service failed during storage and rollback. Remove "
                f"'{final_metadata.name}' from KeepKeys before retrying."
            ) from rollback_error
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
    }


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
    if not BrandedUI().approve(request, metadata):
        return {"status": "cancelled", "message": "Command use was cancelled."}
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
    )
    second_metadata = Metadata(
        name=name,
        variable="KEEPKEYS_DOCTOR_UPDATED",
        description="Updated temporary KeepKeys verification",
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
        and not valid_name("../../escape")
        and valid_variable("GITHUB_TOKEN")
        and not valid_variable("PATH")
        and not valid_variable("LD_PRELOAD")
    ):
        raise KeepKeysError("Validation self-test failed.")
    metadata = Metadata(
        name="self-test",
        variable="KEEPKEYS_TEST",
        description="Synthetic scoped-process self-test",
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
        fail("Usage: keepkeys <store|list|remove|run|status|doctor|--self-test>")
    action, rest = arguments[0], arguments[1:]
    try:
        if action == "store":
            result = action_store(rest)
        elif action == "list":
            result = {
                "status": "ok",
                "entries": [
                    {
                        "name": item.name,
                        "variable": item.variable,
                        "description": item.description,
                    }
                    for item in search_metadata()
                ],
            }
        elif action == "remove":
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
    except KeepKeysError as error:
        fail(str(error))
    except (OSError, subprocess.SubprocessError) as error:
        fail(f"KeepKeys could not complete the local operation: {error.__class__.__name__}.")


if __name__ == "__main__":
    main(sys.argv[1:])

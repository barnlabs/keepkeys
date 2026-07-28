"""Headless contract tests for the KeepKeys Linux backend."""

from __future__ import annotations

import base64
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("keepkeys.linux.py")
SPEC = importlib.util.spec_from_file_location("keepkeys_linux", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
keepkeys_linux = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = keepkeys_linux
SPEC.loader.exec_module(keepkeys_linux)


class LinuxBackendTests(unittest.TestCase):
    def test_metadata_label_round_trip_contains_no_value(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="github-release",
            variable="GITHUB_TOKEN",
            description="Publishes an approved release",
            provider="GitHub",
            documentation_urls=("https://docs.github.com/en/rest",),
        )
        label = keepkeys_linux.encode_label(metadata)
        self.assertEqual(keepkeys_linux.decode_label(label), metadata)
        self.assertNotIn("synthetic-secret-value", label)

    def test_legacy_metadata_can_be_restored_without_upgrading_its_label(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="legacy-key",
            variable="LEGACY_TOKEN",
            description="Existing version-one record",
        )
        with patch.object(keepkeys_linux, "run_secret_tool") as secret_tool:
            keepkeys_linux.store_metadata(metadata, allow_legacy=True)
        stored_label = secret_tool.call_args.kwargs["secret_input"]
        self.assertTrue(stored_label.startswith(keepkeys_linux.LABEL_PREFIX_V1))
        self.assertEqual(keepkeys_linux.decode_label(stored_label), metadata)

    def test_search_parses_only_valid_keepkeys_labels(self) -> None:
        valid = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        output = (
            "[/org/freedesktop/secrets/collection/login/1]\n"
            "label = KeepKeys metadata · demo\n"
            f"secret = {keepkeys_linux.encode_label(valid)}\n"
            "attribute.service = net.barnlabs.keepkeys.metadata\n"
            "attribute.name = demo\n"
            "[/org/freedesktop/secrets/collection/login/2]\n"
            "label = unrelated\n"
            "secret = unrelated\n"
        ).encode()
        completed = subprocess.CompletedProcess(
            args=["secret-tool"],
            returncode=0,
            stdout=output,
            stderr=b"",
        )
        with patch.object(
            keepkeys_linux,
            "run_secret_tool",
            return_value=completed,
        ) as secret_tool:
            self.assertEqual(keepkeys_linux.search_metadata(), [valid])
        self.assertEqual(
            secret_tool.call_args.args[0],
            [
                "search",
                "--all",
                "--unlock",
                "service",
                keepkeys_linux.METADATA_SERVICE,
            ],
        )

    def test_malformed_v2_documentation_items_fail_closed(self) -> None:
        payload = base64.urlsafe_b64encode(
            b'{"name":"demo","variable":"DEMO_TOKEN","description":"d",'
            b'"provider":"Example","documentationUrls":[1]}'
        ).decode("ascii").rstrip("=")
        self.assertIsNone(
            keepkeys_linux.decode_label(
                keepkeys_linux.LABEL_PREFIX_V2 + payload
            )
        )

    def test_common_secret_representations_are_redacted(self) -> None:
        marker = "synthetic-test-secret"
        encoded = base64.b64encode(marker.encode()).decode()
        result = keepkeys_linux.redact(f"{marker} {encoded}", marker)
        self.assertNotIn(marker, result)
        self.assertNotIn(encoded, result)
        self.assertEqual(result.count("[REDACTED BY KEEPKEYS]"), 2)

    def test_reserved_environment_controls_are_rejected(self) -> None:
        self.assertTrue(keepkeys_linux.valid_variable("SERVICE_API_TOKEN"))
        for value in ("PATH", "LD_PRELOAD", "PYTHONPATH", "NODE_OPTIONS"):
            self.assertFalse(keepkeys_linux.valid_variable(value), value)

    def test_store_metadata_contract_accepts_new_key_and_https_docs(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="new-key",
            variable="SECRET_KEY",
            description="Credential for future approved agent commands",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        keepkeys_linux.validate_metadata(metadata)
        with self.assertRaises(keepkeys_linux.KeepKeysError):
            keepkeys_linux.validate_metadata(
                keepkeys_linux.Metadata(
                    name="new-key",
                    variable="SECRET_KEY",
                    description="Credential for future approved agent commands",
                    provider="Example",
                    documentation_urls=("http://docs.example.com/api",),
                )
            )

    def test_phone_portal_commit_rejects_the_old_forgeable_environment_flag(
        self,
    ) -> None:
        class RedirectedInput:
            buffer = BytesIO(b"synthetic_secret")

            @staticmethod
            def isatty() -> bool:
                return False

        arguments = [
            "--name",
            "demo",
            "--variable",
            "DEMO_TOKEN",
            "--description",
            "Synthetic test credential",
            "--provider",
            "Example",
            "--documentation-url",
            "https://docs.example.com/api",
            "--expect-existing",
            "no",
        ]
        with (
            patch.dict(
                keepkeys_linux.os.environ,
                {"KEEPKEYS_PORTAL_COMMIT": "1"},
            ),
            patch.object(keepkeys_linux.sys, "stdin", RedirectedInput()),
            self.assertRaisesRegex(
                keepkeys_linux.KeepKeysError,
                "live KeepKeys portal channel",
            ),
        ):
            keepkeys_linux.action_portal_commit(arguments)

    def test_phone_portal_commit_stores_redirected_bytes_without_tool_value(self) -> None:
        capability = b"c" * keepkeys_linux.PORTAL_CAPABILITY_BYTES

        class RedirectedInput:
            buffer = BytesIO(capability + b"synthetic_secret")

            @staticmethod
            def isatty() -> bool:
                return False

        arguments = [
            "--name",
            "demo",
            "--variable",
            "DEMO_TOKEN",
            "--description",
            "Synthetic test credential",
            "--provider",
            "Example",
            "--documentation-url",
            "https://docs.example.com/api",
            "--expect-existing",
            "no",
        ]
        with (
            patch.dict(
                keepkeys_linux.os.environ,
                {
                    "KEEPKEYS_PORTAL_CAPABILITY_SHA256": (
                        keepkeys_linux.hashlib.sha256(capability).hexdigest()
                    ),
                    "KEEPKEYS_PORTAL_PARENT_PID": "1234",
                },
            ),
            patch.object(keepkeys_linux.os, "getppid", return_value=1234),
            patch.object(
                keepkeys_linux,
                "portal_parent_is_bundled_portal",
                return_value=True,
            ),
            patch.object(keepkeys_linux.sys, "stdin", RedirectedInput()),
            patch.object(
                keepkeys_linux,
                "search_metadata",
                return_value=[],
            ),
            patch.object(keepkeys_linux, "store_value") as store_value,
            patch.object(keepkeys_linux, "store_metadata") as store_metadata,
        ):
            result = keepkeys_linux.action_portal_commit(arguments)
        self.assertEqual(result["status"], "ok")
        store_value.assert_called_once_with("demo", "synthetic_secret")
        stored_metadata = store_metadata.call_args.args[0]
        self.assertEqual(stored_metadata.name, "demo")
        self.assertNotIn("secret", result)
        self.assertNotIn("value", result)

    def test_malformed_documentation_url_returns_structured_error_before_ui(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(MODULE_PATH),
                "store",
                "--name",
                "test-key",
                "--variable",
                "TEST_KEY",
                "--description",
                "Test credential",
                "--provider",
                "Example",
                "--documentation-url",
                "https://[",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stderr, "")
        self.assertNotIn("Traceback", completed.stdout)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["status"], "error")
        self.assertIn("documentation", payload["message"].lower())

    def test_store_dialog_has_no_window_wide_return_clipboard_trigger(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn(
            'window.bind("<Return>", lambda _event: submit())',
            source,
        )
        self.assertIn(
            'store_button.bind("<Return>", lambda _event: store_button.invoke())',
            source,
        )
        self.assertIn("window.clipboard_clear()", source)
        self.assertIn("winfo_screenheight()", source)
        self.assertIn("self.tk.Canvas", source)
        capture = source.index("value = window.clipboard_get()")
        clear = source.index("window.clipboard_clear()", capture)
        validate = source.index("validate_secret(value)", clear)
        self.assertLess(capture, clear)
        self.assertLess(clear, validate)

    def test_truncated_stream_is_omitted_in_full(self) -> None:
        capture = keepkeys_linux.Capture()
        capture.append(b"A" * keepkeys_linux.MAX_CAPTURED_BYTES)
        capture.append(b"secret-after-bound")
        text, truncated = keepkeys_linux.safe_output(
            capture,
            "secret-after-bound",
        )
        self.assertTrue(truncated)
        self.assertEqual(text, keepkeys_linux.OMITTED_OUTPUT)
        self.assertNotIn("secret-after-bound", text)


if __name__ == "__main__":
    unittest.main()

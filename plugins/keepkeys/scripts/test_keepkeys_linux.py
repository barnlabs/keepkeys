"""Headless contract tests for the KeepKeys Linux backend."""

from __future__ import annotations

import base64
import importlib.util
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
        )
        label = keepkeys_linux.encode_label(metadata)
        self.assertEqual(keepkeys_linux.decode_label(label), metadata)
        self.assertNotIn("synthetic-secret-value", label)

    def test_search_parses_only_valid_keepkeys_labels(self) -> None:
        valid = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
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

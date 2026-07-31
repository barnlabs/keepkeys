"""Headless contract tests for the KeepKeys Linux backend."""

from __future__ import annotations

import base64
from io import BytesIO, StringIO
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import unittest
from unittest.mock import call, patch

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

    def test_persistent_allow_rule_round_trip_contains_no_value(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="github-release",
            variable="GITHUB_TOKEN",
            description="Publishes an approved release",
            provider="GitHub",
            documentation_urls=("https://docs.github.com/en/rest",),
        )
        request = keepkeys_linux.RunRequest(
            name="github-release",
            purpose="Publish the approved release",
            program=PurePosixPath("/usr/bin/gh"),
            arguments=["release", "create", "v1"],
            cwd=PurePosixPath("/tmp/project"),
            fingerprint="a" * 64,
            risk="NETWORK-CAPABLE EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        stored = keepkeys_linux.metadata_with_allow_rule(
            metadata,
            keepkeys_linux.allow_rule_for(request, metadata),
        )
        label = keepkeys_linux.encode_label(stored)
        self.assertTrue(label.startswith(keepkeys_linux.LABEL_PREFIX_V3))
        self.assertEqual(keepkeys_linux.decode_label(label), stored)
        self.assertNotIn("synthetic-secret-value", label)

    def test_allow_rule_requires_exact_metadata_and_command_identity(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        request = keepkeys_linux.RunRequest(
            name="demo",
            purpose="Deploy synthetic example",
            program=PurePosixPath("/usr/bin/example"),
            arguments=["deploy", "--safe"],
            cwd=PurePosixPath("/tmp/example"),
            fingerprint="b" * 64,
            risk="DIRECT EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        stored = keepkeys_linux.metadata_with_allow_rule(
            metadata,
            keepkeys_linux.allow_rule_for(request, metadata),
        )
        self.assertTrue(keepkeys_linux.matching_allow_rule(request, stored))
        self.assertFalse(
            keepkeys_linux.matching_allow_rule(
                keepkeys_linux.RunRequest(
                    **{**request.__dict__, "purpose": "Deploy a different target"}
                ),
                stored,
            )
        )
        self.assertFalse(
            keepkeys_linux.matching_allow_rule(
                keepkeys_linux.RunRequest(
                    **{**request.__dict__, "arguments": ["deploy", "--force"]}
                ),
                stored,
            )
        )
        self.assertFalse(
            keepkeys_linux.matching_allow_rule(
                keepkeys_linux.RunRequest(
                    **{**request.__dict__, "cwd": PurePosixPath("/tmp/other")}
                ),
                stored,
            )
        )
        changed_metadata = keepkeys_linux.Metadata(
            **{**stored.__dict__, "description": "Changed credential metadata"}
        )
        self.assertFalse(keepkeys_linux.matching_allow_rule(request, changed_metadata))

    def test_stale_fingerprint_never_matches_a_persistent_allow_rule(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        approved = keepkeys_linux.RunRequest(
            name="demo",
            purpose="Run synthetic task",
            program=PurePosixPath("/usr/bin/example"),
            arguments=[],
            cwd=None,
            fingerprint="c" * 64,
            risk="DIRECT EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        stored = keepkeys_linux.metadata_with_allow_rule(
            metadata,
            keepkeys_linux.allow_rule_for(approved, metadata),
        )
        stale = keepkeys_linux.RunRequest(
            **{**approved.__dict__, "fingerprint": "d" * 64}
        )
        self.assertFalse(keepkeys_linux.matching_allow_rule(stale, stored))

    def test_matching_allow_rule_skips_ui_but_rechecks_before_execution(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        request = keepkeys_linux.RunRequest(
            name="demo",
            purpose="Run synthetic task",
            program=PurePosixPath("/usr/bin/example"),
            arguments=[],
            cwd=None,
            fingerprint="f" * 64,
            risk="DIRECT EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        metadata = keepkeys_linux.metadata_with_allow_rule(
            metadata,
            keepkeys_linux.allow_rule_for(request, metadata),
        )
        with (
            patch.object(keepkeys_linux, "make_run_request", return_value=request),
            patch.object(keepkeys_linux, "search_metadata", return_value=[metadata]) as search_metadata,
            patch.object(keepkeys_linux, "BrandedUI") as ui,
            patch.object(keepkeys_linux, "lookup_secret", return_value="synthetic-secret"),
            patch.object(keepkeys_linux, "execute", return_value={"status": "ok"}) as execute,
        ):
            result = keepkeys_linux.action_run(
                ["--name", "demo", "--purpose", "Run synthetic task", "--", "/usr/bin/example"]
            )
        self.assertEqual(result, {"status": "ok"})
        ui.assert_not_called()
        self.assertEqual(search_metadata.call_count, 3)
        execute.assert_called_once_with(request, metadata, "synthetic-secret")

    def test_rotation_reuses_metadata_and_requires_existing_record(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        request = keepkeys_linux.RunRequest(
            name="demo",
            purpose="Run synthetic task",
            program=PurePosixPath("/usr/bin/example"),
            arguments=[],
            cwd=None,
            fingerprint="9" * 64,
            risk="DIRECT EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        stored = keepkeys_linux.metadata_with_allow_rule(
            metadata,
            keepkeys_linux.allow_rule_for(request, metadata),
        )
        with (
            patch.object(keepkeys_linux, "search_metadata", return_value=[stored]),
            patch.object(
                keepkeys_linux,
                "BrandedUI",
            ) as ui,
            patch.object(
                keepkeys_linux,
                "store_record",
                return_value={"status": "ok", "name": "demo"},
            ) as store_record,
        ):
            ui.return_value.store.return_value = (metadata, "synthetic-rotation")
            result = keepkeys_linux.action_rotate(["--name", "demo"])
        self.assertEqual(result, {"status": "ok", "name": "demo"})
        store_record.assert_called_once_with(
            metadata,
            "synthetic-rotation",
            expected_existing=True,
        )
        self.assertEqual(ui.return_value.store.call_args.args[0].allow_rules, ())

    def test_revoke_clears_rules_only_after_confirmation_and_metadata_recheck(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        request = keepkeys_linux.RunRequest(
            name="demo",
            purpose="Run synthetic task",
            program=PurePosixPath("/usr/bin/example"),
            arguments=[],
            cwd=None,
            fingerprint="e" * 64,
            risk="DIRECT EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        stored = keepkeys_linux.metadata_with_allow_rule(
            metadata,
            keepkeys_linux.allow_rule_for(request, metadata),
        )
        with (
            patch.object(keepkeys_linux, "search_metadata", side_effect=[[stored], [stored]]),
            patch.object(keepkeys_linux, "BrandedUI") as ui,
            patch.object(keepkeys_linux, "store_metadata") as store_metadata,
        ):
            ui.return_value.confirm_revoke.return_value = True
            result = keepkeys_linux.action_revoke(["--name", "demo"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["revokedRules"], 1)
        cleared = store_metadata.call_args.args[0]
        self.assertEqual(cleared.allow_rules, ())

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

    def test_legacy_labels_reject_embedded_persistent_rules(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        request = keepkeys_linux.RunRequest(
            name="demo",
            purpose="Run synthetic task",
            program=PurePosixPath("/usr/bin/example"),
            arguments=[],
            cwd=None,
            fingerprint="1" * 64,
            risk="DIRECT EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        rule = keepkeys_linux.allow_rule_for(request, metadata)
        payload = {
            "name": metadata.name,
            "variable": metadata.variable,
            "description": metadata.description,
            "provider": metadata.provider,
            "documentationUrls": list(metadata.documentation_urls),
            "allowRules": [keepkeys_linux.allow_rule_payload(rule)],
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode()
        ).decode().rstrip("=")
        self.assertIsNone(
            keepkeys_linux.decode_label(keepkeys_linux.LABEL_PREFIX_V2 + encoded)
        )

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

    def test_search_metadata_propagates_secret_service_failure(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["secret-tool"],
            returncode=1,
            stdout=b"",
            stderr=b"synthetic unavailable",
        )
        with (
            patch.object(
                keepkeys_linux,
                "require_linux_runtime",
                return_value="/usr/bin/secret-tool",
            ),
            patch.object(
                keepkeys_linux.subprocess,
                "run",
                return_value=completed,
            ),
            self.assertRaisesRegex(
                keepkeys_linux.KeepKeysError,
                "Secret Service rejected",
            ),
        ):
            keepkeys_linux.search_metadata("demo")

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

    def test_metadata_subprocess_failure_rolls_back_the_new_value(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        timeout = subprocess.TimeoutExpired(
            cmd=["secret-tool", "store"],
            timeout=30,
        )
        with (
            patch.object(
                keepkeys_linux,
                "search_metadata",
                return_value=[],
            ),
            patch.object(keepkeys_linux, "store_value") as store_value,
            patch.object(
                keepkeys_linux,
                "store_metadata",
                side_effect=timeout,
            ),
            patch.object(
                keepkeys_linux,
                "clear_item",
                return_value=True,
            ) as clear_item,
            self.assertRaises(subprocess.TimeoutExpired),
        ):
            keepkeys_linux.store_record(metadata, "synthetic_secret")
        store_value.assert_called_once_with("demo", "synthetic_secret")
        self.assertEqual(
            clear_item.call_args_list,
            [
                call(keepkeys_linux.SECRET_SERVICE, "demo"),
                call(keepkeys_linux.METADATA_SERVICE, "demo"),
            ],
        )

    def test_rotation_replaces_metadata_without_persistent_allow_rules(self) -> None:
        previous = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        request = keepkeys_linux.RunRequest(
            name="demo",
            purpose="Run synthetic task",
            program=PurePosixPath("/usr/bin/example"),
            arguments=[],
            cwd=None,
            fingerprint="e" * 64,
            risk="DIRECT EXECUTABLE",
            entrypoint=None,
            entrypoint_fingerprint=None,
        )
        previous = keepkeys_linux.metadata_with_allow_rule(
            previous,
            keepkeys_linux.allow_rule_for(request, previous),
        )
        replacement = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Rotated synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        with (
            patch.object(keepkeys_linux, "search_metadata", return_value=[previous]),
            patch.object(keepkeys_linux, "lookup_secret", return_value="synthetic-old-secret"),
            patch.object(keepkeys_linux, "store_value"),
            patch.object(keepkeys_linux, "store_metadata") as store_metadata,
        ):
            keepkeys_linux.store_record(replacement, "synthetic-new-secret")
        self.assertEqual(store_metadata.call_args.args[0], replacement)
        self.assertEqual(store_metadata.call_args.args[0].allow_rules, ())

    def test_failed_rollback_deletion_is_reported(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        timeout = subprocess.TimeoutExpired(
            cmd=["secret-tool", "store"],
            timeout=30,
        )
        with (
            patch.object(
                keepkeys_linux,
                "search_metadata",
                return_value=[],
            ),
            patch.object(keepkeys_linux, "store_value"),
            patch.object(
                keepkeys_linux,
                "store_metadata",
                side_effect=timeout,
            ),
            patch.object(
                keepkeys_linux,
                "clear_item",
                side_effect=[False, True],
            ) as clear_item,
            self.assertRaisesRegex(
                keepkeys_linux.KeepKeysError,
                "failed during storage and rollback",
            ) as raised,
        ):
            keepkeys_linux.store_record(metadata, "synthetic_secret")
        self.assertIsInstance(
            raised.exception,
            keepkeys_linux.PortalStorageUncertainError,
        )
        self.assertEqual(
            clear_item.call_args_list,
            [
                call(keepkeys_linux.SECRET_SERVICE, "demo"),
                call(keepkeys_linux.METADATA_SERVICE, "demo"),
            ],
        )

    def test_existing_record_lookup_failure_prevents_phone_write(self) -> None:
        metadata = keepkeys_linux.Metadata(
            name="demo",
            variable="DEMO_TOKEN",
            description="Synthetic test credential",
            provider="Example",
            documentation_urls=("https://docs.example.com/api",),
        )
        with (
            patch.object(
                keepkeys_linux,
                "search_metadata",
                return_value=[metadata],
            ),
            patch.object(
                keepkeys_linux,
                "lookup_secret",
                side_effect=keepkeys_linux.KeepKeysError(
                    "Synthetic Secret Service lookup failure."
                ),
            ),
            patch.object(keepkeys_linux, "store_value") as store_value,
            patch.object(keepkeys_linux, "store_metadata") as store_metadata,
            self.assertRaisesRegex(
                keepkeys_linux.KeepKeysError,
                "lookup failure",
            ),
        ):
            keepkeys_linux.store_record(
                metadata,
                "synthetic_secret",
                expected_existing=True,
            )
        store_value.assert_not_called()
        store_metadata.assert_not_called()

    def test_native_portal_cleanup_requires_both_deletions(self) -> None:
        with (
            patch.object(
                keepkeys_linux,
                "clear_item",
                side_effect=[False, True],
            ) as clear_item,
            patch.object(
                keepkeys_linux,
                "search_metadata",
            ) as search_metadata,
            self.assertRaisesRegex(
                keepkeys_linux.KeepKeysError,
                "cleanup could not be confirmed",
            ),
        ):
            keepkeys_linux.clear_native_portal_test_record("demo")
        self.assertEqual(
            clear_item.call_args_list,
            [
                call(keepkeys_linux.METADATA_SERVICE, "demo"),
                call(keepkeys_linux.SECRET_SERVICE, "demo"),
            ],
        )
        search_metadata.assert_not_called()

    def test_portal_rollback_uncertainty_is_structured(self) -> None:
        output = StringIO()
        with (
            patch.dict(
                keepkeys_linux.os.environ,
                {"KEEPKEYS_SERIALIZED_MUTATION": "1"},
            ),
            patch.object(
                keepkeys_linux,
                "action_store",
                side_effect=keepkeys_linux.PortalStorageUncertainError(
                    "Synthetic rollback uncertainty."
                ),
            ),
            patch.object(keepkeys_linux.sys, "stdout", output),
            self.assertRaises(SystemExit),
        ):
            keepkeys_linux.main(["store"])
        self.assertEqual(
            json.loads(output.getvalue()),
            {
                "status": "error",
                "message": "Synthetic rollback uncertainty.",
                "storageState": "uncertain",
                "cleanupKind": "native-rollback",
            },
        )

    def test_remove_rejects_shared_coordinator_bypass(self) -> None:
        output = StringIO()
        with (
            patch.dict(keepkeys_linux.os.environ, {}, clear=True),
            patch.object(keepkeys_linux, "action_remove") as action_remove,
            patch.object(keepkeys_linux.sys, "stdout", output),
            self.assertRaises(SystemExit),
        ):
            keepkeys_linux.main(["remove", "--name", "demo"])
        action_remove.assert_not_called()
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["status"], "error")
        self.assertIn("shared per-name coordinator", payload["message"])

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
            env={**os.environ, "KEEPKEYS_SERIALIZED_MUTATION": "1"},
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

    def test_approval_ui_offers_exact_command_persistence(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('text="Allow once"', source)
        self.assertIn('text="Always allow this exact command"', source)
        self.assertIn('text="Cancel"', source)

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

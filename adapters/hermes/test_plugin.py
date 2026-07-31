"""Contract tests for the Hermes adapter."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from . import plugin


class _Context:
    def __init__(self) -> None:
        self.tools = []
        self.skills = []

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def register_skill(self, name, path):
        self.skills.append((name, path))


class HermesAdapterTests(unittest.TestCase):
    def test_registers_shared_tools_and_skill(self) -> None:
        ctx = _Context()
        plugin.register(ctx)
        self.assertEqual(
            [tool["name"] for tool in ctx.tools],
            [
                "keepkeys_store",
                "keepkeys_store_from_phone",
                "keepkeys_list",
                "keepkeys_rotate",
                "keepkeys_revoke",
                "keepkeys_remove",
                "keepkeys_run",
                "keepkeys_status",
                "keepkeys_doctor",
            ],
        )
        self.assertEqual(
            plugin._helper_arguments(
                "keepkeys_store_from_phone",
                {
                    "name": "github-release",
                    "variable": "GITHUB_TOKEN",
                    "description": "Publishes approved BarnLabs releases",
                    "provider": "GitHub",
                    "documentation_urls": ["https://docs.github.com/en/rest"],
                },
            ),
            [
                "portal-store",
                "--name",
                "github-release",
                "--variable",
                "GITHUB_TOKEN",
                "--description",
                "Publishes approved BarnLabs releases",
                "--provider",
                "GitHub",
                "--documentation-url",
                "https://docs.github.com/en/rest",
            ],
        )
        self.assertEqual(ctx.skills[0][0], "keepkeys")
        for tool in ctx.tools:
            properties = tool["schema"]["parameters"]["properties"]
            self.assertNotIn("secret", properties)
            self.assertNotIn("value", properties)

    def test_store_requires_metadata_and_never_accepts_value(self) -> None:
        self.assertEqual(
            plugin._helper_arguments(
                "keepkeys_store",
                {
                    "name": "github-release",
                    "variable": "GITHUB_TOKEN",
                    "description": "Publishes approved BarnLabs releases",
                    "provider": "GitHub",
                    "documentation_urls": [
                        "https://docs.github.com/en/rest",
                        "https://github.com/github/rest-api-description",
                    ],
                },
            ),
            [
                "store",
                "--name",
                "github-release",
                "--variable",
                "GITHUB_TOKEN",
                "--description",
                "Publishes approved BarnLabs releases",
                "--provider",
                "GitHub",
                "--documentation-url",
                "https://docs.github.com/en/rest",
                "--documentation-url",
                "https://github.com/github/rest-api-description",
            ],
        )

    def test_run_is_an_argument_vector_not_a_shell_string(self) -> None:
        self.assertEqual(
            plugin._helper_arguments(
                "keepkeys_run",
                {
                    "name": "demo",
                    "purpose": "Run the approved check",
                    "program": "/usr/bin/curl",
                    "arguments": ["--version"],
                    "cwd": "/tmp",
                },
            ),
            [
                "run",
                "--name",
                "demo",
                "--purpose",
                "Run the approved check",
                "--cwd",
                "/tmp",
                "--",
                "/usr/bin/curl",
                "--version",
            ],
        )

    def test_runtime_rejects_undeclared_fields_before_helper_dispatch(self) -> None:
        cases = [
            (
                "keepkeys_store",
                {
                    "name": "demo",
                    "variable": "DEMO_TOKEN",
                    "description": "Synthetic test metadata",
                    "provider": "Example",
                    "documentation_urls": ["https://docs.example.com/api"],
                    "secret": "synthetic-only-not-a-credential",
                },
            ),
            (
                "keepkeys_store",
                {
                    "name": "demo",
                    "variable": "DEMO_TOKEN",
                    "description": "Synthetic test metadata",
                    "provider": "Example",
                    "documentation_urls": ["https://docs.example.com/api"],
                    "value": "synthetic-only-not-a-credential",
                },
            ),
            (
                "keepkeys_run",
                {
                    "name": "demo",
                    "purpose": "Synthetic test",
                    "program": "/usr/bin/true",
                    "alias": {"nested": "unsupported"},
                },
            ),
            ("keepkeys_status", {"unexpected": True}),
        ]
        for tool_name, args in cases:
            with self.subTest(tool_name=tool_name, args=sorted(args)):
                with self.assertRaisesRegex(
                    ValueError,
                    r"^Tool arguments contain an unsupported field\.$",
                ):
                    plugin._helper_arguments(tool_name, args)

        with patch.object(plugin.subprocess, "Popen") as popen:
            result = plugin._handler_for("keepkeys_status")(
                {"secret": "synthetic-only-not-a-credential"}
            )
        popen.assert_not_called()
        self.assertEqual(
            json.loads(result),
            {"error": "Tool arguments contain an unsupported field."},
        )

    def test_store_rejects_insecure_documentation_links(self) -> None:
        with self.assertRaisesRegex(ValueError, "documentation_urls"):
            plugin._helper_arguments(
                "keepkeys_store",
                {
                    "name": "new-key",
                    "variable": "SECRET_KEY",
                    "description": "Credential for future approved agent commands",
                    "provider": "Example",
                    "documentation_urls": ["http://docs.example.com/api"],
                },
            )

    def test_store_enforces_native_provider_utf8_byte_boundary(self) -> None:
        base = {
            "name": "new-key",
            "variable": "SECRET_KEY",
            "description": "Credential for future approved agent commands",
            "documentation_urls": ["https://docs.example.com/api"],
        }
        plugin._helper_arguments(
            "keepkeys_store",
            {
                **base,
                "provider": "鍵" * 26,
            },
        )
        with self.assertRaisesRegex(ValueError, "at most 80 UTF-8 bytes"):
            plugin._helper_arguments(
                "keepkeys_store",
                {
                    **base,
                    "provider": "鍵" * 27,
                },
            )

    def test_store_rejects_non_string_documentation_links_structurally(self) -> None:
        for documentation_urls in ([{}], [[]]):
            with self.subTest(documentation_urls=documentation_urls):
                result = plugin._handler_for("keepkeys_store")(
                    {
                        "name": "new-key",
                        "variable": "SECRET_KEY",
                        "description": "Credential for future approved agent commands",
                        "provider": "Example",
                        "documentation_urls": documentation_urls,
                    }
                )
                self.assertEqual(
                    json.loads(result),
                    {
                        "error": (
                            "documentation_urls must contain one to three "
                            "distinct HTTPS URLs."
                        )
                    },
                )

    def test_handler_returns_json_without_helper_exception_details(self) -> None:
        with patch.object(
            plugin,
            "_run_helper",
            return_value={"status": "ok", "version": "0.6.0"},
        ):
            result = plugin._handler_for("keepkeys_status")({})
        self.assertEqual(
            json.loads(result),
            {"status": "ok", "version": "0.6.0"},
        )


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env node

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const MAX_HELPER_OUTPUT = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const activeProcessGroups = new Set();

const stringProperty = (description, maxLength = 4096) => ({
  type: "string",
  description,
  minLength: 1,
  maxLength,
});

export const TOOLS = [
  {
    name: "keepkeys_store",
    title: "Store a secret in KeepKeys",
    description:
      "Open the native KeepKeys window to collect a secret outside chat and store it in macOS Keychain. This tool never accepts or returns the secret value.",
    inputSchema: {
      type: "object",
      properties: {
        name: stringProperty("Suggested friendly name, such as github-release.", 128),
        variable: stringProperty(
          "Suggested uppercase environment-variable name, such as GITHUB_TOKEN.",
          128,
        ),
        description: stringProperty(
          "One-line description of what the secret is for, such as publishing approved releases.",
          240,
        ),
      },
      required: ["name", "variable", "description"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "keepkeys_list",
    title: "List KeepKeys names",
    description:
      "List friendly names, variable names, and descriptions stored by KeepKeys. Secret values are never returned.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "keepkeys_remove",
    title: "Remove a KeepKeys secret",
    description:
      "Open a native confirmation window and delete one named KeepKeys credential after user approval.",
    inputSchema: {
      type: "object",
      properties: {
        name: stringProperty("Exact friendly name to remove.", 128),
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "keepkeys_run",
    title: "Run an approved command with a KeepKeys secret",
    description:
      "Show a native confirmation for an exact direct executable, then inject the named secret into that one child process. The secret is never returned to Codex.",
    inputSchema: {
      type: "object",
      properties: {
        name: stringProperty("Friendly name of the stored secret.", 128),
        purpose: stringProperty("Plain-language reason the command needs the secret.", 240),
        program: stringProperty("Absolute path to a direct executable. Shell commands are rejected."),
        arguments: {
          type: "array",
          description: "Fixed argument list passed directly to the executable.",
          items: {
            type: "string",
            maxLength: 4096,
          },
          maxItems: 64,
          default: [],
        },
        cwd: {
          type: "string",
          description: "Optional absolute working-directory path.",
          minLength: 1,
          maxLength: 4096,
        },
      },
      required: ["name", "purpose", "program"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "keepkeys_status",
    title: "Check KeepKeys availability",
    description:
      "Check the local helper version and platform without reading or changing credentials.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "keepkeys_doctor",
    title: "Verify KeepKeys Keychain access",
    description:
      "Perform a temporary macOS Keychain write/read/delete round trip using a generated test value. No user credential is read.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
];

function assertObject(value) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object.");
  }
  return value;
}

function readOptionalString(args, key, maxLength) {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`${key} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function readRequiredString(args, key, maxLength) {
  const value = readOptionalString(args, key, maxLength);
  if (value === undefined) throw new Error(`${key} is required.`);
  return value;
}

export function helperArguments(toolName, rawArguments) {
  const args = assertObject(rawArguments);
  switch (toolName) {
    case "keepkeys_store": {
      return [
        "store",
        "--name",
        readRequiredString(args, "name", 128),
        "--variable",
        readRequiredString(args, "variable", 128),
        "--description",
        readRequiredString(args, "description", 240),
      ];
    }
    case "keepkeys_list":
      return ["list"];
    case "keepkeys_remove":
      return ["remove", "--name", readRequiredString(args, "name", 128)];
    case "keepkeys_status":
      return ["status"];
    case "keepkeys_doctor":
      return ["doctor"];
    case "keepkeys_run": {
      const name = readRequiredString(args, "name", 128);
      const purpose = readRequiredString(args, "purpose", 240);
      const program = readRequiredString(args, "program", 4096);
      const command = ["run", "--name", name, "--purpose", purpose];
      const cwd = readOptionalString(args, "cwd", 4096);
      if (cwd) command.push("--cwd", cwd);
      const argumentsValue = args.arguments ?? [];
      if (
        !Array.isArray(argumentsValue) ||
        argumentsValue.length > 64 ||
        argumentsValue.some(
          (value) => typeof value !== "string" || value.length > 4096,
        )
      ) {
        throw new Error("arguments must contain at most 64 strings of at most 4096 characters.");
      }
      command.push("--", program, ...argumentsValue);
      return command;
    }
    default:
      throw new Error(`Unknown KeepKeys tool: ${toolName}`);
  }
}

function runHelper(toolName, args) {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const launcher = resolve(pluginRoot, "scripts", "keepkeys");
  const helperArgs = helperArguments(toolName, args);
  const timeoutMs = Number.parseInt(
    process.env.KEEPKEYS_TIMEOUT_MS ?? `${DEFAULT_TIMEOUT_MS}`,
    10,
  );

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(launcher, helperArgs, {
      cwd: pluginRoot,
      env: {
        HOME: homedir(),
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        KEEPKEYS_CALLED_FROM_MCP: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
    if (child.pid) activeProcessGroups.add(child.pid);

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timer;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };

    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_HELPER_OUTPUT) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        throw new Error("KeepKeys helper output exceeded the 2 MiB safety limit.");
      }
      return next;
    };

    child.stdout.on("data", (chunk) => {
      try {
        stdout = append(stdout, chunk);
      } catch (error) {
        finish(rejectPromise, error);
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = append(stderr, chunk);
      } catch (error) {
        finish(rejectPromise, error);
      }
    });
    child.on("error", (error) => {
      if (child.pid) activeProcessGroups.delete(child.pid);
      finish(rejectPromise, error);
    });
    child.on("close", (code) => {
      if (child.pid) activeProcessGroups.delete(child.pid);
      const output = stdout.toString("utf8").trim();
      let parsed;
      try {
        parsed = output ? JSON.parse(output) : {};
      } catch {
        const diagnostic = stderr.toString("utf8").trim();
        finish(
          rejectPromise,
          new Error(
            `KeepKeys helper returned invalid output${diagnostic ? `: ${diagnostic}` : "."}`,
          ),
        );
        return;
      }
      if (code !== 0 || parsed.status === "error") {
        finish(
          rejectPromise,
          new Error(parsed.message ?? "KeepKeys helper failed without a diagnostic."),
        );
        return;
      }
      finish(resolvePromise, parsed);
    });

    timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish(
        rejectPromise,
        new Error(
          "KeepKeys timed out and terminated the local helper process group.",
        ),
      );
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
  });
}

export function createRequestHandler(helperRunner = runHelper) {
  return async function handleRequest(request) {
    const { id, method, params } = request;
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            typeof params?.protocolVersion === "string"
              ? params.protocolVersion
              : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "keepkeys", version: "0.1.0" },
          instructions:
            "KeepKeys stores values outside chat and never exposes plaintext secrets. Use keepkeys_run only for direct commands the user intends to approve.",
        },
      };
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }
    if (method === "tools/call") {
      const name = params?.name;
      if (typeof name !== "string") {
        throw Object.assign(new Error("Tool name is required."), { code: -32602 });
      }
      const result = await helperRunner(name, params?.arguments ?? {});
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        },
      };
    }
    throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  };
}

async function main() {
  const handleRequest = createRequestHandler();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const terminateActiveGroups = () => {
    for (const pid of activeProcessGroups) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // The process group already exited.
      }
    }
  };
  process.once("SIGINT", () => {
    terminateActiveGroups();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    terminateActiveGroups();
    process.exit(143);
  });

  for await (const line of input) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        })}\n`,
      );
      continue;
    }
    if (request.id === undefined) continue;
    try {
      const response = await handleRequest(request);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: {
            code: Number.isInteger(error?.code) ? error.code : -32000,
            message: error instanceof Error ? error.message : "KeepKeys request failed.",
          },
        })}\n`,
      );
    }
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    process.stderr.write(`KeepKeys MCP server failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

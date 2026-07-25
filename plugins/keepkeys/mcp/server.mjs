#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { helperInvocation, terminateProcessTree } from "../scripts/platform.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const MAX_HELPER_OUTPUT = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const activeProcessGroups = new Set();

export const TOOLS = Object.freeze(
  JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8")),
);

function assertObject(value) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object.");
  }
  return value;
}

function assertExactKeys(toolName, args) {
  const tool = TOOLS.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Unknown KeepKeys tool: ${toolName}`);
  const allowed = new Set(Object.keys(tool.inputSchema.properties));
  if (Object.keys(args).some((key) => !allowed.has(key))) {
    throw new Error("Tool arguments contain an unsupported field.");
  }
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

function readDocumentationUrls(args) {
  const values = args.documentation_urls;
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > 3 ||
    new Set(values).size !== values.length ||
    values.some(
      (value) => {
        if (
          typeof value !== "string" ||
          Buffer.byteLength(value, "utf8") > 1024
        ) {
          return true;
        }
        try {
          const parsed = new URL(value);
          return (
            parsed.protocol !== "https:" ||
            !parsed.hostname ||
            Boolean(parsed.username) ||
            Boolean(parsed.password)
          );
        } catch {
          return true;
        }
      },
    ) ||
    values.reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0) >
      1800
  ) {
    throw new Error(
      "documentation_urls must contain one to three HTTPS URLs totaling at most 1800 characters.",
    );
  }
  return values;
}

export function helperArguments(toolName, rawArguments) {
  const args = assertObject(rawArguments);
  assertExactKeys(toolName, args);
  switch (toolName) {
    case "keepkeys_store": {
      const command = [
        "store",
        "--name",
        readRequiredString(args, "name", 128),
        "--variable",
        readRequiredString(args, "variable", 128),
        "--description",
        readRequiredString(args, "description", 240),
        "--provider",
        readRequiredString(args, "provider", 80),
      ];
      for (const url of readDocumentationUrls(args)) {
        command.push("--documentation-url", url);
      }
      return command;
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
  const helperArgs = helperArguments(toolName, args);
  const invocation = helperInvocation(helperArgs);
  const timeoutMs = Number.parseInt(
    process.env.KEEPKEYS_TIMEOUT_MS ?? `${DEFAULT_TIMEOUT_MS}`,
    10,
  );

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.env.KEEPKEYS_PLUGIN_ROOT,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
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
        terminateProcessTree(child);
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
      terminateProcessTree(child);
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
          serverInfo: { name: "keepkeys", version: "0.4.2" },
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
      const argumentsValue = assertObject(params?.arguments);
      assertExactKeys(name, argumentsValue);
      const result = await helperRunner(name, argumentsValue);
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
      terminateProcessTree({ pid, kill() {} });
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

let isMainModule = false;
if (process.argv[1]) {
  try {
    isMainModule =
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isMainModule = false;
  }
}

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`KeepKeys MCP server failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

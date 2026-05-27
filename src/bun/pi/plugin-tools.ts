/**
 * @file src/bun/pi/plugin-tools.ts
 * @description Pi-native tool wrappers for Plugin System v1 agent tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { pluginFsRead } from "../plugin/fs-read";
import type {
  PluginAgentToolContext,
  PluginAgentToolRegistrationForThread,
  PluginSidecarProcessManager,
} from "../plugin/sidecar-manager";

const PluginToolParameters = Type.Object(
  {},
  {
    additionalProperties: true,
    description:
      "Plugin-defined tool arguments. The plugin validates this shape before action execution.",
  },
);

export const PLUGIN_TOOL_MAX_TEXT_RESULT_BYTES = 256 * 1024;

const TEXT_ENCODER = new TextEncoder();

export type PluginToolResultKind =
  | "image:file"
  | "image:url"
  | "json"
  | "markdown"
  | "text";

export class PluginToolResultError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PluginToolResultError";
    this.code = code;
  }
}

type PluginToolContentBlock =
  | { text: string; type: "text" }
  | { data: string; mimeType: string; type: "image" };

type ConvertedPluginToolResult = {
  content: PluginToolContentBlock[];
  kind: PluginToolResultKind;
};

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pluginToolResultText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "null";
  }
  return JSON.stringify(value, null, 2) ?? String(value);
}

function assertTextResultWithinLimit(text: string, kind: string): void {
  if (byteLength(text) <= PLUGIN_TOOL_MAX_TEXT_RESULT_BYTES) {
    return;
  }
  throw new PluginToolResultError(
    "plugin_tool_result_too_large",
    `Plugin tool ${kind} result exceeds the 256 KB limit.`,
  );
}

function requireStringField(
  value: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const field = value[key];
  if (
    typeof field === "string" &&
    (options.allowEmpty === true || field.length > 0)
  ) {
    return field;
  }
  throw new PluginToolResultError(
    "invalid_plugin_tool_result",
    `Plugin tool result requires a${options.allowEmpty === true ? "" : " non-empty"} ${key} string.`,
  );
}

function imageMimeType(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("image/")) {
    throw new PluginToolResultError(
      "invalid_plugin_tool_result",
      "Plugin image file results require an image/* mimeType.",
    );
  }
  return value;
}

function imageUrlText(value: Record<string, unknown>): string {
  const url = requireStringField(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_error) {
    throw new PluginToolResultError(
      "invalid_plugin_tool_result",
      "Plugin image URL results require a valid URL.",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PluginToolResultError(
      "invalid_plugin_tool_result",
      "Plugin image URL results require http or https URLs.",
    );
  }
  const alt = typeof value.alt === "string" && value.alt ? value.alt : null;
  return alt ? `Plugin image URL (${alt}): ${url}` : `Plugin image URL: ${url}`;
}

async function imageFileContent(input: {
  context: PluginAgentToolContext;
  result: Record<string, unknown>;
  registration: PluginAgentToolRegistrationForThread;
}): Promise<PluginToolContentBlock[]> {
  const virtualPath = requireStringField(input.result, "path");
  const mimeType = imageMimeType(input.result.mimeType);
  let data: Uint8Array;
  try {
    data = await pluginFsRead(
      {
        contextKind: input.context.contextKind,
        filesReadAllowlist: input.registration.filesReadAllowlist,
        filesReadDenylist: input.registration.filesReadDenylist,
        permissions: input.registration.permissions,
        pluginPath: input.registration.pluginPath,
        projectRootPath: input.context.worktreePath,
      },
      virtualPath,
    );
  } catch (_error) {
    throw new PluginToolResultError(
      "plugin_image_file_unavailable",
      "Plugin image file result could not be read with declared permissions.",
    );
  }
  const alt =
    typeof input.result.alt === "string" && input.result.alt
      ? input.result.alt
      : null;
  return [
    {
      text: alt
        ? `Plugin image file (${alt}): ${virtualPath}`
        : `Plugin image file: ${virtualPath}`,
      type: "text",
    },
    {
      data: Buffer.from(data).toString("base64"),
      mimeType,
      type: "image",
    },
  ];
}

async function convertPluginToolResult(input: {
  context: PluginAgentToolContext;
  registration: PluginAgentToolRegistrationForThread;
  result: unknown;
}): Promise<ConvertedPluginToolResult> {
  const result = input.result;
  if (isRecord(result) && typeof result.type === "string") {
    switch (result.type) {
      case "text": {
        const text = requireStringField(result, "text", { allowEmpty: true });
        assertTextResultWithinLimit(text, "text");
        return { content: [{ text, type: "text" }], kind: "text" };
      }
      case "markdown": {
        const text = requireStringField(result, "markdown", {
          allowEmpty: true,
        });
        assertTextResultWithinLimit(text, "markdown");
        return { content: [{ text, type: "text" }], kind: "markdown" };
      }
      case "image:url":
        return {
          content: [{ text: imageUrlText(result), type: "text" }],
          kind: "image:url",
        };
      case "image:file":
        return {
          content: await imageFileContent({
            context: input.context,
            registration: input.registration,
            result,
          }),
          kind: "image:file",
        };
      default:
        throw new PluginToolResultError(
          "unsupported_plugin_tool_result",
          "Plugin tool result type is unsupported.",
        );
    }
  }

  const text = pluginToolResultText(result);
  assertTextResultWithinLimit(text, "text");
  return {
    content: [{ text, type: "text" }],
    kind: typeof result === "string" ? "text" : "json",
  };
}

function pluginPermissionIdsToAccessGroupKeys(
  permissionIds: readonly string[],
): string[] {
  const accessGroupKeys: string[] = [];
  for (const permissionId of permissionIds) {
    if (permissionId.startsWith("metidos:")) {
      continue;
    }
    const separatorIndex = permissionId.indexOf(":");
    if (
      separatorIndex <= 0 ||
      separatorIndex !== permissionId.lastIndexOf(":")
    ) {
      continue;
    }
    const providerId = permissionId.slice(0, separatorIndex);
    const accessId = permissionId.slice(separatorIndex + 1);
    if (!providerId || !accessId) {
      continue;
    }
    accessGroupKeys.push(`${providerId}/${accessId}`);
  }
  return accessGroupKeys;
}

export function createPiPluginTools(input: {
  context: PluginAgentToolContext;
  enabledPermissions: readonly string[];
  manager: PluginSidecarProcessManager;
}): ToolDefinition[] {
  return input.manager
    .listAgentToolRegistrationsForThread(
      pluginPermissionIdsToAccessGroupKeys(input.enabledPermissions),
    )
    .map((registration) => createPiPluginTool(input, registration));
}

function pluginToolFailureMessage(input: {
  error: unknown;
  runtimeId: string;
}): string {
  const record = isRecord(input.error) ? input.error : null;
  const code =
    record && typeof record.code === "string" && record.code.length > 0
      ? record.code
      : null;
  const diagnosticMessage =
    record &&
    typeof record.diagnosticMessage === "string" &&
    record.diagnosticMessage.length > 0
      ? record.diagnosticMessage
      : input.error instanceof Error
        ? input.error.message
        : String(input.error);
  return code
    ? `Plugin tool ${input.runtimeId} failed (${code}): ${diagnosticMessage}`
    : `Plugin tool ${input.runtimeId} failed: ${diagnosticMessage}`;
}

function createPiPluginTool(
  input: {
    context: PluginAgentToolContext;
    manager: PluginSidecarProcessManager;
  },
  registration: PluginAgentToolRegistrationForThread,
): ToolDefinition {
  const { registration: tool } = registration;
  return defineTool<typeof PluginToolParameters, unknown>({
    description: tool.description,
    execute: async (_toolCallId, params, signal) => {
      let result: unknown;
      try {
        result = await input.manager.invokeAgentTool({
          context: input.context,
          params,
          registration,
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        throw new Error(
          pluginToolFailureMessage({ error, runtimeId: tool.runtimeId }),
          error === undefined ? undefined : { cause: error },
        );
      }
      const converted = await convertPluginToolResult({
        context: input.context,
        registration,
        result,
      });
      return {
        content: converted.content,
        details: {
          pluginId: registration.pluginId,
          result,
          resultKind: converted.kind,
          runtimeId: tool.runtimeId,
          tool: tool.tool,
        },
      };
    },
    label: tool.name,
    name: tool.runtimeId,
    parameters: PluginToolParameters,
    promptSnippet: `Plugin tool: ${tool.name}`,
  }) as unknown as ToolDefinition;
}

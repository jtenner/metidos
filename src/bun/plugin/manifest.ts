/**
 * @file src/bun/plugin/manifest.ts
 * @description Typed parsing and core validation for Metidos plugin manifests.
 */

import type { RpcPluginInventoryIssue } from "../rpc-schema/plugin";
import {
  isReservedPluginDisplayName,
  isReservedPluginId,
  PLUGIN_ID_PATTERN,
  PLUGIN_IDENTIFIER_PATTERN,
  PLUGIN_TOOL_ID_PATTERN,
} from "./identity";
import { compilePluginNetworkAllowlist } from "./network-allowlist";

export const METIDOS_PLUGIN_MANIFEST_FILE_NAME = "metidos-plugin.json";
export const METIDOS_PLUGIN_API_VERSION = "v1";

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TOOL_NAME_MAX_LENGTH = 64;
const ACCESS_GROUP_LIMIT = 25;
const DISTINCT_TOOL_LIMIT = 30;
const DISTINCT_INJECTION_LIMIT = 25;
const TIMEOUT_MS_MINIMUM = 1000;
const TIMEOUT_MS_MAXIMUM = 600000;
const PROVIDER_LIMIT = 10;
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const DATE_DEFAULT_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SETTING_KINDS = [
  "string",
  "number",
  "boolean",
  "enum",
  "secret",
  "url",
  "date",
  "list",
] as const;
const SETTING_KIND_SET = new Set<string>(SETTING_KINDS);
const LIST_SETTING_ITEM_KINDS = ["string", "number", "url", "email"] as const;
const LIST_SETTING_ITEM_KIND_SET = new Set<string>(LIST_SETTING_ITEM_KINDS);
const EMAIL_SETTING_ITEM_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PLUGIN_MANIFEST_PERMISSIONS = [
  "storage:read",
  "storage:write",
  "storage:delete",
  "files:read",
  "files:write",
  "files:delete",
  "network:fetch",
  "network:websocket",
  "cron:create",
  "metidos:can_embed",
  "metidos:lancedb",
  "metidos:prompt_inject",
  "metidos:provides_embeddings",
  "plugin:request-ingress",
  "plugin:reply-to-source",
  "notification:send",
  "notification:provider",
  "oauth:register",
  "provider:register",
  "calendar:list",
  "calendar:create",
  "calendar:modify",
  "calendar:delete",
  "events:list",
  "events:get",
  "events:create",
  "events:modify",
  "events:delete",
  "terminal:create",
  "terminal:read",
  "terminal:grep",
  "terminal:kill",
  "sqlite",
  "log:write",
  "unsafe",
] as const;

const PLUGIN_MANIFEST_PERMISSION_SET = new Set<string>(
  PLUGIN_MANIFEST_PERMISSIONS,
);

export type PluginManifestFileAccess = {
  delete: unknown[];
  read: unknown[];
  write: unknown[];
};

export type PluginManifestFiles = {
  allow: PluginManifestFileAccess;
  deny: PluginManifestFileAccess;
};

export type PluginManifestSettingKind = (typeof SETTING_KINDS)[number];
export type PluginManifestListSettingItemKind =
  (typeof LIST_SETTING_ITEM_KINDS)[number];

export type PluginManifestSettingDefault =
  | boolean
  | number
  | string
  | Array<number | string>
  | null;

export type PluginManifestListSettingItems = {
  kind: PluginManifestListSettingItemKind;
};

export type PluginManifestSettingDeclaration = {
  defaultValue: PluginManifestSettingDefault;
  description: string | null;
  hasDefault: boolean;
  items: PluginManifestListSettingItems | null;
  key: string | null;
  kind: PluginManifestSettingKind | null;
  label: string | null;
  options: string[];
  required: boolean;
};

export type PluginManifestSettings = PluginManifestSettingDeclaration[];

export type PluginManifestPiAuthBinding = {
  kind: "api_key" | "codex_auth" | "pi_oauth_file" | null;
  provider: string | null;
  source: "env" | "setting" | null;
  value: string | null;
};

export type PluginManifestIngressSourceDeclaration = {
  id: string | null;
  name: string | null;
  description: string | null;
  pollIntervalMs: number | null;
  timeoutMs: number | null;
  supportsReplyToSource: boolean;
};

export type PluginManifestV1 = {
  access: unknown[];
  color: string | null;
  description: string | null;
  env: unknown[];
  files: PluginManifestFiles;
  gc: Record<string, unknown> | null;
  id: string | null;
  ingressSources: PluginManifestIngressSourceDeclaration[];
  limits: Record<string, unknown>;
  main: string | null;
  metidosApiVersion: string | null;
  name: string | null;
  network: Record<string, unknown> | null;
  notificationProviders: unknown[];
  oauthProviders: unknown[];
  permissions: unknown[];
  piAuth: PluginManifestPiAuthBinding[];
  providers: unknown[];
  raw: Record<string, unknown>;
  settings: PluginManifestSettings;
  storage: Record<string, unknown>;
  telemetry: boolean | null;
  version: string | null;
};

export type PluginManifestParseResult = {
  issues: RpcPluginInventoryIssue[];
  manifest: PluginManifestV1 | null;
};

type StringFieldRule = {
  constValue?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(input: {
  code: string;
  field?: string;
  manifestPath: string;
  message: string;
}): RpcPluginInventoryIssue {
  return {
    code: input.code,
    fileName: METIDOS_PLUGIN_MANIFEST_FILE_NAME,
    message: input.field ? `${input.field}: ${input.message}` : input.message,
    path: input.field
      ? `${input.manifestPath}#/${input.field}`
      : input.manifestPath,
  };
}

function stringField(
  manifest: Record<string, unknown>,
  field: string,
  rule: StringFieldRule,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): string | null {
  if (!Object.hasOwn(manifest, field)) {
    issues.push(
      issue({
        code: "missing_required_manifest_field",
        field,
        manifestPath,
        message: "Required manifest field is missing.",
      }),
    );
    return null;
  }

  const value = manifest[field];
  if (typeof value !== "string") {
    issues.push(
      issue({
        code: "invalid_manifest_field_type",
        field,
        manifestPath,
        message: "Expected a string value.",
      }),
    );
    return null;
  }

  if (rule.minLength !== undefined && value.trim().length < rule.minLength) {
    issues.push(
      issue({
        code: "invalid_manifest_field_value",
        field,
        manifestPath,
        message: `Expected a non-empty string with at least ${rule.minLength} character${rule.minLength === 1 ? "" : "s"}.`,
      }),
    );
    return null;
  }

  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    issues.push(
      issue({
        code: "invalid_manifest_field_value",
        field,
        manifestPath,
        message: `Expected at most ${rule.maxLength} characters.`,
      }),
    );
    return null;
  }

  if (rule.constValue !== undefined && value !== rule.constValue) {
    issues.push(
      issue({
        code: "invalid_manifest_field_value",
        field,
        manifestPath,
        message: `Expected exactly ${JSON.stringify(rule.constValue)}.`,
      }),
    );
    return null;
  }

  if (rule.pattern && !rule.pattern.test(value)) {
    issues.push(
      issue({
        code: "invalid_manifest_field_value",
        field,
        manifestPath,
        message: "Value does not match the v1 manifest schema rule.",
      }),
    );
    return null;
  }

  return value;
}

function hasOwn(record: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(record, field);
}

function pushManifestIssue(
  issues: RpcPluginInventoryIssue[],
  input: {
    code: string;
    field: string;
    manifestPath: string;
    message: string;
  },
): void {
  issues.push(issue(input));
}

function permissionsValue(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): unknown[] {
  if (!hasOwn(manifest, "permissions")) {
    return [];
  }
  if (!Array.isArray(manifest.permissions)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "permissions",
      manifestPath,
      message: "Expected an array of v1 permission strings.",
    });
    return [];
  }

  const seenPermissions = new Set<string>();
  for (const [index, permission] of manifest.permissions.entries()) {
    const field = `permissions/${index}`;
    if (typeof permission !== "string") {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field,
        manifestPath,
        message: "Expected a v1 permission string.",
      });
      continue;
    }
    if (!PLUGIN_MANIFEST_PERMISSION_SET.has(permission)) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_permission",
        field,
        manifestPath,
        message: `Unknown v1 permission ${JSON.stringify(permission)}.`,
      });
    }
    if (seenPermissions.has(permission)) {
      pushManifestIssue(issues, {
        code: "duplicate_manifest_permission",
        field,
        manifestPath,
        message: `Permission ${JSON.stringify(permission)} must be declared at most once.`,
      });
    }
    seenPermissions.add(permission);
  }

  if (seenPermissions.has("sqlite") && !seenPermissions.has("storage:write")) {
    pushManifestIssue(issues, {
      code: "missing_required_permission",
      field: "permissions",
      manifestPath,
      message: "`sqlite` requires `storage:write`.",
    });
  }
  for (const terminalPermission of ["terminal:create", "terminal:kill"]) {
    if (
      seenPermissions.has(terminalPermission) &&
      !seenPermissions.has("unsafe")
    ) {
      pushManifestIssue(issues, {
        code: "missing_required_permission",
        field: "permissions",
        manifestPath,
        message: `\`${terminalPermission}\` requires \`unsafe\`.`,
      });
    }
  }

  return manifest.permissions;
}

function validateOptionalString(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  maxLength: number;
  path: string;
  value: unknown;
}): void {
  if (input.value === undefined) {
    return;
  }
  if (typeof input.value !== "string") {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Expected a string value.",
    });
    return;
  }
  if (input.value.length > input.maxLength) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_value",
      field: input.path,
      manifestPath: input.manifestPath,
      message: `Expected at most ${input.maxLength} characters.`,
    });
  }
}

function validateRequiredString(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  maxLength: number;
  minLength: number;
  path: string;
  pattern?: RegExp;
  value: unknown;
}): boolean {
  if (input.value === undefined) {
    pushManifestIssue(input.issues, {
      code: "missing_required_manifest_field",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Required manifest field is missing.",
    });
    return false;
  }
  if (typeof input.value !== "string") {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Expected a string value.",
    });
    return false;
  }
  if (input.value.trim().length < input.minLength) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_value",
      field: input.path,
      manifestPath: input.manifestPath,
      message: `Expected a non-empty string with at least ${input.minLength} character${input.minLength === 1 ? "" : "s"}.`,
    });
    return false;
  }
  if (input.value.length > input.maxLength) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_value",
      field: input.path,
      manifestPath: input.manifestPath,
      message: `Expected at most ${input.maxLength} characters.`,
    });
    return false;
  }
  if (input.pattern && !input.pattern.test(input.value)) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_value",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Value does not match the v1 manifest schema rule.",
    });
    return false;
  }
  return true;
}

function accessValue(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): unknown[] {
  if (!hasOwn(manifest, "access")) {
    return [];
  }
  if (!Array.isArray(manifest.access)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "access",
      manifestPath,
      message: "Expected an array of access groups.",
    });
    return [];
  }
  if (manifest.access.length > ACCESS_GROUP_LIMIT) {
    pushManifestIssue(issues, {
      code: "too_many_access_groups",
      field: "access",
      manifestPath,
      message: `Expected at most ${ACCESS_GROUP_LIMIT} access groups.`,
    });
  }

  const distinctToolNames = new Set<string>();
  const distinctInjectionNames = new Set<string>();
  for (const [groupIndex, group] of manifest.access.entries()) {
    const groupPath = `access/${groupIndex}`;
    if (!isRecord(group)) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field: groupPath,
        manifestPath,
        message: "Expected an access group object.",
      });
      continue;
    }

    validateRequiredString({
      issues,
      manifestPath,
      maxLength: 64,
      minLength: 1,
      path: `${groupPath}/id`,
      pattern: PLUGIN_IDENTIFIER_PATTERN,
      value: group.id,
    });
    validateRequiredString({
      issues,
      manifestPath,
      maxLength: 120,
      minLength: 1,
      path: `${groupPath}/name`,
      value: group.name,
    });
    validateOptionalString({
      issues,
      manifestPath,
      maxLength: 1000,
      path: `${groupPath}/description`,
      value: group.description,
    });

    const tools = hasOwn(group, "tools") ? group.tools : [];
    if (!Array.isArray(tools)) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field: `${groupPath}/tools`,
        manifestPath,
        message: "Expected an array of tool declarations.",
      });
      continue;
    }
    if (tools.length > DISTINCT_TOOL_LIMIT) {
      pushManifestIssue(issues, {
        code: "too_many_access_group_tools",
        field: `${groupPath}/tools`,
        manifestPath,
        message: `Expected at most ${DISTINCT_TOOL_LIMIT} tool declarations in one access group.`,
      });
    }

    for (const [toolIndex, tool] of tools.entries()) {
      const toolPath = `${groupPath}/tools/${toolIndex}`;
      if (!isRecord(tool)) {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_type",
          field: toolPath,
          manifestPath,
          message: "Expected a tool declaration object.",
        });
        continue;
      }

      if (
        validateRequiredString({
          issues,
          manifestPath,
          maxLength: TOOL_NAME_MAX_LENGTH,
          minLength: 1,
          path: `${toolPath}/name`,
          pattern: PLUGIN_TOOL_ID_PATTERN,
          value: tool.name,
        }) &&
        typeof tool.name === "string"
      ) {
        distinctToolNames.add(tool.name);
      }
      validateRequiredString({
        issues,
        manifestPath,
        maxLength: 1000,
        minLength: 1,
        path: `${toolPath}/description`,
        value: tool.description,
      });

      if (!hasOwn(tool, "timeoutMs")) {
        pushManifestIssue(issues, {
          code: "missing_required_manifest_field",
          field: `${toolPath}/timeoutMs`,
          manifestPath,
          message: "Required manifest field is missing.",
        });
      } else if (
        typeof tool.timeoutMs !== "number" ||
        !Number.isInteger(tool.timeoutMs)
      ) {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_type",
          field: `${toolPath}/timeoutMs`,
          manifestPath,
          message: "Expected an integer timeout in milliseconds.",
        });
      } else if (
        tool.timeoutMs < TIMEOUT_MS_MINIMUM ||
        tool.timeoutMs > TIMEOUT_MS_MAXIMUM
      ) {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_value",
          field: `${toolPath}/timeoutMs`,
          manifestPath,
          message: `Expected a timeout between ${TIMEOUT_MS_MINIMUM} and ${TIMEOUT_MS_MAXIMUM} milliseconds.`,
        });
      }
    }

    const injects = hasOwn(group, "injects") ? group.injects : [];
    if (!Array.isArray(injects)) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field: `${groupPath}/injects`,
        manifestPath,
        message: "Expected an array of injection declarations.",
      });
      continue;
    }
    if (injects.length > DISTINCT_INJECTION_LIMIT) {
      pushManifestIssue(issues, {
        code: "too_many_access_group_injects",
        field: `${groupPath}/injects`,
        manifestPath,
        message: `Expected at most ${DISTINCT_INJECTION_LIMIT} injection declarations in one access group.`,
      });
    }

    for (const [injectIndex, inject] of injects.entries()) {
      const injectPath = `${groupPath}/injects/${injectIndex}`;
      if (!isRecord(inject)) {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_type",
          field: injectPath,
          manifestPath,
          message: "Expected an injection declaration object.",
        });
        continue;
      }

      if (
        validateRequiredString({
          issues,
          manifestPath,
          maxLength: TOOL_NAME_MAX_LENGTH,
          minLength: 1,
          path: `${injectPath}/name`,
          pattern: PLUGIN_TOOL_ID_PATTERN,
          value: inject.name,
        }) &&
        typeof inject.name === "string"
      ) {
        distinctInjectionNames.add(inject.name);
      }
      validateRequiredString({
        issues,
        manifestPath,
        maxLength: 1000,
        minLength: 1,
        path: `${injectPath}/description`,
        value: inject.description,
      });

      if (!hasOwn(inject, "timeoutMs")) {
        pushManifestIssue(issues, {
          code: "missing_required_manifest_field",
          field: `${injectPath}/timeoutMs`,
          manifestPath,
          message: "Required manifest field is missing.",
        });
      } else if (
        typeof inject.timeoutMs !== "number" ||
        !Number.isInteger(inject.timeoutMs)
      ) {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_type",
          field: `${injectPath}/timeoutMs`,
          manifestPath,
          message: "Expected an integer timeout in milliseconds.",
        });
      } else if (
        inject.timeoutMs < TIMEOUT_MS_MINIMUM ||
        inject.timeoutMs > TIMEOUT_MS_MAXIMUM
      ) {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_value",
          field: `${injectPath}/timeoutMs`,
          manifestPath,
          message: `Expected a timeout between ${TIMEOUT_MS_MINIMUM} and ${TIMEOUT_MS_MAXIMUM} milliseconds.`,
        });
      }
    }
  }

  if (distinctToolNames.size > DISTINCT_TOOL_LIMIT) {
    pushManifestIssue(issues, {
      code: "too_many_distinct_access_tools",
      field: "access",
      manifestPath,
      message: `Expected at most ${DISTINCT_TOOL_LIMIT} distinct tool names across all access groups.`,
    });
  }

  if (distinctInjectionNames.size > DISTINCT_INJECTION_LIMIT) {
    pushManifestIssue(issues, {
      code: "too_many_distinct_access_injects",
      field: "access",
      manifestPath,
      message: `Expected at most ${DISTINCT_INJECTION_LIMIT} distinct injection names across all access groups.`,
    });
  }

  return manifest.access;
}

type ProjectFileAccessKind = keyof PluginManifestFileAccess;

type ProjectFilePolicyKind = keyof PluginManifestFiles;

const PROJECT_FILE_ACCESS_KINDS = ["read", "write", "delete"] as const;

const BUILTIN_PROJECT_FILE_DENY_PATTERNS = [
  "./.git",
  "./.git/**",
  "./**/.git",
  "./**/.git/**",
  "./.ssh",
  "./.ssh/**",
  "./**/.ssh",
  "./**/.ssh/**",
] as const;

function emptyFileAccess(): PluginManifestFileAccess {
  return { delete: [], read: [], write: [] };
}

function projectPatternArrayValue(
  files: Record<string, unknown>,
  policyName: ProjectFilePolicyKind,
  fieldName: ProjectFileAccessKind,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): unknown[] {
  if (!hasOwn(files, fieldName)) {
    return [];
  }
  const value = files[fieldName];
  const fieldPath = `files/${policyName}/${fieldName}`;
  if (!Array.isArray(value)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: fieldPath,
      manifestPath,
      message: "Expected an array of project file patterns.",
    });
    return [];
  }

  const seenPatterns = new Set<string>();
  for (const [index, pattern] of value.entries()) {
    const patternPath = `${fieldPath}/${index}`;
    if (typeof pattern !== "string") {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field: patternPath,
        manifestPath,
        message: "Expected a project file pattern string.",
      });
      continue;
    }
    if (seenPatterns.has(pattern)) {
      pushManifestIssue(issues, {
        code: "duplicate_project_file_pattern",
        field: patternPath,
        manifestPath,
        message: `Project file pattern ${JSON.stringify(pattern)} must be declared at most once per files.${policyName}.${fieldName} list.`,
      });
    }
    seenPatterns.add(pattern);

    if (pattern.startsWith("~/")) {
      pushManifestIssue(issues, {
        code: "invalid_project_file_pattern",
        field: patternPath,
        manifestPath,
        message:
          "Project file patterns must start with `./`; `~/` paths are governed by plugin storage permissions and quotas.",
      });
      continue;
    }
    if (!pattern.startsWith("./")) {
      pushManifestIssue(issues, {
        code: "invalid_project_file_pattern",
        field: patternPath,
        manifestPath,
        message: "Project file patterns must start with `./`.",
      });
    }
  }

  return value;
}

function fileAccessValue(
  files: Record<string, unknown>,
  policyName: ProjectFilePolicyKind,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): PluginManifestFileAccess {
  const value = files[policyName];
  if (value === undefined) {
    return emptyFileAccess();
  }
  if (!isRecord(value)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: `files/${policyName}`,
      manifestPath,
      message: "Expected a project file access declaration object.",
    });
    return emptyFileAccess();
  }
  return {
    delete: projectPatternArrayValue(
      value,
      policyName,
      "delete",
      manifestPath,
      issues,
    ),
    read: projectPatternArrayValue(
      value,
      policyName,
      "read",
      manifestPath,
      issues,
    ),
    write: projectPatternArrayValue(
      value,
      policyName,
      "write",
      manifestPath,
      issues,
    ),
  };
}

function optionalIntegerValue(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  maximum: number;
  minimum: number;
  path: string;
  value: unknown;
}): number | null {
  if (input.value === undefined) return null;
  validateIntegerBounds(input);
  return typeof input.value === "number" && Number.isInteger(input.value)
    ? input.value
    : null;
}

function ingressSourcesValue(
  manifest: Record<string, unknown>,
  permissions: unknown[],
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): PluginManifestIngressSourceDeclaration[] {
  if (!hasOwn(manifest, "ingressSources")) return [];
  if (!Array.isArray(manifest.ingressSources)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "ingressSources",
      manifestPath,
      message: "Expected an array of ingress source declarations.",
    });
    return [];
  }
  const permissionSet = permissionSetValue(permissions);
  if (!permissionSet.has("plugin:request-ingress")) {
    pushManifestIssue(issues, {
      code: "missing_required_permission",
      field: "ingressSources",
      manifestPath,
      message: "`ingressSources` requires `plugin:request-ingress`.",
    });
  }
  const seenIds = new Set<string>();
  return manifest.ingressSources.flatMap((rawSource, index) => {
    const field = `ingressSources/${index}`;
    if (!isRecord(rawSource)) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field,
        manifestPath,
        message: "Expected an ingress source object.",
      });
      return [];
    }
    validateRequiredString({
      issues,
      manifestPath,
      maxLength: 64,
      minLength: 1,
      path: `${field}/id`,
      pattern: /^[a-z][a-z0-9_-]{0,63}$/,
      value: rawSource.id,
    });
    validateRequiredString({
      issues,
      manifestPath,
      maxLength: 120,
      minLength: 1,
      path: `${field}/name`,
      value: rawSource.name,
    });
    validateOptionalString({
      issues,
      manifestPath,
      maxLength: 1000,
      path: `${field}/description`,
      value: rawSource.description,
    });
    const id = typeof rawSource.id === "string" ? rawSource.id : null;
    const name = typeof rawSource.name === "string" ? rawSource.name : null;
    const description =
      typeof rawSource.description === "string" ? rawSource.description : null;
    const pollIntervalMs = optionalIntegerValue({
      issues,
      manifestPath,
      maximum: 300000,
      minimum: 1000,
      path: `${field}/pollIntervalMs`,
      value: rawSource.pollIntervalMs,
    });
    const timeoutMs = optionalIntegerValue({
      issues,
      manifestPath,
      maximum: 60000,
      minimum: 1000,
      path: `${field}/timeoutMs`,
      value: rawSource.timeoutMs,
    });
    const supportsReplyToSource = rawSource.supportsReplyToSource === true;
    if (supportsReplyToSource && !permissionSet.has("plugin:reply-to-source")) {
      pushManifestIssue(issues, {
        code: "missing_required_permission",
        field: `${field}/supportsReplyToSource`,
        manifestPath,
        message: "`supportsReplyToSource` requires `plugin:reply-to-source`.",
      });
    }
    if (id && seenIds.has(id)) {
      pushManifestIssue(issues, {
        code: "duplicate_ingress_source_id",
        field: `${field}/id`,
        manifestPath,
        message: `Ingress source id ${JSON.stringify(id)} must be declared at most once.`,
      });
    }
    if (id) seenIds.add(id);
    return [
      {
        description,
        id,
        name,
        pollIntervalMs,
        supportsReplyToSource,
        timeoutMs,
      },
    ];
  });
}

function filesValue(
  manifest: Record<string, unknown>,
  permissions: unknown[],
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): PluginManifestFiles {
  if (!hasOwn(manifest, "files")) {
    return {
      allow: emptyFileAccess(),
      deny: {
        delete: [...BUILTIN_PROJECT_FILE_DENY_PATTERNS],
        read: [...BUILTIN_PROJECT_FILE_DENY_PATTERNS],
        write: [...BUILTIN_PROJECT_FILE_DENY_PATTERNS],
      },
    };
  }
  if (!isRecord(manifest.files)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "files",
      manifestPath,
      message: "Expected a files declaration object.",
    });
    return {
      allow: emptyFileAccess(),
      deny: {
        delete: [...BUILTIN_PROJECT_FILE_DENY_PATTERNS],
        read: [...BUILTIN_PROJECT_FILE_DENY_PATTERNS],
        write: [...BUILTIN_PROJECT_FILE_DENY_PATTERNS],
      },
    };
  }

  const files = {
    allow: fileAccessValue(manifest.files, "allow", manifestPath, issues),
    deny: fileAccessValue(manifest.files, "deny", manifestPath, issues),
  };
  for (const access of PROJECT_FILE_ACCESS_KINDS) {
    files.deny[access] = [
      ...BUILTIN_PROJECT_FILE_DENY_PATTERNS,
      ...files.deny[access],
    ];
  }
  const permissionSet = new Set(
    permissions.filter(
      (permission): permission is string => typeof permission === "string",
    ),
  );
  for (const [fileAccess, requiredPermission] of [
    ["read", "files:read"],
    ["write", "files:write"],
    ["delete", "files:delete"],
  ] as const) {
    if (
      files.allow[fileAccess].length > 0 &&
      !permissionSet.has(requiredPermission)
    ) {
      pushManifestIssue(issues, {
        code: "missing_required_permission",
        field: `files/allow/${fileAccess}`,
        manifestPath,
        message: `Non-empty files.allow.${fileAccess} declarations require \`${requiredPermission}\` permission.`,
      });
    }
  }

  return files;
}

function permissionSetValue(permissions: unknown[]): Set<string> {
  return new Set(
    permissions.filter(
      (permission): permission is string => typeof permission === "string",
    ),
  );
}

function validateIntegerBounds(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  maximum?: number;
  minimum: number;
  path: string;
  value: unknown;
}): void {
  if (typeof input.value !== "number" || !Number.isInteger(input.value)) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Expected an integer value.",
    });
    return;
  }
  if (
    input.value < input.minimum ||
    (input.maximum !== undefined && input.value > input.maximum)
  ) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_value",
      field: input.path,
      manifestPath: input.manifestPath,
      message:
        input.maximum === undefined
          ? `Expected an integer greater than or equal to ${input.minimum}.`
          : `Expected an integer between ${input.minimum} and ${input.maximum}.`,
    });
  }
}

function validateRequiredTimeout(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  path: string;
  value: unknown;
}): void {
  if (input.value === undefined) {
    pushManifestIssue(input.issues, {
      code: "missing_required_manifest_field",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Required manifest field is missing.",
    });
    return;
  }
  validateIntegerBounds({
    issues: input.issues,
    manifestPath: input.manifestPath,
    maximum: TIMEOUT_MS_MAXIMUM,
    minimum: TIMEOUT_MS_MINIMUM,
    path: input.path,
    value: input.value,
  });
}

function validateOptionalBoolean(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  path: string;
  value: unknown;
}): void {
  if (input.value === undefined) {
    return;
  }
  if (typeof input.value !== "boolean") {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Expected a boolean value.",
    });
  }
}

function networkValue(
  manifest: Record<string, unknown>,
  permissions: unknown[],
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): Record<string, unknown> | null {
  const permissionSet = permissionSetValue(permissions);
  if (!hasOwn(manifest, "network")) {
    if (
      permissionSet.has("network:fetch") ||
      permissionSet.has("network:websocket")
    ) {
      pushManifestIssue(issues, {
        code: "missing_required_manifest_field",
        field: "network",
        manifestPath,
        message:
          "Network permissions require a network declaration with a non-empty matching allowlist.",
      });
    }
    return null;
  }
  if (!isRecord(manifest.network)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "network",
      manifestPath,
      message: "Expected a network declaration object.",
    });
    return null;
  }

  const enforceHttps = hasOwn(manifest.network, "enforceHttps")
    ? manifest.network.enforceHttps
    : true;
  if (typeof enforceHttps !== "boolean") {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "network/enforceHttps",
      manifestPath,
      message: "Expected a boolean value.",
    });
  }

  const networkDeclaration = manifest.network;
  const readNetworkAllowPatterns = (input: {
    fieldName: "allow" | "webSocketAllow";
    kind: "fetch" | "websocket";
    permission: "network:fetch" | "network:websocket";
  }): unknown[] => {
    const fieldPath = `network/${input.fieldName}`;
    const value = networkDeclaration[input.fieldName];
    if (!hasOwn(networkDeclaration, input.fieldName)) {
      if (permissionSet.has(input.permission)) {
        pushManifestIssue(issues, {
          code: "missing_required_manifest_field",
          field: fieldPath,
          manifestPath,
          message: `\`${input.permission}\` requires a non-empty network.${input.fieldName} list.`,
        });
      }
      return [];
    }
    if (!Array.isArray(value)) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field: fieldPath,
        manifestPath,
        message: "Expected an array of URL allow patterns.",
      });
      return [];
    }
    if (permissionSet.has(input.permission) && value.length === 0) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_value",
        field: fieldPath,
        manifestPath,
        message: `\`${input.permission}\` requires at least one allowed URL pattern.`,
      });
    }
    const seenPatterns = new Set<string>();
    const compilablePatterns: { index: number; pattern: string }[] = [];
    for (const [index, pattern] of value.entries()) {
      const patternPath = `${fieldPath}/${index}`;
      if (typeof pattern !== "string") {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_type",
          field: patternPath,
          manifestPath,
          message: "Expected a URL allow pattern string.",
        });
        continue;
      }
      if (pattern.trim().length === 0) {
        pushManifestIssue(issues, {
          code: "invalid_manifest_field_value",
          field: patternPath,
          manifestPath,
          message: "URL allow patterns must be non-empty.",
        });
        continue;
      }
      if (seenPatterns.has(pattern)) {
        pushManifestIssue(issues, {
          code: "duplicate_network_allow_pattern",
          field: patternPath,
          manifestPath,
          message: `URL allow pattern ${JSON.stringify(pattern)} must be declared at most once.`,
        });
      }
      seenPatterns.add(pattern);
      compilablePatterns.push({ index, pattern });
    }

    const compiledAllowlist = compilePluginNetworkAllowlist({
      allowUnsafeAllDomains: permissionSet.has("unsafe"),
      enforceHttps: enforceHttps === true,
      kind: input.kind,
      patterns: compilablePatterns.map((entry) => entry.pattern),
    });
    for (const compileIssue of compiledAllowlist.issues) {
      const manifestIndex = compilablePatterns[compileIssue.index]?.index;
      pushManifestIssue(issues, {
        code: compileIssue.code,
        field: `${fieldPath}/${manifestIndex ?? compileIssue.index}`,
        manifestPath,
        message: compileIssue.message,
      });
    }
    return value;
  };

  const allow = readNetworkAllowPatterns({
    fieldName: "allow",
    kind: "fetch",
    permission: "network:fetch",
  });
  const webSocketAllow = readNetworkAllowPatterns({
    fieldName: "webSocketAllow",
    kind: "websocket",
    permission: "network:websocket",
  });

  return {
    ...networkDeclaration,
    allow,
    enforceHttps: typeof enforceHttps === "boolean" ? enforceHttps : true,
    webSocketAllow,
  };
}

function envValue(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): unknown[] {
  if (!hasOwn(manifest, "env")) {
    return [];
  }
  if (!Array.isArray(manifest.env)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "env",
      manifestPath,
      message: "Expected an array of env declarations.",
    });
    return [];
  }

  for (const [index, envVar] of manifest.env.entries()) {
    const envPath = `env/${index}`;
    if (!isRecord(envVar)) {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field: envPath,
        manifestPath,
        message: "Expected an env declaration object.",
      });
      continue;
    }
    validateRequiredString({
      issues,
      manifestPath,
      maxLength: 128,
      minLength: 1,
      path: `${envPath}/key`,
      pattern: ENV_KEY_PATTERN,
      value: envVar.key,
    });
    validateOptionalString({
      issues,
      manifestPath,
      maxLength: 1000,
      path: `${envPath}/description`,
      value: envVar.description,
    });
    validateOptionalBoolean({
      issues,
      manifestPath,
      path: `${envPath}/required`,
      value: envVar.required,
    });
    validateOptionalBoolean({
      issues,
      manifestPath,
      path: `${envPath}/secret`,
      value: envVar.secret,
    });
    if (hasOwn(envVar, "default") && typeof envVar.default !== "string") {
      pushManifestIssue(issues, {
        code: "invalid_manifest_field_type",
        field: `${envPath}/default`,
        manifestPath,
        message: "Expected a string default value.",
      });
    }
    if (envVar.secret === true && hasOwn(envVar, "default")) {
      pushManifestIssue(issues, {
        code: "secret_env_default",
        field: `${envPath}/default`,
        manifestPath,
        message: "Secret env declarations cannot include defaults.",
      });
    }
  }

  return manifest.env;
}

function isScalarSettingValue(
  value: unknown,
): value is boolean | number | string | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanOrDefault(value: unknown, defaultValue = false): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function isValidUrlString(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.length > 1;
  } catch {
    return false;
  }
}

function isValidSettingItemValue(
  itemKind: PluginManifestListSettingItemKind,
  value: unknown,
): boolean {
  switch (itemKind) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "url":
      return typeof value === "string" && isValidUrlString(value);
    case "email":
      return (
        typeof value === "string" && EMAIL_SETTING_ITEM_PATTERN.test(value)
      );
  }
}

function settingOptionsValue(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  path: string;
  setting: Record<string, unknown>;
}): string[] {
  if (!hasOwn(input.setting, "options")) {
    pushManifestIssue(input.issues, {
      code: "missing_required_manifest_field",
      field: `${input.path}/options`,
      manifestPath: input.manifestPath,
      message: "Enum settings require options.",
    });
    return [];
  }
  if (
    !Array.isArray(input.setting.options) ||
    input.setting.options.length === 0
  ) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: `${input.path}/options`,
      manifestPath: input.manifestPath,
      message: "Expected a non-empty array of string options.",
    });
    return [];
  }

  const options: string[] = [];
  const seenOptions = new Set<string>();
  for (const [optionIndex, option] of input.setting.options.entries()) {
    if (typeof option !== "string") {
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_type",
        field: `${input.path}/options/${optionIndex}`,
        manifestPath: input.manifestPath,
        message: "Expected a string option.",
      });
      continue;
    }
    if (seenOptions.has(option)) {
      pushManifestIssue(input.issues, {
        code: "duplicate_setting_option",
        field: `${input.path}/options/${optionIndex}`,
        manifestPath: input.manifestPath,
        message: `Setting option ${JSON.stringify(option)} must be declared at most once.`,
      });
    }
    seenOptions.add(option);
    options.push(option);
  }
  return options;
}

function settingItemsValue(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  path: string;
  setting: Record<string, unknown>;
}): PluginManifestListSettingItems | null {
  if (!hasOwn(input.setting, "items")) {
    pushManifestIssue(input.issues, {
      code: "missing_required_manifest_field",
      field: `${input.path}/items`,
      manifestPath: input.manifestPath,
      message: "List settings require an items declaration.",
    });
    return null;
  }
  if (!isRecord(input.setting.items)) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: `${input.path}/items`,
      manifestPath: input.manifestPath,
      message: "Expected a list items declaration object.",
    });
    return null;
  }
  if (typeof input.setting.items.kind !== "string") {
    pushManifestIssue(input.issues, {
      code: "missing_required_manifest_field",
      field: `${input.path}/items/kind`,
      manifestPath: input.manifestPath,
      message: "List settings require an item kind.",
    });
    return null;
  }
  if (!LIST_SETTING_ITEM_KIND_SET.has(input.setting.items.kind)) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_value",
      field: `${input.path}/items/kind`,
      manifestPath: input.manifestPath,
      message: "List setting item kind must be string, number, url, or email.",
    });
    return null;
  }
  return {
    kind: input.setting.items.kind as PluginManifestListSettingItemKind,
  };
}

function settingDefaultValue(input: {
  issues: RpcPluginInventoryIssue[];
  kind: PluginManifestSettingKind;
  manifestPath: string;
  options: string[];
  path: string;
  setting: Record<string, unknown>;
  items: PluginManifestListSettingItems | null;
}): PluginManifestSettingDefault {
  if (!hasOwn(input.setting, "default")) {
    return null;
  }
  const value = input.setting.default;
  switch (input.kind) {
    case "string":
      if (typeof value === "string") {
        return value;
      }
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_type",
        field: `${input.path}/default`,
        manifestPath: input.manifestPath,
        message: "Expected a string default value.",
      });
      return null;
    case "secret":
      if (isScalarSettingValue(value)) {
        return value;
      }
      pushManifestIssue(input.issues, {
        code: "non_scalar_secret_setting",
        field: `${input.path}/default`,
        manifestPath: input.manifestPath,
        message: "Secret setting defaults must be scalar values.",
      });
      return null;
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_type",
        field: `${input.path}/default`,
        manifestPath: input.manifestPath,
        message: "Expected a numeric default value.",
      });
      return null;
    case "boolean":
      if (typeof value === "boolean") {
        return value;
      }
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_type",
        field: `${input.path}/default`,
        manifestPath: input.manifestPath,
        message: "Expected a boolean default value.",
      });
      return null;
    case "enum":
      if (typeof value !== "string") {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_type",
          field: `${input.path}/default`,
          manifestPath: input.manifestPath,
          message: "Expected a string default value.",
        });
        return null;
      }
      if (input.options.length > 0 && !input.options.includes(value)) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${input.path}/default`,
          manifestPath: input.manifestPath,
          message: "Enum default must match one of the declared options.",
        });
      }
      return value;
    case "url":
      if (typeof value !== "string") {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_type",
          field: `${input.path}/default`,
          manifestPath: input.manifestPath,
          message: "Expected a URL string default value.",
        });
        return null;
      }
      if (!isValidUrlString(value)) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${input.path}/default`,
          manifestPath: input.manifestPath,
          message: "URL defaults must be syntactically valid URLs.",
        });
      }
      return value;
    case "date":
      if (typeof value !== "string") {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_type",
          field: `${input.path}/default`,
          manifestPath: input.manifestPath,
          message: "Expected a YYYY-MM-DD date string default value.",
        });
        return null;
      }
      if (!DATE_DEFAULT_PATTERN.test(value)) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${input.path}/default`,
          manifestPath: input.manifestPath,
          message: "Date defaults must use YYYY-MM-DD format.",
        });
      }
      return value;
    case "list": {
      if (!Array.isArray(value)) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_type",
          field: `${input.path}/default`,
          manifestPath: input.manifestPath,
          message: "Expected an array default value.",
        });
        return null;
      }
      if (!input.items) {
        return [];
      }
      const listItems = input.items;
      return value.flatMap((item, itemIndex) => {
        if (!isValidSettingItemValue(listItems.kind, item)) {
          pushManifestIssue(input.issues, {
            code: "invalid_manifest_field_value",
            field: `${input.path}/default/${itemIndex}`,
            manifestPath: input.manifestPath,
            message: `List ${listItems.kind} default values must be valid ${listItems.kind} values.`,
          });
          return [];
        }
        return [item as number | string];
      });
    }
  }
}

function settingsArrayValue(input: {
  issues: RpcPluginInventoryIssue[];
  manifestPath: string;
  path: string;
  value: unknown;
}): PluginManifestSettingDeclaration[] {
  if (!Array.isArray(input.value)) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: input.path,
      manifestPath: input.manifestPath,
      message: "Expected an array of setting declarations.",
    });
    return [];
  }

  const declarations: PluginManifestSettingDeclaration[] = [];
  for (const [index, setting] of input.value.entries()) {
    const settingPath = `${input.path}/${index}`;
    if (!isRecord(setting)) {
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_type",
        field: settingPath,
        manifestPath: input.manifestPath,
        message: "Expected a setting declaration object.",
      });
      continue;
    }
    const hasValidKey = validateRequiredString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: 64,
      minLength: 1,
      path: `${settingPath}/key`,
      pattern: PLUGIN_IDENTIFIER_PATTERN,
      value: setting.key,
    });
    const hasValidLabel = validateRequiredString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: 120,
      minLength: 1,
      path: `${settingPath}/label`,
      value: setting.label,
    });
    validateOptionalString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: 1000,
      path: `${settingPath}/description`,
      value: setting.description,
    });
    validateOptionalBoolean({
      issues: input.issues,
      manifestPath: input.manifestPath,
      path: `${settingPath}/required`,
      value: setting.required,
    });

    let settingKind: PluginManifestSettingKind | null = null;
    const hasKindString =
      validateRequiredString({
        issues: input.issues,
        manifestPath: input.manifestPath,
        maxLength: 32,
        minLength: 1,
        path: `${settingPath}/kind`,
        value: setting.kind,
      }) && typeof setting.kind === "string";
    if (hasKindString) {
      if (SETTING_KIND_SET.has(setting.kind as string)) {
        settingKind = setting.kind as PluginManifestSettingKind;
      } else {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${settingPath}/kind`,
          manifestPath: input.manifestPath,
          message: "Unknown setting kind.",
        });
      }
    }

    let options: string[] = [];
    let items: PluginManifestListSettingItems | null = null;
    if (settingKind === "secret") {
      if (hasOwn(setting, "items") || hasOwn(setting, "options")) {
        pushManifestIssue(input.issues, {
          code: "non_scalar_secret_setting",
          field: settingPath,
          manifestPath: input.manifestPath,
          message: "Secret settings cannot declare items or options.",
        });
      }
    } else if (settingKind === "list") {
      items = settingItemsValue({
        issues: input.issues,
        manifestPath: input.manifestPath,
        path: settingPath,
        setting,
      });
      if (hasOwn(setting, "options")) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${settingPath}/options`,
          manifestPath: input.manifestPath,
          message: "List settings use items instead of options.",
        });
      }
    } else if (settingKind === "enum") {
      options = settingOptionsValue({
        issues: input.issues,
        manifestPath: input.manifestPath,
        path: settingPath,
        setting,
      });
      if (hasOwn(setting, "items")) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${settingPath}/items`,
          manifestPath: input.manifestPath,
          message: "Enum settings use options instead of items.",
        });
      }
    } else if (settingKind !== null) {
      if (hasOwn(setting, "items") || hasOwn(setting, "options")) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: settingPath,
          manifestPath: input.manifestPath,
          message:
            "Only enum settings can declare options and only list settings can declare items.",
        });
      }
    }

    const hasDefault = hasOwn(setting, "default");
    const defaultValue = settingKind
      ? settingDefaultValue({
          issues: input.issues,
          items,
          kind: settingKind,
          manifestPath: input.manifestPath,
          options,
          path: settingPath,
          setting,
        })
      : null;

    declarations.push({
      defaultValue,
      description: stringOrNull(setting.description),
      hasDefault,
      items,
      key: hasValidKey ? stringOrNull(setting.key) : null,
      kind: settingKind,
      label: hasValidLabel ? stringOrNull(setting.label) : null,
      options,
      required: booleanOrDefault(setting.required),
    });
  }

  return declarations;
}

function settingsValue(
  value: unknown,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): PluginManifestSettings {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return settingsArrayValue({
      issues,
      manifestPath,
      path: "settings",
      value,
    });
  }
  if (!isRecord(value)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "settings",
      manifestPath,
      message: "Expected a settings declaration array.",
    });
    return [];
  }
  return [
    ...(hasOwn(value, "general")
      ? settingsArrayValue({
          issues,
          manifestPath,
          path: "settings/general",
          value: value.general,
        })
      : []),
    ...(hasOwn(value, "global")
      ? settingsArrayValue({
          issues,
          manifestPath,
          path: "settings/global",
          value: value.global,
        })
      : []),
    ...(hasOwn(value, "user")
      ? settingsArrayValue({
          issues,
          manifestPath,
          path: "settings/user",
          value: value.user,
        })
      : []),
  ];
}

export function encodePluginSettingListValue(values: string[]): string {
  return values
    .map((value) => value.replaceAll("\\", "\\\\").replaceAll(",", "\\,"))
    .join(",");
}

export function decodePluginSettingListValue(value: string): string[] {
  if (value === "") {
    return [];
  }

  const values: string[] = [];
  let currentValue = "";
  let isEscaped = false;
  for (const character of value) {
    if (isEscaped) {
      currentValue += character;
      isEscaped = false;
      continue;
    }
    if (character === "\\") {
      isEscaped = true;
      continue;
    }
    if (character === ",") {
      values.push(currentValue);
      currentValue = "";
      continue;
    }
    currentValue += character;
  }
  if (isEscaped) {
    currentValue += "\\";
  }
  values.push(currentValue);
  return values;
}

function providerArrayValue(input: {
  fieldName: "notificationProviders" | "oauthProviders" | "providers";
  manifest: Record<string, unknown>;
  manifestPath: string;
  permissions: unknown[];
  requiredPermission:
    | "notification:provider"
    | "oauth:register"
    | "provider:register";
  issues: RpcPluginInventoryIssue[];
}): unknown[] {
  if (!hasOwn(input.manifest, input.fieldName)) {
    return [];
  }
  const value = input.manifest[input.fieldName];
  if (!Array.isArray(value)) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: input.fieldName,
      manifestPath: input.manifestPath,
      message: "Expected an array of provider declarations.",
    });
    return [];
  }
  if (value.length > PROVIDER_LIMIT) {
    pushManifestIssue(input.issues, {
      code: "too_many_provider_declarations",
      field: input.fieldName,
      manifestPath: input.manifestPath,
      message: `Expected at most ${PROVIDER_LIMIT} provider declarations.`,
    });
  }
  if (
    value.length > 0 &&
    !permissionSetValue(input.permissions).has(input.requiredPermission)
  ) {
    pushManifestIssue(input.issues, {
      code: "missing_required_permission",
      field: input.fieldName,
      manifestPath: input.manifestPath,
      message: `${input.fieldName} declarations require \`${input.requiredPermission}\` permission.`,
    });
  }

  for (const [index, provider] of value.entries()) {
    const providerPath = `${input.fieldName}/${index}`;
    if (!isRecord(provider)) {
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_type",
        field: providerPath,
        manifestPath: input.manifestPath,
        message: "Expected a provider declaration object.",
      });
      continue;
    }
    validateRequiredString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: 64,
      minLength: 1,
      path: `${providerPath}/id`,
      pattern: PLUGIN_IDENTIFIER_PATTERN,
      value: provider.id,
    });
    validateRequiredString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: 120,
      minLength: 1,
      path: `${providerPath}/name`,
      value: provider.name,
    });
    validateRequiredString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: 1000,
      minLength: 1,
      path: `${providerPath}/description`,
      value: provider.description,
    });
    validateRequiredTimeout({
      issues: input.issues,
      manifestPath: input.manifestPath,
      path: `${providerPath}/timeoutMs`,
      value: provider.timeoutMs,
    });
  }

  return value;
}

function declaredSettingKeys(settings: PluginManifestSettings): Set<string> {
  const keys = new Set<string>();
  for (const setting of settings) {
    if (setting.key) {
      keys.add(setting.key);
    }
  }
  return keys;
}

function declaredEnvKeys(env: unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const declaration of env) {
    if (isRecord(declaration) && typeof declaration.key === "string") {
      keys.add(declaration.key);
    }
  }
  return keys;
}

function piAuthValue(input: {
  env: unknown[];
  issues: RpcPluginInventoryIssue[];
  manifest: Record<string, unknown>;
  manifestPath: string;
  permissions: unknown[];
  settings: PluginManifestSettings;
}): PluginManifestPiAuthBinding[] {
  if (!hasOwn(input.manifest, "piAuth")) {
    return [];
  }
  const value = input.manifest.piAuth;
  if (!Array.isArray(value)) {
    pushManifestIssue(input.issues, {
      code: "invalid_manifest_field_type",
      field: "piAuth",
      manifestPath: input.manifestPath,
      message: "Expected an array of Pi auth bindings.",
    });
    return [];
  }
  if (value.length > PROVIDER_LIMIT) {
    pushManifestIssue(input.issues, {
      code: "too_many_pi_auth_bindings",
      field: "piAuth",
      manifestPath: input.manifestPath,
      message: `Expected at most ${PROVIDER_LIMIT} Pi auth bindings.`,
    });
  }

  const settingKeys = declaredSettingKeys(input.settings);
  const envKeys = declaredEnvKeys(input.env);
  const permissions = permissionSetValue(input.permissions);
  const bindings: PluginManifestPiAuthBinding[] = [];
  for (const [index, binding] of value.entries()) {
    const bindingPath = `piAuth/${index}`;
    if (!isRecord(binding)) {
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_type",
        field: bindingPath,
        manifestPath: input.manifestPath,
        message: "Expected a Pi auth binding object.",
      });
      continue;
    }
    validateRequiredString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: 128,
      minLength: 1,
      path: `${bindingPath}/provider`,
      pattern: /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/,
      value: binding.provider,
    });
    const kind =
      binding.kind === "api_key" ||
      binding.kind === "codex_auth" ||
      binding.kind === "pi_oauth_file"
        ? binding.kind
        : null;
    if (!kind) {
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_value",
        field: `${bindingPath}/kind`,
        manifestPath: input.manifestPath,
        message: "Expected `api_key`, `codex_auth`, or `pi_oauth_file`.",
      });
    }

    const source =
      binding.source === "env" || binding.source === "setting"
        ? binding.source
        : null;
    if (!source) {
      pushManifestIssue(input.issues, {
        code: "invalid_manifest_field_value",
        field: `${bindingPath}/source`,
        manifestPath: input.manifestPath,
        message: "Expected `env` or `setting`.",
      });
    }

    const valuePattern =
      source === "env" ? /^[A-Z_][A-Z0-9_]*$/ : PLUGIN_IDENTIFIER_PATTERN;
    validateRequiredString({
      issues: input.issues,
      manifestPath: input.manifestPath,
      maxLength: source === "env" ? 128 : 64,
      minLength: 1,
      path: `${bindingPath}/value`,
      pattern: valuePattern,
      value: binding.value,
    });
    if (typeof binding.value === "string") {
      if (source === "env" && !envKeys.has(binding.value)) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${bindingPath}/value`,
          manifestPath: input.manifestPath,
          message:
            "Pi auth env source must reference a declared plugin env var.",
        });
      }
      if (source === "setting" && !settingKeys.has(binding.value)) {
        pushManifestIssue(input.issues, {
          code: "invalid_manifest_field_value",
          field: `${bindingPath}/value`,
          manifestPath: input.manifestPath,
          message:
            "Pi auth setting source must reference a declared plugin setting.",
        });
      }
    }

    if (
      (kind === "codex_auth" || kind === "pi_oauth_file") &&
      !permissions.has("storage:read")
    ) {
      pushManifestIssue(input.issues, {
        code: "missing_required_permission",
        field: "piAuth",
        manifestPath: input.manifestPath,
        message:
          "`codex_auth` and `pi_oauth_file` Pi auth bindings require `storage:read`.",
      });
    }

    bindings.push({
      kind,
      provider: typeof binding.provider === "string" ? binding.provider : null,
      source,
      value: typeof binding.value === "string" ? binding.value : null,
    });
  }
  return bindings;
}

function storageValue(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): Record<string, unknown> {
  if (!hasOwn(manifest, "storage")) {
    return {};
  }
  if (!isRecord(manifest.storage)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "storage",
      manifestPath,
      message: "Expected a storage declaration object.",
    });
    return {};
  }
  if (!hasOwn(manifest.storage, "defaults")) {
    return manifest.storage;
  }
  if (!isRecord(manifest.storage.defaults)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "storage/defaults",
      manifestPath,
      message: "Expected a storage defaults object.",
    });
    return manifest.storage;
  }
  for (const fieldName of [
    "maxDataBytes",
    "maxFileBytes",
    "maxFiles",
  ] as const) {
    if (hasOwn(manifest.storage.defaults, fieldName)) {
      validateIntegerBounds({
        issues,
        manifestPath,
        minimum: 1,
        path: `storage/defaults/${fieldName}`,
        value: manifest.storage.defaults[fieldName],
      });
    }
  }
  return manifest.storage;
}

function gcValue(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): Record<string, unknown> | null {
  if (!hasOwn(manifest, "gc")) {
    return null;
  }
  if (!isRecord(manifest.gc)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "gc",
      manifestPath,
      message: "Expected a GC declaration object.",
    });
    return null;
  }
  if (!hasOwn(manifest.gc, "enabled")) {
    pushManifestIssue(issues, {
      code: "missing_required_manifest_field",
      field: "gc/enabled",
      manifestPath,
      message: "Required manifest field is missing.",
    });
  } else if (manifest.gc.enabled !== true) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_value",
      field: "gc/enabled",
      manifestPath,
      message: "GC declarations must set enabled to true.",
    });
  }
  validateRequiredTimeout({
    issues,
    manifestPath,
    path: "gc/timeoutMs",
    value: manifest.gc.timeoutMs,
  });
  return manifest.gc;
}

function limitsValue(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: RpcPluginInventoryIssue[],
): Record<string, unknown> {
  if (!hasOwn(manifest, "limits")) {
    return {};
  }
  if (!isRecord(manifest.limits)) {
    pushManifestIssue(issues, {
      code: "invalid_manifest_field_type",
      field: "limits",
      manifestPath,
      message: "Expected a limits declaration object.",
    });
    return {};
  }
  const bounds = {
    maxNetworkResponseBytes: [1, 26214400],
    maxRpcPayloadBytes: [1, 8388608],
    maxTextResultBytes: [1, 262144],
    maxWebSocketConnections: [1, 32],
    maxWebSocketMessageBytes: [1, 1048576],
    maxWebSocketQueuedMessages: [1, 1024],
    sidecarMemoryBytes: [16777216, 536870912],
  } as const;
  for (const [fieldName, [minimum, maximum]] of Object.entries(bounds)) {
    if (hasOwn(manifest.limits, fieldName)) {
      validateIntegerBounds({
        issues,
        manifestPath,
        maximum,
        minimum,
        path: `limits/${fieldName}`,
        value: manifest.limits[fieldName],
      });
    }
  }
  return manifest.limits;
}

function telemetryValue(manifest: Record<string, unknown>): boolean | null {
  if (!Object.hasOwn(manifest, "telemetry")) {
    return true;
  }
  return typeof manifest.telemetry === "boolean" ? manifest.telemetry : null;
}

export function parsePluginManifest(
  rawManifest: string,
  manifestPath: string,
): PluginManifestParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    return {
      issues: [
        issue({
          code: "invalid_manifest_json",
          manifestPath,
          message: "Plugin manifest is not valid JSON.",
        }),
      ],
      manifest: null,
    };
  }

  if (!isRecord(parsed)) {
    return {
      issues: [
        issue({
          code: "invalid_manifest_shape",
          manifestPath,
          message: "Plugin manifest must be a JSON object.",
        }),
      ],
      manifest: null,
    };
  }

  const issues: RpcPluginInventoryIssue[] = [];
  const id = stringField(
    parsed,
    "id",
    { pattern: PLUGIN_ID_PATTERN },
    manifestPath,
    issues,
  );
  if (id && isReservedPluginId(id)) {
    pushManifestIssue(issues, {
      code: "reserved_plugin_id",
      field: "id",
      manifestPath,
      message:
        "Plugin id metidos is reserved for Metidos-native permissions and cannot be used by plugins.",
    });
  }
  const name = stringField(
    parsed,
    "name",
    { maxLength: 120, minLength: 1 },
    manifestPath,
    issues,
  );
  if (name && isReservedPluginDisplayName(name)) {
    pushManifestIssue(issues, {
      code: "reserved_plugin_name",
      field: "name",
      manifestPath,
      message:
        "Plugin display name Metidos is reserved for the host application and cannot be used by plugins.",
    });
  }
  const version = stringField(
    parsed,
    "version",
    { pattern: SEMVER_PATTERN },
    manifestPath,
    issues,
  );
  const metidosApiVersion = stringField(
    parsed,
    "metidosApiVersion",
    { constValue: METIDOS_PLUGIN_API_VERSION },
    manifestPath,
    issues,
  );
  const description = stringField(
    parsed,
    "description",
    { maxLength: 1000, minLength: 1 },
    manifestPath,
    issues,
  );
  let color: string | null = null;
  if (Object.hasOwn(parsed, "color")) {
    color = stringField(
      parsed,
      "color",
      { maxLength: 128, minLength: 1, pattern: /^[^;{}<>]+$/ },
      manifestPath,
      issues,
    );
  }
  const main = stringField(
    parsed,
    "main",
    {
      maxLength: 260,
      minLength: 1,
      pattern:
        /^\.\/(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:\.data|\.logs|\.data-bak-[^/]*)(?:\/|$)).+$/,
    },
    manifestPath,
    issues,
  );
  const permissions = permissionsValue(parsed, manifestPath, issues);
  const access = accessValue(parsed, manifestPath, issues);
  if (
    access.some(
      (group) =>
        isRecord(group) &&
        Array.isArray(group.injects) &&
        group.injects.length > 0,
    ) &&
    !permissions.includes("metidos:prompt_inject")
  ) {
    pushManifestIssue(issues, {
      code: "missing_required_permission",
      field: "permissions",
      manifestPath,
      message: "`access[].injects` requires `metidos:prompt_inject`.",
    });
  }
  const ingressSources = ingressSourcesValue(
    parsed,
    permissions,
    manifestPath,
    issues,
  );
  const files = filesValue(parsed, permissions, manifestPath, issues);
  const network = networkValue(parsed, permissions, manifestPath, issues);
  const env = envValue(parsed, manifestPath, issues);
  const settings = settingsValue(parsed.settings, manifestPath, issues);
  const piAuth = piAuthValue({
    env,
    issues,
    manifest: parsed,
    manifestPath,
    permissions,
    settings,
  });
  const providers = providerArrayValue({
    fieldName: "providers",
    issues,
    manifest: parsed,
    manifestPath,
    permissions,
    requiredPermission: "provider:register",
  });
  const notificationProviders = providerArrayValue({
    fieldName: "notificationProviders",
    issues,
    manifest: parsed,
    manifestPath,
    permissions,
    requiredPermission: "notification:provider",
  });
  const oauthProviders = providerArrayValue({
    fieldName: "oauthProviders",
    issues,
    manifest: parsed,
    manifestPath,
    permissions,
    requiredPermission: "oauth:register",
  });
  const storage = storageValue(parsed, manifestPath, issues);
  const gc = gcValue(parsed, manifestPath, issues);
  const limits = limitsValue(parsed, manifestPath, issues);

  return {
    issues,
    manifest: {
      access,
      color,
      description,
      env,
      files,
      gc,
      id,
      ingressSources,
      limits,
      main,
      metidosApiVersion,
      name,
      network,
      notificationProviders,
      oauthProviders,
      permissions,
      piAuth,
      providers,
      raw: parsed,
      settings,
      storage,
      telemetry: telemetryValue(parsed),
      version,
    },
  };
}

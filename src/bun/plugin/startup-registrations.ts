/**
 * @file src/bun/plugin/startup-registrations.ts
 * @description Validation for Plugin System v1 sidecar startup registration payloads.
 */

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { evaluatePluginStaticCapability } from "./capability-gate";
import { PLUGIN_TOOL_ID_PATTERN } from "./identity";
import {
  PLUGIN_INGRESS_CALLBACK_TIMEOUT_MAX_MS,
  PLUGIN_INGRESS_CALLBACK_TIMEOUT_MIN_MS,
  PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS,
  PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS,
  PLUGIN_INGRESS_SOURCE_ID_PATTERN,
  PLUGIN_REPLY_TO_SOURCE_PERMISSION,
  PLUGIN_REQUEST_INGRESS_PERMISSION,
} from "./ingress";
import { PLUGIN_NOTIFICATION_PROVIDER_PERMISSION } from "./notifications";

export const PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS = 1_000;
export const PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS = 600_000;
export const PLUGIN_STARTUP_TOOL_REGISTRATION_LIMIT = 30;
export const PLUGIN_STARTUP_CRON_REGISTRATION_LIMIT = 10;
export const PLUGIN_CRON_CREATE_PERMISSION = "cron:create";
export const PLUGIN_MODEL_PROVIDER_PERMISSION = "provider:register";
export const PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT = 25;
export const PLUGIN_STARTUP_MODEL_PROVIDER_REGISTRATION_LIMIT = 10;
export const PLUGIN_STARTUP_NOTIFICATION_PROVIDER_REGISTRATION_LIMIT = 10;
export const PLUGIN_STARTUP_INGRESS_SOURCE_REGISTRATION_LIMIT = 10;
export const PLUGIN_OAUTH_PROVIDER_PERMISSION = "oauth:register";
export const PLUGIN_STARTUP_OAUTH_PROVIDER_REGISTRATION_LIMIT = 10;
export const PLUGIN_PROMPT_INJECT_PERMISSION = "metidos:prompt_inject";
export const PLUGIN_STARTUP_INJECTION_REGISTRATION_LIMIT = 25;

export type PluginStartupCronScope = "global";

export type PluginStartupCronRegistration = {
  actionHandle: string;
  fullKey: string;
  key: string;
  schedule: string;
  scope: PluginStartupCronScope;
  timeoutMs: number;
};

export type PluginStartupToolRegistration = {
  actionHandle: string;
  description: string;
  name: string;
  runtimeId: string;
  timeoutMs: number;
  tool: string;
  validatePropsHandle: string;
};

export type PluginStartupModelProviderConfiguration = {
  id: string;
  value: Record<string, unknown>;
};

export type PluginStartupProviderRegistration = {
  configurations: PluginStartupModelProviderConfiguration[];
  embedHandle?: string | null;
  executeHandle: string | null;
  getProviderConfigurationsHandle: string | null;
  id: string;
  refreshIntervalMs: number | null;
  timeoutMs: number | null;
};

export type PluginStartupNotificationProviderRegistration = {
  id: string;
  sendHandle: string;
  timeoutMs: number;
};

export type PluginStartupIngressSourceRegistration = {
  id: string;
  name: string;
  description: string | null;
  pollHandle: string;
  promptTemplateHandle: string;
  respondHandle: string | null;
  supportsReplyToSource: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
};

export type PluginStartupOAuthProviderRegistration = {
  id: string;
  importCredentialsHandle: string | null;
  provider: string;
  refreshHandle: string | null;
  timeoutMs: number;
};

export type PluginStartupGcRegistration = {
  actionHandle: string;
  timeoutMs: number | null;
};

export type PluginStartupInjectionRegistration = {
  inject: string;
  name: string;
  promptHandle: string;
  timeoutMs: number;
};

export type PluginStartupRegistrations = {
  crons: PluginStartupCronRegistration[];
  gc: PluginStartupGcRegistration | null;
  ingressSources: PluginStartupIngressSourceRegistration[];
  modelProviders: PluginStartupProviderRegistration[];
  notificationProviders: PluginStartupNotificationProviderRegistration[];
  oauthProviders: PluginStartupOAuthProviderRegistration[];
  injections: PluginStartupInjectionRegistration[];
  tools: PluginStartupToolRegistration[];
};

export class PluginStartupRegistrationValidationError extends Error {
  readonly diagnostics: string[];

  constructor(diagnostics: string[]) {
    super(`Plugin startup registrations invalid: ${diagnostics.join("; ")}`);
    this.name = "PluginStartupRegistrationValidationError";
    this.diagnostics = diagnostics;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declaredToolNames(plugin: RpcPluginInventoryPlugin): Set<string> {
  return new Set(
    plugin.manifest.access.flatMap((group) =>
      group.tools.flatMap((tool) => (tool.name ? [tool.name] : [])),
    ),
  );
}

function declaredInjectionNames(plugin: RpcPluginInventoryPlugin): Set<string> {
  return new Set(
    plugin.manifest.access.flatMap((group) =>
      (group.injects ?? []).flatMap((inject) =>
        inject.name ? [inject.name] : [],
      ),
    ),
  );
}

function declaredProviderIds(providers: { id: string | null }[]): Set<string> {
  return new Set(
    providers.flatMap((provider) => (provider.id ? [provider.id] : [])),
  );
}

function validateTimeout(
  value: unknown,
  path: string,
  diagnostics: string[],
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS ||
    value > PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS
  ) {
    diagnostics.push(
      `${path}.timeoutMs must be an integer between ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS} and ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS}`,
    );
    return null;
  }
  return value;
}

function validateRequiredTimeout(
  value: unknown,
  path: string,
  diagnostics: string[],
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS ||
    value > PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS
  ) {
    diagnostics.push(
      `${path}.timeoutMs must be an integer between ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS} and ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS}`,
    );
    return null;
  }
  return value;
}

function validateRequiredString(
  value: unknown,
  path: string,
  diagnostics: string[],
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(`${path} must be a non-empty string`);
    return null;
  }
  return value;
}

function normalizeInjectionRegistrations(input: {
  declaredNames: Set<string>;
  diagnostics: string[];
  permissions: readonly string[];
  raw: unknown;
}): PluginStartupInjectionRegistration[] {
  const field = "injections";
  const raw = input.raw;
  if (raw === undefined) {
    for (const declaredName of [...input.declaredNames].sort()) {
      input.diagnostics.push(
        `${field} is missing manifest-declared injection ${declaredName}`,
      );
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    input.diagnostics.push(`${field} must be an array`);
    return [];
  }
  if (
    raw.length > 0 &&
    !input.permissions.includes(PLUGIN_PROMPT_INJECT_PERMISSION)
  ) {
    input.diagnostics.push(
      `${field} requires ${PLUGIN_PROMPT_INJECT_PERMISSION}`,
    );
  }
  if (raw.length > PLUGIN_STARTUP_INJECTION_REGISTRATION_LIMIT) {
    input.diagnostics.push(
      `${field} must contain at most ${PLUGIN_STARTUP_INJECTION_REGISTRATION_LIMIT} registrations`,
    );
  }
  const seen = new Set<string>();
  const registrations: PluginStartupInjectionRegistration[] = [];
  raw.forEach((item, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(item)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }
    const inject = validateRequiredString(
      item.inject,
      `${path}.inject`,
      input.diagnostics,
    );
    const name = validateRequiredString(
      item.name,
      `${path}.name`,
      input.diagnostics,
    );
    const promptHandle = validateRequiredString(
      item.promptHandle,
      `${path}.promptHandle`,
      input.diagnostics,
    );
    const timeoutMs = validateRequiredTimeout(
      item.timeoutMs,
      path,
      input.diagnostics,
    );
    if (!inject || !name || !promptHandle || timeoutMs === null) {
      return;
    }
    if (seen.has(inject)) {
      input.diagnostics.push(`${path}.inject duplicates ${inject}`);
    }
    seen.add(inject);
    if (!input.declaredNames.has(inject)) {
      input.diagnostics.push(
        `${path}.inject ${inject} is not declared by the plugin manifest`,
      );
    }
    registrations.push({ inject, name, promptHandle, timeoutMs });
  });
  for (const declaredName of [...input.declaredNames].sort()) {
    if (!seen.has(declaredName)) {
      input.diagnostics.push(
        `${field} is missing manifest-declared injection ${declaredName}`,
      );
    }
  }
  return registrations;
}

function normalizeToolRegistrations(input: {
  declaredNames: Set<string>;
  diagnostics: string[];
  limit: number;
  pluginId: string | null;
  raw: unknown;
}): PluginStartupToolRegistration[] {
  const field = "tools";
  const rawTools = input.raw;
  if (rawTools !== undefined && !Array.isArray(rawTools)) {
    input.diagnostics.push(`${field} must be an array`);
  }
  if (Array.isArray(rawTools) && rawTools.length > input.limit) {
    input.diagnostics.push(
      `${field} must contain at most ${input.limit} registrations`,
    );
  }
  if (input.declaredNames.size > 0 && !input.pluginId) {
    input.diagnostics.push(
      "plugin.pluginId is required to derive plugin runtime tool ids",
    );
  }

  const seenTools = new Set<string>();
  const registrations: PluginStartupToolRegistration[] = [];
  if (!Array.isArray(rawTools)) {
    for (const declaredName of [...input.declaredNames].sort()) {
      input.diagnostics.push(
        `${field} is missing manifest-declared tool ${declaredName}`,
      );
    }
    return registrations;
  }

  rawTools.forEach((item, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(item)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }

    const tool = validateRequiredString(
      item.tool,
      `${path}.tool`,
      input.diagnostics,
    );
    const name = validateRequiredString(
      item.name,
      `${path}.name`,
      input.diagnostics,
    );
    const description = validateRequiredString(
      item.description,
      `${path}.description`,
      input.diagnostics,
    );
    const timeoutMs = validateRequiredTimeout(
      item.timeoutMs,
      path,
      input.diagnostics,
    );
    const validatePropsHandle = validateRequiredString(
      item.validatePropsHandle,
      `${path}.validatePropsHandle`,
      input.diagnostics,
    );
    const actionHandle = validateRequiredString(
      item.actionHandle,
      `${path}.actionHandle`,
      input.diagnostics,
    );

    if (!tool || !name || !description || timeoutMs === null) {
      return;
    }
    if (!validatePropsHandle || !actionHandle) {
      return;
    }
    if (!PLUGIN_TOOL_ID_PATTERN.test(tool)) {
      input.diagnostics.push(
        `${path}.tool must be a snake_case identifier matching ${PLUGIN_TOOL_ID_PATTERN} and must not contain ':'`,
      );
    }
    if (seenTools.has(tool)) {
      input.diagnostics.push(`${path}.tool duplicates ${tool}`);
    }
    seenTools.add(tool);
    if (!input.declaredNames.has(tool)) {
      input.diagnostics.push(
        `${path}.tool ${tool} is not declared by the plugin manifest`,
      );
    }
    registrations.push({
      actionHandle,
      description,
      name,
      runtimeId: `${input.pluginId ?? ""}_${tool}`,
      timeoutMs,
      tool,
      validatePropsHandle,
    });
  });

  for (const declaredName of [...input.declaredNames].sort()) {
    if (!seenTools.has(declaredName)) {
      input.diagnostics.push(
        `${field} is missing manifest-declared tool ${declaredName}`,
      );
    }
  }

  return registrations;
}

function validateIngressTimeout(
  value: unknown,
  path: string,
  diagnostics: string[],
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < PLUGIN_INGRESS_CALLBACK_TIMEOUT_MIN_MS ||
    value > PLUGIN_INGRESS_CALLBACK_TIMEOUT_MAX_MS
  ) {
    diagnostics.push(
      `${path}.timeoutMs must be an integer between ${PLUGIN_INGRESS_CALLBACK_TIMEOUT_MIN_MS} and ${PLUGIN_INGRESS_CALLBACK_TIMEOUT_MAX_MS}`,
    );
    return null;
  }
  return value;
}

function validateIngressPollInterval(
  value: unknown,
  path: string,
  diagnostics: string[],
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS ||
    value > PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS
  ) {
    diagnostics.push(
      `${path}.pollIntervalMs must be an integer between ${PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS} and ${PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS}`,
    );
    return null;
  }
  return value;
}

function normalizeIngressSourceRegistrations(input: {
  declaredSources: Map<
    string | null,
    { id: string | null; name: string | null; supportsReplyToSource: boolean }
  >;
  diagnostics: string[];
  permissions: readonly string[];
  raw: unknown;
}): PluginStartupIngressSourceRegistration[] {
  const field = "ingressSources";
  if (input.raw === undefined) return [];
  if (!Array.isArray(input.raw)) {
    input.diagnostics.push(`${field} must be an array`);
    return [];
  }
  if (input.raw.length > 0) {
    pushCapabilityDiagnostic({
      diagnostics: input.diagnostics,
      field,
      operation: "ingress.registerSource",
      permission: PLUGIN_REQUEST_INGRESS_PERMISSION,
      permissions: input.permissions,
    });
  }
  if (input.raw.length > PLUGIN_STARTUP_INGRESS_SOURCE_REGISTRATION_LIMIT) {
    input.diagnostics.push(
      `${field} must contain at most ${PLUGIN_STARTUP_INGRESS_SOURCE_REGISTRATION_LIMIT} registrations`,
    );
  }
  const seen = new Set<string>();
  const registrations: PluginStartupIngressSourceRegistration[] = [];
  input.raw.forEach((item, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(item)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }
    const id = validateRequiredString(item.id, `${path}.id`, input.diagnostics);
    const name = validateRequiredString(
      item.name,
      `${path}.name`,
      input.diagnostics,
    );
    const pollHandle = validateRequiredString(
      item.pollHandle,
      `${path}.pollHandle`,
      input.diagnostics,
    );
    const promptTemplateHandle = validateRequiredString(
      item.promptTemplateHandle,
      `${path}.promptTemplateHandle`,
      input.diagnostics,
    );
    const timeoutMs = validateIngressTimeout(
      item.timeoutMs,
      path,
      input.diagnostics,
    );
    const pollIntervalMs = validateIngressPollInterval(
      item.pollIntervalMs,
      path,
      input.diagnostics,
    );
    const respondHandle = validateOptionalString(item.respondHandle);
    if (
      !id ||
      !name ||
      !pollHandle ||
      !promptTemplateHandle ||
      timeoutMs === null ||
      pollIntervalMs === null
    ) {
      return;
    }
    if (!PLUGIN_INGRESS_SOURCE_ID_PATTERN.test(id)) {
      input.diagnostics.push(
        `${path}.id must match ${PLUGIN_INGRESS_SOURCE_ID_PATTERN}`,
      );
    }
    if (seen.has(id)) input.diagnostics.push(`${path}.id duplicates ${id}`);
    seen.add(id);
    const declared = input.declaredSources.get(id);
    if (!declared) {
      input.diagnostics.push(
        `${path}.id ${id} is not declared by the plugin manifest`,
      );
    } else {
      if (declared.name !== name) {
        input.diagnostics.push(
          `${path}.name must match manifest ingress source ${id}`,
        );
      }
      if (
        (declared.supportsReplyToSource || respondHandle) &&
        !input.permissions.includes(PLUGIN_REPLY_TO_SOURCE_PERMISSION)
      ) {
        input.diagnostics.push(
          `${path} requires ${PLUGIN_REPLY_TO_SOURCE_PERMISSION}`,
        );
      }
    }
    registrations.push({
      id,
      name,
      description: validateOptionalString(item.description),
      pollHandle,
      pollIntervalMs,
      promptTemplateHandle,
      respondHandle,
      supportsReplyToSource: Boolean(
        declared?.supportsReplyToSource || respondHandle,
      ),
      timeoutMs,
    });
  });
  return registrations;
}

function normalizeModelProviderConfigurations(input: {
  diagnostics: string[];
  path: string;
  raw: unknown;
}): PluginStartupModelProviderConfiguration[] {
  if (!Array.isArray(input.raw)) {
    input.diagnostics.push(`${input.path}.configurations must be an array`);
    return [];
  }

  const seenIds = new Set<string>();
  const configurations: PluginStartupModelProviderConfiguration[] = [];
  input.raw.forEach((configuration, index) => {
    const path = `${input.path}.configurations[${index}]`;
    if (!isRecord(configuration)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }
    const id = validateRequiredString(
      configuration.id,
      `${path}.id`,
      input.diagnostics,
    );
    if (!id) {
      return;
    }
    if (seenIds.has(id)) {
      input.diagnostics.push(`${path}.id duplicates ${id}`);
    }
    seenIds.add(id);
    configurations.push({ id, value: { ...configuration } });
  });
  return configurations;
}

function validateOptionalPositiveInteger(
  value: unknown,
  path: string,
  diagnostics: string[],
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    diagnostics.push(`${path} must be a positive integer`);
    return null;
  }
  return value;
}

function validateOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isValidCronSchedule(schedule: string): boolean {
  if (typeof Bun === "undefined" || typeof Bun.cron?.parse !== "function") {
    return schedule.trim().length > 0;
  }
  try {
    const nextRun = Bun.cron.parse(schedule);
    return nextRun instanceof Date && !Number.isNaN(nextRun.getTime());
  } catch {
    return false;
  }
}

function pushCapabilityDiagnostic(input: {
  diagnostics: string[];
  field: string;
  operation: string;
  permission: string;
  permissions: readonly string[];
}): void {
  const decision = evaluatePluginStaticCapability({
    context: { permissions: input.permissions },
    request: {
      kind: "permission",
      operation: input.operation,
      permission: input.permission,
    },
  });
  if (!decision.allowed) {
    input.diagnostics.push(`${input.field} requires ${input.permission}`);
  }
}

function normalizeCronRegistrations(input: {
  diagnostics: string[];
  limit: number;
  permissions: readonly string[];
  pluginId: string | null;
  raw: unknown;
}): PluginStartupCronRegistration[] {
  const field = "crons";
  const rawEntries = input.raw ?? [];
  if (!Array.isArray(rawEntries)) {
    input.diagnostics.push(`${field} must be an array`);
    return [];
  }
  if (rawEntries.length > 0) {
    pushCapabilityDiagnostic({
      diagnostics: input.diagnostics,
      field,
      operation: "cron.create",
      permission: PLUGIN_CRON_CREATE_PERMISSION,
      permissions: input.permissions,
    });
  }
  if (rawEntries.length > input.limit) {
    input.diagnostics.push(
      `${field} must contain at most ${input.limit} registrations`,
    );
  }
  if (rawEntries.length > 0 && !input.pluginId) {
    input.diagnostics.push(
      "plugin.pluginId is required to derive plugin cron keys",
    );
  }

  const seenKeys = new Set<string>();
  const registrations: PluginStartupCronRegistration[] = [];
  rawEntries.forEach((item, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(item)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }
    const key = validateRequiredString(
      item.key,
      `${path}.key`,
      input.diagnostics,
    );
    const schedule = validateRequiredString(
      item.schedule,
      `${path}.schedule`,
      input.diagnostics,
    );
    const timeoutMs = validateRequiredTimeout(
      item.timeoutMs,
      path,
      input.diagnostics,
    );
    const actionHandle = validateRequiredString(
      item.actionHandle,
      `${path}.actionHandle`,
      input.diagnostics,
    );
    if (!key || !schedule || timeoutMs === null || !actionHandle) {
      return;
    }
    if (key.includes(":")) {
      input.diagnostics.push(`${path}.key must not contain ':'`);
    }
    if (seenKeys.has(key)) {
      input.diagnostics.push(`${path}.key duplicates ${key}`);
    }
    seenKeys.add(key);
    if (!isValidCronSchedule(schedule)) {
      input.diagnostics.push(`${path}.schedule must be a valid cron schedule`);
    }
    registrations.push({
      actionHandle,
      fullKey: `${input.pluginId ?? ""}:${key}`,
      key,
      schedule,
      scope: "global",
      timeoutMs,
    });
  });

  return registrations;
}

function normalizeProviderRegistrations(input: {
  declaredIds: Set<string>;
  diagnostics: string[];
  field: string;
  limit: number;
  permission: string;
  permissions: readonly string[];
  raw: unknown;
}): PluginStartupProviderRegistration[] {
  if (input.raw === undefined) {
    return [];
  }
  if (!Array.isArray(input.raw)) {
    input.diagnostics.push(`${input.field} must be an array`);
    return [];
  }
  if (input.raw.length > 0) {
    pushCapabilityDiagnostic({
      diagnostics: input.diagnostics,
      field: input.field,
      operation: `${input.field}.register`,
      permission: input.permission,
      permissions: input.permissions,
    });
  }
  if (input.raw.length > input.limit) {
    input.diagnostics.push(
      `${input.field} must contain at most ${input.limit} registrations`,
    );
  }

  const seenIds = new Set<string>();
  let configurationCount = 0;
  const registrations: PluginStartupProviderRegistration[] = [];
  input.raw.forEach((item, index) => {
    const path = `${input.field}[${index}]`;
    if (!isRecord(item)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }
    if (typeof item.id !== "string" || item.id.length === 0) {
      input.diagnostics.push(`${path}.id must be a non-empty string`);
      return;
    }
    if (seenIds.has(item.id)) {
      input.diagnostics.push(`${path}.id duplicates ${item.id}`);
    }
    seenIds.add(item.id);
    if (!input.declaredIds.has(item.id)) {
      input.diagnostics.push(
        `${path}.id ${item.id} is not declared by the plugin manifest`,
      );
    }
    const configurations = normalizeModelProviderConfigurations({
      diagnostics: input.diagnostics,
      path,
      raw: item.configurations,
    });
    configurationCount += configurations.length;
    const embedHandle = validateOptionalString(item.embedHandle);
    registrations.push({
      configurations,
      ...(embedHandle ? { embedHandle } : {}),
      executeHandle: validateOptionalString(item.executeHandle),
      getProviderConfigurationsHandle: validateOptionalString(
        item.getProviderConfigurationsHandle,
      ),
      id: item.id,
      refreshIntervalMs: validateOptionalPositiveInteger(
        item.refreshIntervalMs,
        `${path}.refreshIntervalMs`,
        input.diagnostics,
      ),
      timeoutMs: validateTimeout(item.timeoutMs, path, input.diagnostics),
    });
  });
  if (configurationCount > PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT) {
    input.diagnostics.push(
      `${input.field} configurations must contain at most ${PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT} entries`,
    );
  }

  return registrations;
}

function normalizeNotificationProviderRegistrations(input: {
  declaredIds: Set<string>;
  diagnostics: string[];
  limit: number;
  permissions: readonly string[];
  raw: unknown;
}): PluginStartupNotificationProviderRegistration[] {
  const field = "notificationProviders";
  if (input.raw === undefined) {
    return [];
  }
  if (!Array.isArray(input.raw)) {
    input.diagnostics.push(`${field} must be an array`);
    return [];
  }
  if (input.raw.length > 0) {
    const decision = evaluatePluginStaticCapability({
      context: { permissions: input.permissions },
      request: { kind: "notification", operation: "provider" },
    });
    if (!decision.allowed) {
      input.diagnostics.push(
        `${field} requires ${PLUGIN_NOTIFICATION_PROVIDER_PERMISSION}`,
      );
    }
  }
  if (input.raw.length > input.limit) {
    input.diagnostics.push(
      `${field} must contain at most ${input.limit} registrations`,
    );
  }

  const seenIds = new Set<string>();
  const registrations: PluginStartupNotificationProviderRegistration[] = [];
  input.raw.forEach((item, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(item)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }
    const id = validateRequiredString(item.id, `${path}.id`, input.diagnostics);
    const sendHandle = validateRequiredString(
      item.sendHandle,
      `${path}.sendHandle`,
      input.diagnostics,
    );
    const timeoutMs = validateRequiredTimeout(
      item.timeoutMs,
      path,
      input.diagnostics,
    );
    if (!id || !sendHandle || timeoutMs === null) {
      return;
    }
    if (seenIds.has(id)) {
      input.diagnostics.push(`${path}.id duplicates ${id}`);
    }
    seenIds.add(id);
    if (!input.declaredIds.has(id)) {
      input.diagnostics.push(
        `${path}.id ${id} is not declared by the plugin manifest`,
      );
    }
    registrations.push({ id, sendHandle, timeoutMs });
  });

  return registrations;
}

function normalizeOAuthProviderRegistrations(input: {
  declaredIds: Set<string>;
  diagnostics: string[];
  limit: number;
  permissions: readonly string[];
  raw: unknown;
}): PluginStartupOAuthProviderRegistration[] {
  const field = "oauthProviders";
  if (input.raw === undefined) {
    return [];
  }
  if (!Array.isArray(input.raw)) {
    input.diagnostics.push(`${field} must be an array`);
    return [];
  }
  if (input.raw.length > 0) {
    const decision = evaluatePluginStaticCapability({
      context: { permissions: input.permissions },
      request: {
        kind: "provider",
        operation: "oauth",
        permission: PLUGIN_OAUTH_PROVIDER_PERMISSION,
      },
    });
    if (!decision.allowed) {
      input.diagnostics.push(
        `${field} requires ${PLUGIN_OAUTH_PROVIDER_PERMISSION}`,
      );
    }
  }
  if (input.raw.length > input.limit) {
    input.diagnostics.push(
      `${field} must contain at most ${input.limit} registrations`,
    );
  }

  const seenIds = new Set<string>();
  const registrations: PluginStartupOAuthProviderRegistration[] = [];
  input.raw.forEach((item, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(item)) {
      input.diagnostics.push(`${path} must be an object`);
      return;
    }
    const id = validateRequiredString(item.id, `${path}.id`, input.diagnostics);
    const provider = validateRequiredString(
      item.provider,
      `${path}.provider`,
      input.diagnostics,
    );
    const timeoutMs = validateRequiredTimeout(
      item.timeoutMs,
      path,
      input.diagnostics,
    );
    const importCredentialsHandle = validateOptionalString(
      item.importCredentialsHandle,
    );
    const refreshHandle = validateOptionalString(item.refreshHandle);
    if (!id || !provider || timeoutMs === null) {
      return;
    }
    if (seenIds.has(id)) {
      input.diagnostics.push(`${path}.id duplicates ${id}`);
    }
    seenIds.add(id);
    if (!input.declaredIds.has(id)) {
      input.diagnostics.push(
        `${path}.id ${id} is not declared by the plugin manifest`,
      );
    }
    if (!importCredentialsHandle && !refreshHandle) {
      input.diagnostics.push(
        `${path} must provide importCredentialsHandle or refreshHandle`,
      );
    }
    registrations.push({
      id,
      importCredentialsHandle,
      provider,
      refreshHandle,
      timeoutMs,
    });
  });

  return registrations;
}

function normalizeGcRegistration(
  raw: unknown,
  plugin: RpcPluginInventoryPlugin,
  diagnostics: string[],
): PluginStartupGcRegistration | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const registration = Array.isArray(raw) ? raw[0] : raw;
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return null;
    }
    if (raw.length > 1) {
      diagnostics.push("gc supports only one registration");
    }
  }
  if (!isRecord(registration)) {
    diagnostics.push("gc must be an object when present");
    return null;
  }
  if (plugin.manifest.gc?.enabled !== true) {
    diagnostics.push("gc is not enabled by the plugin manifest");
  }
  const actionHandle = validateRequiredString(
    registration.actionHandle,
    "gc.actionHandle",
    diagnostics,
  );
  return {
    actionHandle: actionHandle ?? "",
    timeoutMs: validateTimeout(registration.timeoutMs, "gc", diagnostics),
  };
}

export function validatePluginStartupRegistrations(
  rawRegistrations: unknown,
  plugin: RpcPluginInventoryPlugin,
): PluginStartupRegistrations {
  const diagnostics: string[] = [];
  if (rawRegistrations === undefined || rawRegistrations === null) {
    return {
      crons: [],
      gc: null,
      ingressSources: [],
      modelProviders: [],
      notificationProviders: [],
      oauthProviders: [],
      injections: [],
      tools: [],
    };
  }
  if (!isRecord(rawRegistrations)) {
    throw new PluginStartupRegistrationValidationError([
      "registrations must be an object",
    ]);
  }

  const allowedFields = new Set([
    "crons",
    "gc",
    "ingressSources",
    "modelProviders",
    "notificationProviders",
    "oauthProviders",
    "injections",
    "tools",
  ]);
  for (const fieldName of Object.keys(rawRegistrations)) {
    if (!allowedFields.has(fieldName)) {
      diagnostics.push(`${fieldName} is not a supported registration field`);
    }
  }

  const registrations: PluginStartupRegistrations = {
    crons: normalizeCronRegistrations({
      diagnostics,
      limit: PLUGIN_STARTUP_CRON_REGISTRATION_LIMIT,
      permissions: Array.isArray(plugin.manifest.permissions)
        ? plugin.manifest.permissions
        : [],
      pluginId: plugin.pluginId,
      raw: rawRegistrations.crons,
    }),
    gc: normalizeGcRegistration(rawRegistrations.gc, plugin, diagnostics),
    ingressSources: normalizeIngressSourceRegistrations({
      declaredSources: new Map(
        (plugin.manifest.ingressSources ?? []).map((source) => [
          source.id,
          source,
        ]),
      ),
      diagnostics,
      permissions: Array.isArray(plugin.manifest.permissions)
        ? plugin.manifest.permissions
        : [],
      raw: rawRegistrations.ingressSources,
    }),
    modelProviders: normalizeProviderRegistrations({
      declaredIds: declaredProviderIds(plugin.manifest.providers),
      diagnostics,
      field: "modelProviders",
      limit: PLUGIN_STARTUP_MODEL_PROVIDER_REGISTRATION_LIMIT,
      permission: PLUGIN_MODEL_PROVIDER_PERMISSION,
      permissions: Array.isArray(plugin.manifest.permissions)
        ? plugin.manifest.permissions
        : [],
      raw: rawRegistrations.modelProviders,
    }),
    notificationProviders: normalizeNotificationProviderRegistrations({
      declaredIds: declaredProviderIds(plugin.manifest.notificationProviders),
      diagnostics,
      limit: PLUGIN_STARTUP_NOTIFICATION_PROVIDER_REGISTRATION_LIMIT,
      permissions: Array.isArray(plugin.manifest.permissions)
        ? plugin.manifest.permissions
        : [],
      raw: rawRegistrations.notificationProviders,
    }),
    oauthProviders: normalizeOAuthProviderRegistrations({
      declaredIds: declaredProviderIds(plugin.manifest.oauthProviders ?? []),
      diagnostics,
      limit: PLUGIN_STARTUP_OAUTH_PROVIDER_REGISTRATION_LIMIT,
      permissions: Array.isArray(plugin.manifest.permissions)
        ? plugin.manifest.permissions
        : [],
      raw: rawRegistrations.oauthProviders,
    }),
    injections: normalizeInjectionRegistrations({
      declaredNames: declaredInjectionNames(plugin),
      diagnostics,
      permissions: Array.isArray(plugin.manifest.permissions)
        ? plugin.manifest.permissions
        : [],
      raw: rawRegistrations.injections,
    }),
    tools: normalizeToolRegistrations({
      declaredNames: declaredToolNames(plugin),
      diagnostics,
      limit: PLUGIN_STARTUP_TOOL_REGISTRATION_LIMIT,
      pluginId: plugin.pluginId,
      raw: rawRegistrations.tools,
    }),
  };

  if (diagnostics.length > 0) {
    throw new PluginStartupRegistrationValidationError(diagnostics);
  }
  return registrations;
}

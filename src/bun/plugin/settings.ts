/**
 * @file src/bun/plugin/settings.ts
 * @description Plugin System v1 Plugin Settings persistence.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  AuthSecretAccessError,
  buildLocalOperatorAuthSecretAdditionalData,
  buildUserScopedAuthSecretAdditionalData,
  decryptAuthSecret,
  encryptAuthSecret,
} from "../auth/secrets";
import { type AppDataPathOptions, getAppDataDirectoryPath } from "../db";
import type {
  RpcPluginManifestSettingDefault,
  RpcPluginManifestSettingSummary,
  RpcPluginSettingsSnapshot,
  RpcPluginSettingValueSummary,
} from "../rpc-schema/plugin";

const PLUGIN_SETTINGS_STATE_FILE_NAME = "plugin-settings-v1.json";
const PLUGIN_SETTINGS_STATE_SCHEMA = "metidos.plugin-settings/v3" as const;
const PLUGIN_SETTINGS_STATE_VERSION = 3;
const DATE_SETTING_VALUE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const EMAIL_SETTING_ITEM_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PluginSettingValue = RpcPluginManifestSettingDefault;

type EncryptedPluginSettingValue = {
  algorithm?: "AES-GCM";
  ciphertext: string;
  encrypted: true;
  encoding?: "utf8";
  keyId?: string | null;
  plaintextKind?: "boolean" | "number" | "string";
  tag?: string | null;
  version?: string;
};

type StoredPluginSettingValue =
  | EncryptedPluginSettingValue
  | PluginSettingValue;

type StoredPluginSettingsRecord = {
  pluginId: string | null;
  values: Record<string, StoredPluginSettingValue>;
  /**
   * Non-serialized compatibility metadata for encrypted values filled from old
   * per-user buckets. The v3 migration re-encrypts these values with the
   * unified Plugin Settings additional data the first time they are read.
   */
  legacySecretUserIds?: Record<string, number>;
};

type PluginSettingsStateFile = {
  plugins: Record<string, StoredPluginSettingsRecord>;
  schema: typeof PLUGIN_SETTINGS_STATE_SCHEMA;
  version: typeof PLUGIN_SETTINGS_STATE_VERSION;
};

export class PluginSettingsError extends Error {
  readonly code:
    | "invalid_setting_key"
    | "invalid_setting_value"
    | "invalid_settings_patch";

  constructor(input: {
    code: PluginSettingsError["code"];
    message: string;
  }) {
    super(input.message);
    this.name = "PluginSettingsError";
    this.code = input.code;
  }
}

function pluginSettingsStateFilePath(options?: AppDataPathOptions): string {
  return join(
    getAppDataDirectoryPath(options),
    PLUGIN_SETTINGS_STATE_FILE_NAME,
  );
}

function emptyStateFile(): PluginSettingsStateFile {
  return {
    plugins: {},
    schema: PLUGIN_SETTINGS_STATE_SCHEMA,
    version: PLUGIN_SETTINGS_STATE_VERSION,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSettingValue(value: unknown): value is PluginSettingValue {
  if (value === null) {
    return true;
  }
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" ||
        (typeof item === "number" && Number.isFinite(item)),
    )
  );
}

function isEncryptedPluginSettingValue(
  value: unknown,
): value is EncryptedPluginSettingValue {
  if (!isRecord(value) || value.encrypted !== true) {
    return false;
  }
  return typeof value.ciphertext === "string" && value.ciphertext.length > 0;
}

function normalizeStoredValues(
  value: unknown,
): Record<string, StoredPluginSettingValue> {
  if (!isRecord(value)) {
    return {};
  }
  const entries: [string, StoredPluginSettingValue][] = [];
  for (const [key, storedValue] of Object.entries(value)) {
    if (
      isSettingValue(storedValue) ||
      isEncryptedPluginSettingValue(storedValue)
    ) {
      entries.push([key, storedValue]);
    }
  }
  return Object.fromEntries(entries);
}

function sortedLegacyUserEntries(
  record: Record<string, Record<string, StoredPluginSettingValue>>,
): Array<[number, Record<string, StoredPluginSettingValue>]> {
  return Object.entries(record)
    .flatMap(([userId, values]) => {
      const parsedUserId = Number(userId);
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
        return [];
      }
      return [
        [parsedUserId, values] satisfies [
          number,
          Record<string, StoredPluginSettingValue>,
        ],
      ];
    })
    .sort(([left], [right]) => left - right);
}

function normalizeLegacyUsers(
  value: unknown,
): Record<string, Record<string, StoredPluginSettingValue>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([userId, storedValues]) => [
      userId,
      normalizeStoredValues(storedValues),
    ]),
  );
}

function normalizeLegacyStoredRecord(
  value: unknown,
): StoredPluginSettingsRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const values: Record<string, StoredPluginSettingValue> = {
    ...normalizeStoredValues(value.global),
    ...normalizeStoredValues(value.local),
  };
  const legacySecretUserIds: Record<string, number> = {};
  const users = {
    ...normalizeLegacyUsers(value.users),
    ...normalizeLegacyUsers(value.legacyUsers),
  };
  for (const [legacyUserId, legacyValues] of sortedLegacyUserEntries(users)) {
    for (const [key, storedValue] of Object.entries(legacyValues)) {
      if (Object.hasOwn(values, key)) {
        continue;
      }
      values[key] = storedValue;
      if (isEncryptedPluginSettingValue(storedValue)) {
        legacySecretUserIds[key] = legacyUserId;
      }
    }
  }
  return {
    ...(Object.keys(legacySecretUserIds).length === 0
      ? {}
      : { legacySecretUserIds }),
    pluginId: typeof value.pluginId === "string" ? value.pluginId : null,
    values,
  };
}

function normalizeStoredRecord(
  value: unknown,
): StoredPluginSettingsRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (isRecord(value.values)) {
    return {
      pluginId: typeof value.pluginId === "string" ? value.pluginId : null,
      values: normalizeStoredValues(value.values),
    };
  }
  return normalizeLegacyStoredRecord(value);
}

async function readPluginSettingsStateFile(
  options?: AppDataPathOptions,
): Promise<PluginSettingsStateFile> {
  try {
    const raw = await readFile(pluginSettingsStateFilePath(options), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.plugins)) {
      return emptyStateFile();
    }
    const plugins: Record<string, StoredPluginSettingsRecord> = {};
    for (const [directoryName, record] of Object.entries(parsed.plugins)) {
      const normalizedRecord = normalizeStoredRecord(record);
      if (normalizedRecord) {
        plugins[directoryName] = normalizedRecord;
      }
    }
    return {
      plugins,
      schema: PLUGIN_SETTINGS_STATE_SCHEMA,
      version: PLUGIN_SETTINGS_STATE_VERSION,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyStateFile();
    }
    throw error;
  }
}

function serializePluginSettingsStateFile(
  stateFile: PluginSettingsStateFile,
): PluginSettingsStateFile {
  return {
    plugins: Object.fromEntries(
      Object.entries(stateFile.plugins).map(([directoryName, record]) => [
        directoryName,
        {
          pluginId: record.pluginId,
          values: record.values,
        },
      ]),
    ),
    schema: PLUGIN_SETTINGS_STATE_SCHEMA,
    version: PLUGIN_SETTINGS_STATE_VERSION,
  };
}

async function writePluginSettingsStateFile(
  stateFile: PluginSettingsStateFile,
  options?: AppDataPathOptions,
): Promise<void> {
  const filePath = pluginSettingsStateFilePath(options);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(serializePluginSettingsStateFile(stateFile), null, 2)}\n`,
  );
}

function ensurePluginSettingsRecord(input: {
  directoryName: string;
  pluginId: string | null;
  stateFile: PluginSettingsStateFile;
}): StoredPluginSettingsRecord {
  const existing = input.stateFile.plugins[input.directoryName];
  if (existing) {
    existing.pluginId = input.pluginId;
    return existing;
  }
  const record: StoredPluginSettingsRecord = {
    pluginId: input.pluginId,
    values: {},
  };
  input.stateFile.plugins[input.directoryName] = record;
  return record;
}

function declarationByKey(
  declarations: RpcPluginManifestSettingSummary[],
): Map<string, RpcPluginManifestSettingSummary> {
  return new Map(
    declarations.flatMap((declaration) =>
      declaration.key ? [[declaration.key, declaration]] : [],
    ),
  );
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidListItem(kind: string | null, value: unknown): boolean {
  switch (kind) {
    case "email":
      return (
        typeof value === "string" && EMAIL_SETTING_ITEM_PATTERN.test(value)
      );
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "url":
      return typeof value === "string" && isValidUrl(value);
    default:
      return typeof value === "string";
  }
}

function assertSettingValueMatchesDeclaration(input: {
  declaration: RpcPluginManifestSettingSummary;
  key: string;
  value: PluginSettingValue;
}): void {
  const { declaration, key, value } = input;
  if (value === null) {
    return;
  }
  switch (declaration.kind) {
    case "string":
      if (typeof value === "string") return;
      break;
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) return;
      break;
    case "boolean":
      if (typeof value === "boolean") return;
      break;
    case "enum":
      if (
        typeof value === "string" &&
        (declaration.options.length === 0 ||
          declaration.options.includes(value))
      ) {
        return;
      }
      break;
    case "secret":
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return;
      }
      break;
    case "url":
      if (typeof value === "string" && isValidUrl(value)) return;
      break;
    case "date":
      if (typeof value === "string" && DATE_SETTING_VALUE_PATTERN.test(value)) {
        return;
      }
      break;
    case "list":
      if (
        Array.isArray(value) &&
        value.every((item) =>
          isValidListItem(declaration.items?.kind ?? null, item),
        )
      ) {
        return;
      }
      break;
  }
  throw new PluginSettingsError({
    code: "invalid_setting_value",
    message: `Plugin setting ${key} does not match declared ${declaration.kind} type.`,
  });
}

function normalizeSettingPatch(input: {
  declarations: RpcPluginManifestSettingSummary[];
  patch: unknown;
}): Record<string, PluginSettingValue> {
  if (!isRecord(input.patch)) {
    throw new PluginSettingsError({
      code: "invalid_settings_patch",
      message: "Plugin settings patch must be an object.",
    });
  }
  const declarations = declarationByKey(input.declarations);
  const normalized: Record<string, PluginSettingValue> = {};
  for (const [key, value] of Object.entries(input.patch)) {
    const declaration = declarations.get(key);
    if (!declaration) {
      throw new PluginSettingsError({
        code: "invalid_setting_key",
        message: `Plugin setting ${key} is not declared.`,
      });
    }
    if (!isSettingValue(value)) {
      throw new PluginSettingsError({
        code: "invalid_setting_value",
        message: `Plugin setting ${key} has an unsupported value type.`,
      });
    }
    assertSettingValueMatchesDeclaration({ declaration, key, value });
    normalized[key] = value;
  }
  return normalized;
}

function pluginSecretAdditionalData(input: {
  directoryName: string;
  key: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `metidos.plugin-setting:${input.directoryName}:${input.key}`,
  );
}

function legacySecretAdditionalDataCandidates(input: {
  directoryName: string;
  key: string;
  legacyUserId?: number | undefined;
}): Uint8Array[] {
  const label = `metidos.plugin-setting:${input.directoryName}:${input.key}`;
  const candidates = [
    buildLocalOperatorAuthSecretAdditionalData(
      `metidos.plugin-setting:${input.directoryName}:local:${input.key}`,
    ),
    new TextEncoder().encode(
      `metidos.plugin-setting:${input.directoryName}:global:${input.key}`,
    ),
  ];
  if (input.legacyUserId !== undefined) {
    candidates.push(
      buildUserScopedAuthSecretAdditionalData(label, input.legacyUserId),
    );
  }
  return candidates;
}

function plaintextKindForValue(
  value: PluginSettingValue,
): EncryptedPluginSettingValue["plaintextKind"] {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

async function encryptStoredSecretValue(input: {
  directoryName: string;
  key: string;
  options?: AppDataPathOptions | undefined;
  value: PluginSettingValue;
}): Promise<StoredPluginSettingValue> {
  if (input.value === null || Array.isArray(input.value)) {
    return input.value;
  }
  const ciphertext = await encryptAuthSecret(JSON.stringify(input.value), {
    additionalData: pluginSecretAdditionalData(input),
    ...(input.options?.appDataDir === undefined
      ? {}
      : { appDataDir: input.options.appDataDir }),
  });
  const plaintextKind = plaintextKindForValue(input.value);
  return {
    algorithm: "AES-GCM",
    ciphertext,
    encrypted: true,
    encoding: "utf8",
    ...(plaintextKind === undefined ? {} : { plaintextKind }),
    version: "v1",
  };
}

async function encryptSecretSettingsInPatch(input: {
  declarations: RpcPluginManifestSettingSummary[];
  directoryName: string;
  normalizedPatch: Record<string, PluginSettingValue>;
  options?: AppDataPathOptions | undefined;
}): Promise<Record<string, StoredPluginSettingValue>> {
  const declarations = declarationByKey(input.declarations);
  const encryptedPatch: Record<string, StoredPluginSettingValue> = {};
  for (const [key, value] of Object.entries(input.normalizedPatch)) {
    if (declarations.get(key)?.kind === "secret") {
      encryptedPatch[key] = await encryptStoredSecretValue({
        directoryName: input.directoryName,
        key,
        options: input.options,
        value,
      });
    } else {
      encryptedPatch[key] = value;
    }
  }
  return encryptedPatch;
}

function applySettingsPatchToStoredValues(input: {
  declarations: RpcPluginManifestSettingSummary[];
  encryptedPatch: Record<string, StoredPluginSettingValue>;
  normalizedPatch: Record<string, PluginSettingValue>;
  storedValues: Record<string, StoredPluginSettingValue>;
}): void {
  const declarations = declarationByKey(input.declarations);
  for (const [key, value] of Object.entries(input.encryptedPatch)) {
    if (
      declarations.get(key)?.kind === "secret" &&
      input.normalizedPatch[key] === null
    ) {
      delete input.storedValues[key];
      continue;
    }
    input.storedValues[key] = value;
  }
}

function pluginSecretReadFailureReason(error: unknown): string {
  if (error instanceof AuthSecretAccessError) {
    return "The encrypted value could not be decrypted with the current auth-secret.key.";
  }
  if (error instanceof SyntaxError) {
    return "The decrypted value was not valid JSON.";
  }
  return error instanceof Error ? error.message : String(error);
}

function pluginSecretReadWarning(input: {
  directoryName: string;
  error: unknown;
  key: string;
}): void {
  console.warn(
    `Plugin secret setting ${input.directoryName}/${input.key} could not be read and will be treated as unset. Save the setting again to repair it. ${pluginSecretReadFailureReason(input.error)}`,
  );
}

function plaintextSecretWarning(input: {
  directoryName: string;
  key: string;
}): void {
  console.warn(
    `Plugin secret setting ${input.directoryName}/${input.key} is stored as plaintext. Save the setting again to encrypt it at rest.`,
  );
}

type DecryptedSecret = {
  migrated: boolean;
  value: PluginSettingValue;
};

async function decryptWithAdditionalData(input: {
  additionalData: Uint8Array;
  options?: AppDataPathOptions | undefined;
  value: EncryptedPluginSettingValue;
}): Promise<PluginSettingValue> {
  const plaintext = await decryptAuthSecret(input.value.ciphertext, {
    additionalData: input.additionalData,
    ...(input.options?.appDataDir === undefined
      ? {}
      : { appDataDir: input.options.appDataDir }),
  });
  const parsed: unknown = JSON.parse(plaintext);
  return isSettingValue(parsed) ? parsed : null;
}

async function decryptStoredSecretValue(input: {
  directoryName: string;
  key: string;
  legacyUserId?: number | undefined;
  options?: AppDataPathOptions | undefined;
  value: StoredPluginSettingValue;
}): Promise<DecryptedSecret> {
  if (!isEncryptedPluginSettingValue(input.value)) {
    plaintextSecretWarning(input);
    return { migrated: true, value: input.value };
  }
  let lastError: unknown = null;
  const currentAdditionalData = pluginSecretAdditionalData(input);
  try {
    return {
      migrated: false,
      value: await decryptWithAdditionalData({
        additionalData: currentAdditionalData,
        options: input.options,
        value: input.value,
      }),
    };
  } catch (error) {
    lastError = error;
    if (!(error instanceof AuthSecretAccessError)) {
      if (error instanceof SyntaxError) {
        pluginSecretReadWarning({ ...input, error });
        return { migrated: false, value: null };
      }
      throw error;
    }
  }

  for (const additionalData of legacySecretAdditionalDataCandidates(input)) {
    try {
      return {
        migrated: true,
        value: await decryptWithAdditionalData({
          additionalData,
          options: input.options,
          value: input.value,
        }),
      };
    } catch (error) {
      lastError = error;
      if (!(error instanceof AuthSecretAccessError)) {
        if (error instanceof SyntaxError) {
          pluginSecretReadWarning({ ...input, error });
          return { migrated: false, value: null };
        }
        throw error;
      }
    }
  }

  pluginSecretReadWarning({ ...input, error: lastError });
  return { migrated: false, value: null };
}

type MaterializedStoredValues = {
  migrated: boolean;
  values: Record<string, PluginSettingValue>;
};

async function materializeStoredValues(input: {
  declarations: RpcPluginManifestSettingSummary[];
  directoryName: string;
  options?: AppDataPathOptions | undefined;
  record: StoredPluginSettingsRecord | null | undefined;
}): Promise<MaterializedStoredValues> {
  let migrated = false;
  const values: Record<string, PluginSettingValue> = {};
  const declarations = declarationByKey(input.declarations);
  const storedValues = input.record?.values ?? {};
  for (const [key, storedValue] of Object.entries(storedValues)) {
    const declaration = declarations.get(key);
    if (declaration?.kind === "secret") {
      const decrypted = await decryptStoredSecretValue({
        directoryName: input.directoryName,
        key,
        legacyUserId: input.record?.legacySecretUserIds?.[key],
        options: input.options,
        value: storedValue,
      });
      values[key] = decrypted.value;
      if (decrypted.migrated) {
        storedValues[key] = await encryptStoredSecretValue({
          directoryName: input.directoryName,
          key,
          options: input.options,
          value: decrypted.value,
        });
        migrated = true;
      }
    } else if (isSettingValue(storedValue)) {
      values[key] = storedValue;
    }
  }
  if (input.record?.legacySecretUserIds) {
    delete input.record.legacySecretUserIds;
    migrated = true;
  }
  return { migrated, values };
}

function settingSummaries(input: {
  declarations: RpcPluginManifestSettingSummary[];
  readableSecrets: boolean;
  storedValues: Record<string, PluginSettingValue>;
}): RpcPluginSettingValueSummary[] {
  return input.declarations.map((declaration) => {
    const key = declaration.key ?? "";
    const hasStoredValue = key.length > 0 && key in input.storedValues;
    const secret = declaration.kind === "secret";
    const readable = !secret || input.readableSecrets;
    const value: PluginSettingValue = hasStoredValue
      ? (input.storedValues[key] as PluginSettingValue)
      : declaration.defaultValue;
    return {
      defaultValue: readable ? declaration.defaultValue : null,
      hasDefault: declaration.hasDefault,
      hasStoredValue,
      key: declaration.key,
      kind: declaration.kind,
      readable,
      secret,
      value: readable ? value : null,
    };
  });
}

export async function readPluginSettingsSnapshot(input: {
  declarations: RpcPluginManifestSettingSummary[];
  directoryName: string;
  pluginId: string | null;
  options?: AppDataPathOptions | undefined;
  readableSecrets?: boolean;
}): Promise<RpcPluginSettingsSnapshot> {
  const stateFile = await readPluginSettingsStateFile(input.options);
  const record = stateFile.plugins[input.directoryName];
  const materialized = await materializeStoredValues({
    declarations: input.declarations,
    directoryName: input.directoryName,
    options: input.options,
    record,
  });
  if (materialized.migrated) {
    await writePluginSettingsStateFile(stateFile, input.options);
  }
  return {
    directoryName: input.directoryName,
    pluginId: record?.pluginId ?? input.pluginId,
    settings: settingSummaries({
      declarations: input.declarations,
      readableSecrets: input.readableSecrets === true,
      storedValues: materialized.values,
    }),
  };
}

export type PluginRuntimeSettings = {
  missingRequiredKeys: string[];
  values: Record<string, PluginSettingValue>;
};

function runtimeSettings(input: {
  declarations: RpcPluginManifestSettingSummary[];
  storedValues: Record<string, PluginSettingValue>;
}): PluginRuntimeSettings {
  const values: Record<string, PluginSettingValue> = {};
  const missingRequiredKeys: string[] = [];
  for (const declaration of input.declarations) {
    const key = declaration.key;
    if (!key) {
      continue;
    }
    const hasStoredValue = Object.hasOwn(input.storedValues, key);
    const value = hasStoredValue
      ? (input.storedValues[key] as PluginSettingValue)
      : declaration.defaultValue;
    values[key] = value;
    if (declaration.required === true && value === null) {
      missingRequiredKeys.push(key);
    }
  }
  missingRequiredKeys.sort();
  return { missingRequiredKeys, values };
}

export async function readPluginSettingsForRuntime(input: {
  declarations: RpcPluginManifestSettingSummary[];
  directoryName: string;
  options?: AppDataPathOptions | undefined;
}): Promise<PluginRuntimeSettings> {
  const stateFile = await readPluginSettingsStateFile(input.options);
  const record = stateFile.plugins[input.directoryName];
  const materialized = await materializeStoredValues({
    declarations: input.declarations,
    directoryName: input.directoryName,
    options: input.options,
    record,
  });
  if (materialized.migrated || (record && record.values !== undefined)) {
    await writePluginSettingsStateFile(stateFile, input.options);
  }
  return runtimeSettings({
    declarations: input.declarations,
    storedValues: materialized.values,
  });
}

export async function updatePluginSettings(input: {
  declarations: RpcPluginManifestSettingSummary[];
  directoryName: string;
  patch: unknown;
  pluginId: string | null;
  options?: AppDataPathOptions;
}): Promise<Record<string, PluginSettingValue>> {
  const normalizedPatch = normalizeSettingPatch({
    declarations: input.declarations,
    patch: input.patch,
  });
  const encryptedPatch = await encryptSecretSettingsInPatch({
    declarations: input.declarations,
    directoryName: input.directoryName,
    normalizedPatch,
    options: input.options,
  });
  const stateFile = await readPluginSettingsStateFile(input.options);
  const record = ensurePluginSettingsRecord({
    directoryName: input.directoryName,
    pluginId: input.pluginId,
    stateFile,
  });
  applySettingsPatchToStoredValues({
    declarations: input.declarations,
    encryptedPatch,
    normalizedPatch,
    storedValues: record.values,
  });
  await writePluginSettingsStateFile(stateFile, input.options);
  return (
    await materializeStoredValues({
      declarations: input.declarations,
      directoryName: input.directoryName,
      options: input.options,
      record,
    })
  ).values;
}

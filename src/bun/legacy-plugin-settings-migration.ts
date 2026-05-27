/**
 * @file src/bun/legacy-plugin-settings-migration.ts
 * @description Migrates legacy built-in weather and ntfy settings into plugins.
 */

import type { Database } from "bun:sqlite";

import { decryptLegacyAuthSecretForMigration } from "./auth/secrets";
import type { AppDataPathOptions } from "./db";
import { updatePluginSettings } from "./plugin/settings";
import type {
  RpcPluginManifestSettingDefault,
  RpcPluginManifestSettingSummary,
} from "./rpc-schema";

type LegacyWeatherSettingsRow = {
  coordinates: string;
  userId: number;
};

type LegacyNtfySettingsRow = {
  ntfyAuthType: "none" | "bearer" | "basic";
  ntfyEnabled: 0 | 1;
  ntfyPasswordCiphertext: string;
  ntfyPriority: "min" | "low" | "default" | "high" | "urgent";
  ntfyServerUrl: string;
  ntfyTokenCiphertext: string;
  ntfyTopic: string;
  ntfyUsername: string;
  userId: number;
};

export type LegacyPluginSettingsMigrationResult = {
  droppedTables: string[];
  errors: string[];
  migratedNtfyUsers: number;
  migratedWeatherUsers: number;
};

const WEATHER_USER_SETTINGS = [
  setting("coordinates", "Weather coordinates", "string", {
    required: true,
  }),
];

const NTFY_USER_SETTINGS = [
  setting("enabled", "Enabled", "boolean", {
    defaultValue: false,
  }),
  setting("server_url", "ntfy server URL", "url", {
    defaultValue: "https://ntfy.sh",
    required: true,
  }),
  setting("topic", "ntfy topic", "secret"),
  setting("auth_type", "Authentication type", "enum", {
    defaultValue: "none",
    options: ["none", "bearer", "basic"],
  }),
  setting("token", "Bearer token", "secret"),
  setting("username", "Username", "string"),
  setting("password", "Password", "secret"),
  setting("priority", "Priority", "enum", {
    defaultValue: "low",
    options: ["min", "low", "default", "high", "urgent"],
  }),
];

function setting(
  key: string,
  label: string,
  kind: string,
  options?: {
    defaultValue?: RpcPluginManifestSettingDefault;
    options?: string[];
    required?: boolean;
  },
): RpcPluginManifestSettingSummary {
  return {
    defaultValue: options?.defaultValue ?? null,
    description: null,
    hasDefault: options?.defaultValue !== undefined,
    items: null,
    key,
    kind,
    label,
    options: options?.options ?? [],
    required: options?.required ?? false,
  };
}

function tableExists(database: Database, tableName: string): boolean {
  const row = database
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(tableName);
  return typeof row?.name === "string";
}

async function decryptLegacyNtfySecret(
  ciphertext: string,
  options?: AppDataPathOptions,
): Promise<string | null> {
  if (!ciphertext.trim()) {
    return null;
  }
  return decryptLegacyAuthSecretForMigration(ciphertext, {
    ...(options?.appDataDir ? { appDataDir: options.appDataDir } : {}),
  });
}

async function migrateWeatherSettings(
  database: Database,
  errors: string[],
  options?: AppDataPathOptions,
): Promise<number> {
  if (!tableExists(database, "user_weather_settings")) {
    return 0;
  }
  const rows = database
    .query<LegacyWeatherSettingsRow, []>(
      `SELECT user_id AS userId, coordinates FROM user_weather_settings`,
    )
    .all();
  let migrated = 0;
  for (const row of rows) {
    const coordinates = row.coordinates.trim();
    if (!coordinates) {
      continue;
    }
    try {
      await updatePluginSettings({
        declarations: WEATHER_USER_SETTINGS,
        directoryName: "weather",
        ...(options ? { options } : {}),
        patch: { coordinates },
        pluginId: "weather",
      });
      migrated += 1;
    } catch (error) {
      errors.push(
        `Weather settings for user ${row.userId} were not migrated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return migrated;
}

async function migrateNtfySettings(
  database: Database,
  errors: string[],
  options?: AppDataPathOptions,
): Promise<number> {
  if (!tableExists(database, "user_notification_settings")) {
    return 0;
  }
  const rows = database
    .query<LegacyNtfySettingsRow, []>(
      `SELECT user_id AS userId,
        ntfy_enabled AS ntfyEnabled,
        ntfy_server_url AS ntfyServerUrl,
        ntfy_topic AS ntfyTopic,
        ntfy_auth_type AS ntfyAuthType,
        ntfy_token_ciphertext AS ntfyTokenCiphertext,
        ntfy_username AS ntfyUsername,
        ntfy_password_ciphertext AS ntfyPasswordCiphertext,
        ntfy_priority AS ntfyPriority
      FROM user_notification_settings`,
    )
    .all();
  let migrated = 0;
  for (const row of rows) {
    const patch: Record<string, RpcPluginManifestSettingDefault> = {
      auth_type: row.ntfyAuthType,
      enabled: row.ntfyEnabled === 1,
      priority: row.ntfyPriority,
      server_url: row.ntfyServerUrl.trim() || "https://ntfy.sh",
      username: row.ntfyUsername.trim(),
    };
    if (row.ntfyTopic.trim()) {
      patch.topic = row.ntfyTopic.trim();
    }
    try {
      const token = await decryptLegacyNtfySecret(
        row.ntfyTokenCiphertext,
        options,
      );
      if (token) {
        patch.token = token;
      }
    } catch (error) {
      errors.push(
        `ntfy token for user ${row.userId} was not migrated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      const password = await decryptLegacyNtfySecret(
        row.ntfyPasswordCiphertext,
        options,
      );
      if (password) {
        patch.password = password;
      }
    } catch (error) {
      errors.push(
        `ntfy password for user ${row.userId} was not migrated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      await updatePluginSettings({
        declarations: NTFY_USER_SETTINGS,
        directoryName: "ntfy_notification_provider",
        ...(options ? { options } : {}),
        patch,
        pluginId: "ntfy_notification_provider",
      });
      migrated += 1;
    } catch (error) {
      errors.push(
        `ntfy settings for user ${row.userId} were not migrated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return migrated;
}

function quoteSqliteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(trimmed)) {
    throw new Error("SQLite identifier contains unsupported characters.");
  }
  return `"${trimmed}"`;
}

function dropLegacyTables(database: Database): string[] {
  const tables = [
    "user_notification_deliveries",
    "user_notification_settings",
    "user_weather_settings",
  ];
  const droppedTables: string[] = [];
  for (const table of tables) {
    if (tableExists(database, table)) {
      database.run(`DROP TABLE IF EXISTS ${quoteSqliteIdentifier(table)}`);
      droppedTables.push(table);
    }
  }
  return droppedTables;
}

export async function migrateLegacyPluginSettings(
  database: Database,
  options?: AppDataPathOptions,
): Promise<LegacyPluginSettingsMigrationResult> {
  const errors: string[] = [];
  const migratedWeatherUsers = await migrateWeatherSettings(
    database,
    errors,
    options,
  );
  const migratedNtfyUsers = await migrateNtfySettings(
    database,
    errors,
    options,
  );
  const droppedTables = errors.length === 0 ? dropLegacyTables(database) : [];
  return {
    droppedTables,
    errors,
    migratedNtfyUsers,
    migratedWeatherUsers,
  };
}

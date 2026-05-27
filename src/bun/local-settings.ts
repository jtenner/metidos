import type { Database } from "bun:sqlite";

import {
  getEffectiveTimezoneForUser,
  getTimezoneSettings,
  getUserRuntimeSettings,
  resolveSingletonLocalSettingsUserId,
  type TimezoneSettingsRecord,
  type UserRuntimeSettingsRecord,
  updateTimezoneSettings,
  updateUserRuntimeSettings,
} from "./db";

function localSettingsUserId(database: Database): number {
  return resolveSingletonLocalSettingsUserId(database);
}

export function getEffectiveLocalTimezone(database: Database): string {
  return getEffectiveTimezoneForUser(database, localSettingsUserId(database));
}

export function readLocalTimezoneSettings(
  database: Database,
): TimezoneSettingsRecord {
  return getTimezoneSettings(database, localSettingsUserId(database));
}

export function updateLocalTimezoneSettings(
  database: Database,
  input: Partial<Pick<TimezoneSettingsRecord, "timezone">>,
): TimezoneSettingsRecord {
  return updateTimezoneSettings(database, localSettingsUserId(database), input);
}

export function readLocalRuntimeSettings(
  database: Database,
): UserRuntimeSettingsRecord {
  return getUserRuntimeSettings(database, localSettingsUserId(database));
}

export function updateLocalRuntimeSettings(
  database: Database,
  input: Partial<
    Pick<UserRuntimeSettingsRecord, "commandTimeoutSeconds" | "embeddingModel">
  >,
): UserRuntimeSettingsRecord {
  return updateUserRuntimeSettings(
    database,
    localSettingsUserId(database),
    input,
  );
}

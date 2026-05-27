import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";

import { DEFAULT_COMMAND_TIMEOUT_SECONDS, migrateDatabase } from "./db";
import {
  getEffectiveLocalTimezone,
  readLocalRuntimeSettings,
  readLocalTimezoneSettings,
  updateLocalRuntimeSettings,
  updateLocalTimezoneSettings,
} from "./local-settings";

describe("local settings seam", () => {
  it("reads and updates runtime settings without an explicit user id", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    try {
      expect(readLocalRuntimeSettings(database).commandTimeoutSeconds).toBe(
        DEFAULT_COMMAND_TIMEOUT_SECONDS,
      );
      expect(
        updateLocalRuntimeSettings(database, {
          commandTimeoutSeconds: 120,
          embeddingModel: "text-embedding-3-large",
        }),
      ).toMatchObject({
        commandTimeoutSeconds: 120,
        embeddingModel: "text-embedding-3-large",
      });
      expect(readLocalRuntimeSettings(database)).toMatchObject({
        commandTimeoutSeconds: 120,
        embeddingModel: "text-embedding-3-large",
      });
    } finally {
      database.close(false);
    }
  });

  it("reads and updates timezone settings without an explicit user id", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    try {
      expect(
        updateLocalTimezoneSettings(database, { timezone: "UTC" }),
      ).toMatchObject({
        timezone: "UTC",
        effectiveTimezone: "UTC",
      });
      expect(
        updateLocalTimezoneSettings(database, {
          timezone: "America/New_York",
        }),
      ).toMatchObject({
        timezone: "America/New_York",
        effectiveTimezone: "America/New_York",
      });
      expect(readLocalTimezoneSettings(database)).toMatchObject({
        timezone: "America/New_York",
        effectiveTimezone: "America/New_York",
      });
      expect(getEffectiveLocalTimezone(database)).toBe("America/New_York");
    } finally {
      database.close(false);
    }
  });
});

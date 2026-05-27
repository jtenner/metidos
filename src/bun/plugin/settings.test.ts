/**
 * @file src/bun/plugin/settings.test.ts
 * @description Tests for Plugin System v1 Plugin Settings storage.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildUserScopedAuthSecretAdditionalData,
  encryptAuthSecret,
} from "../auth/secrets";
import type { RpcPluginManifestSettingSummary } from "../rpc-schema/plugin";
import {
  readPluginSettingsForRuntime,
  readPluginSettingsSnapshot,
  updatePluginSettings,
} from "./settings";

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

function setting(
  input: Partial<RpcPluginManifestSettingSummary> & {
    key: string;
    kind: string;
  },
): RpcPluginManifestSettingSummary {
  return {
    defaultValue: null,
    description: null,
    hasDefault: false,
    items: null,
    label: input.key,
    options: [],
    required: false,
    ...input,
  };
}

describe("plugin settings persistence", () => {
  it("stores Plugin Settings as one values map", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-settings-");
    const declarations = [
      setting({ key: "refresh_minutes", kind: "number" }),
      setting({ key: "display_name", kind: "string" }),
    ];

    await updatePluginSettings({
      declarations,
      directoryName: "settings_plugin",
      options: { appDataDir },
      patch: { display_name: "Alice", refresh_minutes: 15 },
      pluginId: "settings_plugin",
    });

    const snapshot = await readPluginSettingsSnapshot({
      declarations,
      directoryName: "settings_plugin",
      options: { appDataDir },
      pluginId: "settings_plugin",
    });

    expect(snapshot.settings).toContainEqual(
      expect.objectContaining({
        hasStoredValue: true,
        key: "refresh_minutes",
        value: 15,
      }),
    );
    expect(snapshot.settings).toContainEqual(
      expect.objectContaining({
        hasStoredValue: true,
        key: "display_name",
        value: "Alice",
      }),
    );

    const raw = JSON.parse(
      readFileSync(join(appDataDir, "plugin-settings-v1.json"), "utf8"),
    );
    expect(raw).toMatchObject({
      schema: "metidos.plugin-settings/v3",
      version: 3,
      plugins: {
        settings_plugin: {
          pluginId: "settings_plugin",
          values: {
            display_name: "Alice",
            refresh_minutes: 15,
          },
        },
      },
    });
    expect(raw.plugins.settings_plugin).not.toHaveProperty("global");
    expect(raw.plugins.settings_plugin).not.toHaveProperty("local");
    expect(raw.plugins.settings_plugin).not.toHaveProperty("users");
  });

  it("persists supported setting kinds and validates URL/date/list values", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-setting-kinds-");
    const declarations = [
      setting({ key: "display_name", kind: "string" }),
      setting({ key: "refresh_minutes", kind: "number" }),
      setting({ key: "enabled", kind: "boolean" }),
      setting({ key: "mode", kind: "enum", options: ["compact", "verbose"] }),
      setting({ key: "api_token", kind: "secret" }),
      setting({ key: "homepage", kind: "url" }),
      setting({ key: "start_date", kind: "date" }),
      setting({ items: { kind: "email" }, key: "recipients", kind: "list" }),
      setting({
        items: { kind: "string" },
        key: "escaped_items",
        kind: "list",
      }),
      setting({ items: { kind: "number" }, key: "weights", kind: "list" }),
    ];

    await updatePluginSettings({
      declarations,
      directoryName: "kinds_plugin",
      options: { appDataDir },
      patch: {
        api_token: "secret-token",
        display_name: "Alpha",
        enabled: true,
        escaped_items: ["alpha,beta", "gamma\\delta", ""],
        homepage: "https://example.test/docs",
        mode: "verbose",
        recipients: ["admin@example.test", "ops@example.test"],
        refresh_minutes: 30,
        start_date: "2026-04-28",
        weights: [1, 2.5],
      },
      pluginId: "kinds_plugin",
    });

    const maskedSnapshot = await readPluginSettingsSnapshot({
      declarations,
      directoryName: "kinds_plugin",
      options: { appDataDir },
      pluginId: "kinds_plugin",
    });
    expect(maskedSnapshot.settings).toContainEqual(
      expect.objectContaining({
        hasStoredValue: true,
        key: "api_token",
        readable: false,
        secret: true,
        value: null,
      }),
    );
    expect(maskedSnapshot.settings).toContainEqual(
      expect.objectContaining({
        key: "escaped_items",
        value: ["alpha,beta", "gamma\\delta", ""],
      }),
    );

    const runtimeSettings = await readPluginSettingsForRuntime({
      declarations,
      directoryName: "kinds_plugin",
      options: { appDataDir },
    });
    expect(runtimeSettings.values).toMatchObject({
      api_token: "secret-token",
      display_name: "Alpha",
      enabled: true,
      homepage: "https://example.test/docs",
      mode: "verbose",
      refresh_minutes: 30,
      start_date: "2026-04-28",
    });
    expect(runtimeSettings.values.escaped_items).toEqual([
      "alpha,beta",
      "gamma\\delta",
      "",
    ]);
    expect(runtimeSettings.values.weights).toEqual([1, 2.5]);

    for (const patch of [
      { homepage: "ftp://example.test/file" },
      { start_date: "04/28/2026" },
      { recipients: ["not-an-email"] },
      { weights: ["1"] },
    ]) {
      await expect(
        updatePluginSettings({
          declarations,
          directoryName: "kinds_plugin",
          options: { appDataDir },
          patch,
          pluginId: "kinds_plugin",
        }),
      ).rejects.toMatchObject({ code: "invalid_setting_value" });
    }
  });

  it("encrypts secret setting values at rest and warns for legacy plaintext", async () => {
    const appDataDir = createTempDirectory(
      "metidos-plugin-encrypted-settings-",
    );
    const declarations = [
      setting({ key: "api_token", kind: "secret" }),
      setting({ key: "label", kind: "string" }),
    ];

    await updatePluginSettings({
      declarations,
      directoryName: "encrypted_plugin",
      options: { appDataDir },
      patch: { api_token: "secret-token", label: "public" },
      pluginId: "encrypted_plugin",
    });

    const raw = JSON.parse(
      readFileSync(join(appDataDir, "plugin-settings-v1.json"), "utf8"),
    );
    expect(raw.plugins.encrypted_plugin.values.api_token).toMatchObject({
      algorithm: "AES-GCM",
      encrypted: true,
    });
    expect(JSON.stringify(raw)).not.toContain("secret-token");
    await expect(
      readPluginSettingsForRuntime({
        declarations,
        directoryName: "encrypted_plugin",
        options: { appDataDir },
      }),
    ).resolves.toMatchObject({ values: { api_token: "secret-token" } });

    raw.plugins.encrypted_plugin.values.api_token = "legacy-secret";
    writeFileSync(
      join(appDataDir, "plugin-settings-v1.json"),
      `${JSON.stringify(raw, null, 2)}\n`,
    );
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      await expect(
        readPluginSettingsForRuntime({
          declarations,
          directoryName: "encrypted_plugin",
          options: { appDataDir },
        }),
      ).resolves.toMatchObject({ values: { api_token: "legacy-secret" } });
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.join("\n")).toContain("stored as plaintext");

    const migratedRaw = JSON.parse(
      readFileSync(join(appDataDir, "plugin-settings-v1.json"), "utf8"),
    );
    expect(migratedRaw.plugins.encrypted_plugin.values.api_token).toMatchObject(
      {
        algorithm: "AES-GCM",
        encrypted: true,
      },
    );
    expect(JSON.stringify(migratedRaw)).not.toContain("legacy-secret");
  });

  it("deletes stored secret settings when patched to null", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-clear-secret-");
    const declarations = [
      setting({ key: "api_token", kind: "secret" }),
      setting({ key: "label", kind: "string" }),
    ];

    await updatePluginSettings({
      declarations,
      directoryName: "clear_plugin",
      options: { appDataDir },
      patch: { api_token: "secret-token", label: "public" },
      pluginId: "clear_plugin",
    });
    await updatePluginSettings({
      declarations,
      directoryName: "clear_plugin",
      options: { appDataDir },
      patch: { api_token: null },
      pluginId: "clear_plugin",
    });

    const raw = JSON.parse(
      readFileSync(join(appDataDir, "plugin-settings-v1.json"), "utf8"),
    );
    expect(raw.plugins.clear_plugin.values).toEqual({ label: "public" });

    await expect(
      readPluginSettingsForRuntime({
        declarations,
        directoryName: "clear_plugin",
        options: { appDataDir },
      }),
    ).resolves.toMatchObject({ values: { api_token: null, label: "public" } });
  });

  it("migrates legacy buckets with local winning over global and users filling missing keys", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-v3-migration-");
    const declarations = [
      setting({ key: "client_id", kind: "string" }),
      setting({ key: "client_secret", kind: "secret" }),
      setting({ key: "refresh_token", kind: "secret", required: true }),
      setting({ key: "display_name", kind: "string" }),
    ];
    const raw = {
      plugins: {
        gmail: {
          global: {
            client_id: "global-client-id",
            client_secret: "global-client-secret",
            display_name: "Global Name",
          },
          local: {
            client_secret: "local-client-secret",
          },
          pluginId: "gmail",
          users: {
            "7": {
              display_name: "Legacy User",
              refresh_token: "legacy-refresh-token",
            },
          },
        },
      },
      schema: "metidos.plugin-settings/v1",
      version: 2,
    };
    writeFileSync(
      join(appDataDir, "plugin-settings-v1.json"),
      `${JSON.stringify(raw, null, 2)}\n`,
    );

    await expect(
      readPluginSettingsForRuntime({
        declarations,
        directoryName: "gmail",
        options: { appDataDir },
      }),
    ).resolves.toEqual({
      missingRequiredKeys: [],
      values: {
        client_id: "global-client-id",
        client_secret: "local-client-secret",
        display_name: "Global Name",
        refresh_token: "legacy-refresh-token",
      },
    });

    const migratedRaw = JSON.parse(
      readFileSync(join(appDataDir, "plugin-settings-v1.json"), "utf8"),
    );
    expect(migratedRaw).toMatchObject({
      schema: "metidos.plugin-settings/v3",
      version: 3,
      plugins: {
        gmail: {
          pluginId: "gmail",
          values: {
            client_id: "global-client-id",
            client_secret: expect.anything(),
            display_name: "Global Name",
            refresh_token: expect.anything(),
          },
        },
      },
    });
    expect(migratedRaw.plugins.gmail).not.toHaveProperty("global");
    expect(migratedRaw.plugins.gmail).not.toHaveProperty("local");
    expect(migratedRaw.plugins.gmail).not.toHaveProperty("users");
  });

  it("treats unreadable encrypted plugin secrets as unset instead of throwing", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-corrupt-secret-");
    const declarations = [
      setting({ key: "refresh_token", kind: "secret", required: true }),
    ];
    const raw = {
      plugins: {
        gmail: {
          pluginId: "gmail",
          values: {
            refresh_token: {
              algorithm: "AES-GCM",
              ciphertext: "v2.invalid.invalid",
              encrypted: true,
              encoding: "utf8",
              plaintextKind: "string",
              version: "v1",
            },
          },
        },
      },
      schema: "metidos.plugin-settings/v3",
      version: 3,
    };
    writeFileSync(
      join(appDataDir, "plugin-settings-v1.json"),
      `${JSON.stringify(raw, null, 2)}\n`,
    );

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await expect(
        readPluginSettingsForRuntime({
          declarations,
          directoryName: "gmail",
          options: { appDataDir },
        }),
      ).resolves.toEqual({
        missingRequiredKeys: ["refresh_token"],
        values: { refresh_token: null },
      });
    } finally {
      console.warn = originalWarn;
    }
  });

  it("makes Gmail OAuth settings visible from one unified Plugin Settings map", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-gmail-settings-");
    const declarations = [
      setting({ key: "client_id", kind: "string", required: true }),
      setting({ key: "client_secret", kind: "secret", required: true }),
      setting({ key: "refresh_token", kind: "secret", required: true }),
    ];

    await updatePluginSettings({
      declarations,
      directoryName: "gmail",
      options: { appDataDir },
      patch: {
        client_id: "gmail-client-id",
        client_secret: "gmail-client-secret",
        refresh_token: "gmail-refresh-token",
      },
      pluginId: "gmail",
    });

    await expect(
      readPluginSettingsForRuntime({
        declarations,
        directoryName: "gmail",
        options: { appDataDir },
      }),
    ).resolves.toEqual({
      missingRequiredKeys: [],
      values: {
        client_id: "gmail-client-id",
        client_secret: "gmail-client-secret",
        refresh_token: "gmail-refresh-token",
      },
    });
  });

  it("decrypts legacy user encrypted secrets during migration", async () => {
    const appDataDir = createTempDirectory(
      "metidos-plugin-legacy-user-secret-",
    );
    const declarations = [setting({ key: "api_token", kind: "secret" })];
    const raw = {
      plugins: {
        legacy_plugin: {
          global: {},
          local: {},
          pluginId: "legacy_plugin",
          users: {
            "7": {
              api_token: {
                algorithm: "AES-GCM",
                ciphertext: await encryptAuthSecret(
                  JSON.stringify("secret-token"),
                  {
                    additionalData: buildUserScopedAuthSecretAdditionalData(
                      "metidos.plugin-setting:legacy_plugin:api_token",
                      7,
                    ),
                    appDataDir,
                  },
                ),
                encrypted: true,
                encoding: "utf8",
                plaintextKind: "string",
                version: "v1",
              },
            },
          },
        },
      },
      schema: "metidos.plugin-settings/v1",
      version: 1,
    };
    writeFileSync(
      join(appDataDir, "plugin-settings-v1.json"),
      `${JSON.stringify(raw, null, 2)}\n`,
    );

    await expect(
      readPluginSettingsForRuntime({
        declarations,
        directoryName: "legacy_plugin",
        options: { appDataDir },
      }),
    ).resolves.toEqual({
      missingRequiredKeys: [],
      values: { api_token: "secret-token" },
    });
  });

  it("rejects undeclared keys and values that do not match their declarations", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-invalid-settings-");
    const declarations = [setting({ key: "allowed", kind: "boolean" })];

    await expect(
      updatePluginSettings({
        declarations,
        directoryName: "invalid_plugin",
        options: { appDataDir },
        patch: { missing: true },
        pluginId: "invalid_plugin",
      }),
    ).rejects.toMatchObject({ code: "invalid_setting_key" });

    await expect(
      updatePluginSettings({
        declarations,
        directoryName: "invalid_plugin",
        options: { appDataDir },
        patch: { allowed: "yes" },
        pluginId: "invalid_plugin",
      }),
    ).rejects.toMatchObject({ code: "invalid_setting_value" });
  });
});

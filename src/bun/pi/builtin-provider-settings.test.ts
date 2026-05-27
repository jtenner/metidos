/**
 * @file src/bun/pi/builtin-provider-settings.test.ts
 * @description Tests for Pi built-in provider setting and credential bridges.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { updatePluginSettings } from "../plugin/settings";
import type { RpcPluginManifestSettingSummary } from "../rpc-schema";
import { applyPiBuiltinProviderSettings } from "./builtin-provider-settings";

const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function setting(key = "api_key"): RpcPluginManifestSettingSummary {
  return {
    defaultValue: null,
    description: null,
    hasDefault: false,
    items: null,
    key,
    kind: "secret",
    label: "API key",
    options: [],
    required: false,
  };
}

afterEach(() => {
  if (originalAppDataDir === undefined) {
    delete process.env.METIDOS_APP_DATA_DIR;
  } else {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  }
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories.clear();
});

describe("Pi built-in provider settings", () => {
  it("passes plugin-declared API key settings into Pi auth", async () => {
    const appDataDir = createTempDirectory("metidos-pi-provider-settings-");
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const settings = [setting()];
    await updatePluginSettings({
      declarations: settings,
      directoryName: "openai",
      options: { appDataDir },
      patch: { api_key: "configured-key" },
      pluginId: "openai",
    });
    const authStorage = AuthStorage.inMemory();

    await applyPiBuiltinProviderSettings({
      authStorage,
      bindings: [
        {
          directoryName: "openai",
          envValues: new Map(),
          kind: "api_key",
          providerId: "openai",
          settings,
          source: "setting",
          value: "api_key",
        },
      ],
      options: { appDataDir },
    });

    await expect(authStorage.getApiKey("openai")).resolves.toBe(
      "configured-key",
    );
  });

  it("ignores plugin auth file settings outside plugin data", async () => {
    const appDataDir = createTempDirectory("metidos-pi-provider-auth-path-");
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const outsideAuthPath = join(appDataDir, "outside-auth.json");
    writeFileSync(
      outsideAuthPath,
      JSON.stringify({ tokens: { access_token: "outside-token" } }),
    );
    const settings = [setting("auth_path")];
    await updatePluginSettings({
      declarations: settings,
      directoryName: "openai",
      options: { appDataDir },
      patch: { auth_path: outsideAuthPath },
      pluginId: "openai",
    });
    const authStorage = AuthStorage.inMemory();

    await applyPiBuiltinProviderSettings({
      authStorage,
      bindings: [
        {
          directoryName: "openai",
          envValues: new Map(),
          kind: "codex_auth",
          providerId: "openai",
          settings,
          source: "setting",
          value: "auth_path",
        },
      ],
      options: { appDataDir },
    });

    await expect(authStorage.getApiKey("openai")).resolves.toBeUndefined();
  });

  it("imports plugin auth file settings from plugin data", async () => {
    const appDataDir = createTempDirectory("metidos-pi-provider-data-auth-");
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const pluginPath = join(appDataDir, "plugins", "openai");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(
      join(pluginPath, ".data", "auth.json"),
      JSON.stringify({ tokens: { access_token: "plugin-data-token" } }),
    );
    const settings = [setting("auth_path")];
    await updatePluginSettings({
      declarations: settings,
      directoryName: "openai",
      options: { appDataDir },
      patch: { auth_path: ".data/auth.json" },
      pluginId: "openai",
    });
    const authStorage = AuthStorage.inMemory();

    await applyPiBuiltinProviderSettings({
      authStorage,
      bindings: [
        {
          directoryName: "openai",
          envValues: new Map(),
          kind: "codex_auth",
          providerId: "openai",
          settings,
          source: "setting",
          value: "auth_path",
        },
      ],
      options: { appDataDir },
    });

    await expect(authStorage.getApiKey("openai")).resolves.toBe(
      "plugin-data-token",
    );
  });

  it("prefers environment auth for env bindings", async () => {
    const authStorage = AuthStorage.inMemory();
    await applyPiBuiltinProviderSettings({
      authStorage,
      bindings: [
        {
          directoryName: "openai",
          envValues: new Map([["OPENAI_API_KEY", "env-key"]]),
          kind: "api_key",
          providerId: "openai",
          settings: [],
          source: "env",
          value: "OPENAI_API_KEY",
        },
      ],
    });

    await expect(authStorage.getApiKey("openai")).resolves.toBe("env-key");
  });
});

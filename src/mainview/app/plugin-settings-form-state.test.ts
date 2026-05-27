import { describe, expect, it } from "bun:test";

import type {
  RpcPluginInventoryPlugin,
  RpcPluginManifestSettingSummary,
  RpcPluginSettingsSnapshot,
} from "../../bun/rpc-schema";
import {
  buildPluginSettingsPatchRecords,
  pluginSettingBooleanControlChecked,
  pluginSettingListControlValue,
  pluginSettingsFormValuesFromSnapshot,
  pluginSettingSecretClearPending,
  pluginSettingSecretReplacementPending,
  pluginSettingTextControlValue,
  pluginSettingTextInputPlaceholder,
} from "./plugin-settings-form-state";

function pluginWithSettings(
  settings: RpcPluginManifestSettingSummary[],
): RpcPluginInventoryPlugin {
  return {
    directoryName: "alpha_plugin",
    manifest: { settings },
    pluginId: "alpha",
  } as RpcPluginInventoryPlugin;
}

const messageSetting: RpcPluginManifestSettingSummary = {
  defaultValue: "hello",
  description: null,
  hasDefault: true,
  items: null,
  key: "message",
  kind: "string",
  label: null,
  options: [],
  required: null,
};

const apiKeySetting: RpcPluginManifestSettingSummary = {
  defaultValue: null,
  description: null,
  hasDefault: false,
  items: null,
  key: "apiKey",
  kind: "secret",
  label: null,
  options: [],
  required: null,
};

const tagsSetting: RpcPluginManifestSettingSummary = {
  defaultValue: [],
  description: null,
  hasDefault: true,
  items: { kind: "string" },
  key: "tags",
  kind: "list",
  label: null,
  options: [],
  required: null,
};

const weightsSetting: RpcPluginManifestSettingSummary = {
  defaultValue: [],
  description: null,
  hasDefault: true,
  items: { kind: "number" },
  key: "weights",
  kind: "list",
  label: null,
  options: [],
  required: null,
};

function settingsSnapshot(): RpcPluginSettingsSnapshot {
  return {
    directoryName: "alpha_plugin",
    pluginId: "alpha",
    settings: [
      {
        defaultValue: "hello",
        hasDefault: true,
        hasStoredValue: false,
        key: "message",
        kind: "string",
        readable: true,
        secret: false,
        value: "hello",
      },
      {
        defaultValue: null,
        hasDefault: false,
        hasStoredValue: true,
        key: "apiKey",
        kind: "secret",
        readable: false,
        secret: true,
        value: null,
      },
      {
        defaultValue: [],
        hasDefault: true,
        hasStoredValue: false,
        key: "tags",
        kind: "list",
        readable: true,
        secret: false,
        value: ["alpha", "beta"],
      },
      {
        defaultValue: [],
        hasDefault: true,
        hasStoredValue: false,
        key: "weights",
        kind: "list",
        readable: true,
        secret: false,
        value: [1, 2.5],
      },
    ],
  };
}

describe("plugin settings form state", () => {
  it("hydrates form values without exposing unreadable stored secrets", () => {
    const values = pluginSettingsFormValuesFromSnapshot(settingsSnapshot());

    expect(values.message).toBe("hello");
    expect(values.apiKey).toBe("");
    expect(values.tags).toEqual(["alpha", "beta"]);
    expect(values.weights).toEqual(["1", "2.5"]);
  });

  it("normalizes control values and secret clear affordance text", () => {
    expect(pluginSettingBooleanControlChecked(true)).toBe(true);
    expect(pluginSettingBooleanControlChecked("true")).toBe(false);
    expect(pluginSettingListControlValue(["alpha"])).toEqual(["alpha"]);
    expect(pluginSettingListControlValue("alpha")).toEqual([]);
    expect(pluginSettingTextControlValue("secret")).toBe("secret");
    expect(pluginSettingTextControlValue(null)).toBe("");

    const summary = settingsSnapshot().settings.find(
      (setting) => setting.key === "apiKey",
    );
    if (!summary) {
      throw new Error("Expected apiKey setting summary.");
    }
    const clearPending = pluginSettingSecretClearPending({
      declaration: apiKeySetting,
      summary,
      value: null,
    });

    const replacementPending = pluginSettingSecretReplacementPending({
      declaration: apiKeySetting,
      value: " replacement-token ",
    });

    expect(clearPending).toBe(true);
    expect(replacementPending).toBe(true);
    expect(
      pluginSettingTextInputPlaceholder({
        secretClearPending: clearPending,
        summary,
      }),
    ).toBe("Will clear on save — paste to replace");
    expect(
      pluginSettingTextInputPlaceholder({
        secretClearPending: false,
        summary,
      }),
    ).toBe("Configured — paste to replace");
  });

  it("builds changed plugin settings patch records with secret-safe semantics", () => {
    const plugin = pluginWithSettings([
      messageSetting,
      apiKeySetting,
      tagsSetting,
      weightsSetting,
    ]);
    const snapshot = settingsSnapshot();
    const loadedValues = pluginSettingsFormValuesFromSnapshot(snapshot);

    expect(
      buildPluginSettingsPatchRecords({
        plugins: [plugin],
        snapshots: { [plugin.directoryName]: snapshot },
        values: { [plugin.directoryName]: loadedValues },
      }),
    ).toEqual([]);

    expect(
      buildPluginSettingsPatchRecords({
        plugins: [plugin],
        snapshots: { [plugin.directoryName]: snapshot },
        values: {
          [plugin.directoryName]: {
            ...loadedValues,
            apiKey: null,
            message: " goodbye ",
            tags: [" alpha ", "", "gamma"],
            weights: ["3", "not-a-number", "4.5"],
          },
        },
      }),
    ).toEqual([
      {
        patch: {
          apiKey: null,
          message: "goodbye",
          tags: ["alpha", "gamma"],
          weights: [3, 4.5],
        },
        plugin,
      },
    ]);
  });
});

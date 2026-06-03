import type {
  RpcPluginInventoryPlugin,
  RpcPluginManifestSettingDefault,
  RpcPluginManifestSettingSummary,
  RpcPluginSettingsSnapshot,
  RpcPluginSettingValueSummary,
} from "../../bun/rpc-schema";

export type PluginSettingFormValue = boolean | string | string[] | null;
export type PluginSettingFormValues = Record<
  string,
  Record<string, PluginSettingFormValue>
>;
export type PluginSettingsSnapshots = Record<string, RpcPluginSettingsSnapshot>;

export type PluginSettingsPatchRecord = {
  patch: Record<string, RpcPluginManifestSettingDefault>;
  plugin: RpcPluginInventoryPlugin;
};

function displayPluginSettingValue(value: string | null): string {
  return value?.trim() ? value : "Not declared";
}

export function pluginSettingLabel(
  setting: RpcPluginManifestSettingSummary,
): string {
  return displayPluginSettingValue(setting.label ?? setting.key);
}

export function pluginSettingDescription(
  setting: RpcPluginManifestSettingSummary,
): string {
  const details = [
    setting.description,
    setting.required ? "Required" : null,
  ].filter((item): item is string => Boolean(item));
  return details.join(" · ");
}

export function pluginSettingDeclarationForSummary(
  plugin: RpcPluginInventoryPlugin,
  summary: RpcPluginSettingValueSummary,
): RpcPluginManifestSettingSummary | null {
  if (!summary.key) {
    return null;
  }
  return (
    plugin.manifest.settings.find((setting) => setting.key === summary.key) ??
    null
  );
}

export function pluginSettingFormValue(
  summary: RpcPluginSettingValueSummary,
): PluginSettingFormValue {
  if (summary.kind === "boolean") {
    return summary.value === true;
  }
  if (summary.kind === "list") {
    return Array.isArray(summary.value)
      ? summary.value.map((item) => String(item))
      : [];
  }
  // Secret settings are write-only in the mainview. Even if a caller ever
  // receives a readable secret snapshot, the settings form must distinguish it
  // from safe display values and require an explicit pasted replacement.
  if (summary.secret) {
    return "";
  }
  return summary.value === null ? "" : String(summary.value);
}

export function pluginSettingsFormValuesFromSnapshot(
  snapshot: RpcPluginSettingsSnapshot,
): PluginSettingFormValues[string] {
  const values: PluginSettingFormValues[string] = {};
  for (const summary of snapshot.settings) {
    if (!summary.key) {
      continue;
    }
    values[summary.key] = pluginSettingFormValue(summary);
  }
  return values;
}

export function pluginSettingBooleanControlChecked(
  value: PluginSettingFormValue | undefined,
): boolean {
  return value === true;
}

export function pluginSettingListControlValue(
  value: PluginSettingFormValue | undefined,
): string[] {
  return Array.isArray(value) ? value : [];
}

export function pluginSettingListItemKind(
  declaration: RpcPluginManifestSettingSummary,
): string {
  const kind = declaration.items?.kind;
  return kind === "email" ||
    kind === "number" ||
    kind === "string" ||
    kind === "url"
    ? kind
    : "string";
}

export function pluginSettingListItemPlaceholder(kind: string): string {
  switch (kind) {
    case "email":
      return "name@example.com";
    case "number":
      return "0";
    case "url":
      return "https://example.com/feed.xml";
    default:
      return "Value";
  }
}

export function pluginSettingTextControlValue(
  value: PluginSettingFormValue | undefined,
): string {
  return typeof value === "string" ? value : "";
}

export function pluginSettingSecretClearPending(input: {
  declaration: RpcPluginManifestSettingSummary;
  summary: RpcPluginSettingValueSummary;
  value: PluginSettingFormValue | undefined;
}): boolean {
  return (
    input.declaration.kind === "secret" &&
    input.summary.hasStoredValue &&
    input.value === null
  );
}

export function pluginSettingSecretReplacementPending(input: {
  declaration: RpcPluginManifestSettingSummary;
  value: PluginSettingFormValue | undefined;
}): boolean {
  return (
    input.declaration.kind === "secret" &&
    typeof input.value === "string" &&
    input.value.trim().length > 0
  );
}

export function pluginSettingTextInputPlaceholder(input: {
  secretClearPending: boolean;
  summary: RpcPluginSettingValueSummary;
}): string | undefined {
  if (!input.summary.secret || !input.summary.hasStoredValue) {
    return undefined;
  }
  return input.secretClearPending
    ? "Will clear on save — paste to replace"
    : "Configured — paste to replace";
}

function pluginSettingPatchValue(input: {
  declaration: RpcPluginManifestSettingSummary;
  summary: RpcPluginSettingValueSummary;
  value: PluginSettingFormValue | undefined;
}): RpcPluginManifestSettingDefault | undefined {
  const { declaration, summary, value } = input;
  if (!declaration.key || value === undefined) {
    return undefined;
  }
  if (declaration.kind === "boolean") {
    return value === true;
  }
  if (declaration.kind === "list") {
    const items = Array.isArray(value)
      ? value.map((item) => item.trim()).filter(Boolean)
      : [];
    if (declaration.items?.kind === "number") {
      return items.flatMap((item) => {
        const numeric = Number(item);
        return Number.isFinite(numeric) ? [numeric] : [];
      });
    }
    return items;
  }
  const stringValue =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (declaration.kind === "secret" && value === null) {
    return null;
  }
  if (declaration.kind === "secret" && stringValue === "") {
    return summary.hasStoredValue ? undefined : null;
  }
  if (declaration.kind === "number") {
    return stringValue === "" ? null : Number(stringValue);
  }
  return stringValue === "" ? null : stringValue;
}

function pluginSettingValuesEqual(
  left: RpcPluginManifestSettingDefault | undefined,
  right: RpcPluginManifestSettingDefault | undefined,
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    return (
      left.length === right.length &&
      left.every((item, index) => item === right[index])
    );
  }
  return Object.is(left, right);
}

export function buildPluginSettingsPatch(input: {
  plugin: RpcPluginInventoryPlugin;
  snapshots: PluginSettingsSnapshots;
  values: PluginSettingFormValues;
}): Record<string, RpcPluginManifestSettingDefault> {
  const snapshot = input.snapshots[input.plugin.directoryName];
  const formValues = input.values[input.plugin.directoryName] ?? {};
  if (!snapshot) {
    return {};
  }
  const patch: Record<string, RpcPluginManifestSettingDefault> = {};
  for (const summary of snapshot.settings) {
    const declaration = pluginSettingDeclarationForSummary(
      input.plugin,
      summary,
    );
    if (!declaration?.key) {
      continue;
    }
    const patchValue = pluginSettingPatchValue({
      declaration,
      summary,
      value: formValues[declaration.key],
    });
    const clearsStoredSecret = pluginSettingSecretClearPending({
      declaration,
      summary,
      value: formValues[declaration.key],
    });
    if (
      patchValue !== undefined &&
      (clearsStoredSecret ||
        !pluginSettingValuesEqual(patchValue, summary.value))
    ) {
      patch[declaration.key] = patchValue;
    }
  }
  return patch;
}

export function buildPluginSettingsPatchRecords(input: {
  plugins: readonly RpcPluginInventoryPlugin[];
  snapshots: PluginSettingsSnapshots;
  values: PluginSettingFormValues;
}): PluginSettingsPatchRecord[] {
  return input.plugins
    .map((plugin) => ({
      patch: buildPluginSettingsPatch({
        plugin,
        snapshots: input.snapshots,
        values: input.values,
      }),
      plugin,
    }))
    .filter(({ patch }) => Object.keys(patch).length > 0);
}

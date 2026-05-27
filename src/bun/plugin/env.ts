/**
 * @file src/bun/plugin/env.ts
 * @description Manifest-declared environment capture helpers for Plugin System v1 sidecars.
 */

import type { RpcPluginManifestEnvVarSummary } from "../rpc-schema/plugin";

export const PLUGIN_ENV_SECRET_MASK = "<secret>";
const MAX_PLUGIN_ENV_VALUE_BYTES = 64 * 1024;
const PLUGIN_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export type PluginCapturedEnvVar = {
  key: string;
  required: boolean;
  secret: boolean;
  value: string | null;
};

export class PluginEnvCaptureError extends Error {
  readonly code = "missing_required_plugin_env";
  readonly missingKeys: string[];

  constructor(missingKeys: string[]) {
    super(`Missing required plugin env vars: ${missingKeys.join(", ")}.`);
    this.name = "PluginEnvCaptureError";
    this.missingKeys = missingKeys;
  }
}

type EnvironmentSource = Record<string, string | undefined>;
type PluginEnvDeclarationInput = Omit<
  RpcPluginManifestEnvVarSummary,
  "reviewValue"
> & {
  reviewValue?: string | null;
};

function declarationKey(declaration: PluginEnvDeclarationInput): string | null {
  if (typeof declaration.key !== "string" || declaration.key.length === 0) {
    return null;
  }
  const key = declaration.key.trim();
  return PLUGIN_ENV_KEY_PATTERN.test(key) ? key : null;
}

function boundedPluginEnvValue(value: string): string {
  // Secret env values are intentionally opaque: the host must not rewrite or
  // pattern-match API keys, tokens, file paths, or shell metacharacters because
  // doing so would corrupt legitimate credentials and does not stop a malicious
  // plugin from exfiltrating a secret it was granted. The hard boundary here is
  // structural: only manifest-declared keys are captured, keys must be normal
  // environment identifiers, values are byte-bounded before crossing into the
  // sidecar, and review UIs mask secret values.
  if (new TextEncoder().encode(value).byteLength > MAX_PLUGIN_ENV_VALUE_BYTES) {
    throw new Error(
      `Plugin environment values must be at most ${MAX_PLUGIN_ENV_VALUE_BYTES} bytes.`,
    );
  }
  return value;
}

function declaredDefaultValue(
  declaration: PluginEnvDeclarationInput,
): string | null {
  return declaration.secret === true
    ? null
    : declaration.hasDefault && typeof declaration.defaultValue === "string"
      ? declaration.defaultValue
      : null;
}

export function capturedValueForPluginEnvDeclaration(
  declaration: PluginEnvDeclarationInput,
  environment: EnvironmentSource = process.env,
): string | null {
  const key = declarationKey(declaration);
  if (!key) {
    return null;
  }
  const environmentValue = environment[key];
  if (typeof environmentValue === "string") {
    return boundedPluginEnvValue(environmentValue);
  }
  const defaultValue = declaredDefaultValue(declaration);
  return defaultValue === null ? null : boundedPluginEnvValue(defaultValue);
}

export function reviewValueForPluginEnvDeclaration(
  declaration: PluginEnvDeclarationInput,
  environment: EnvironmentSource = process.env,
): string | null {
  const capturedValue = capturedValueForPluginEnvDeclaration(
    declaration,
    environment,
  );
  if (capturedValue === null) {
    return null;
  }
  return declaration.secret === true ? PLUGIN_ENV_SECRET_MASK : capturedValue;
}

export function capturePluginEnvironment(
  declarations: RpcPluginManifestEnvVarSummary[],
  environment: EnvironmentSource = process.env,
): PluginCapturedEnvVar[] {
  return declarations.flatMap((declaration) => {
    const key = declarationKey(declaration);
    if (!key) {
      return [];
    }
    return [
      {
        key,
        required: declaration.required === true,
        secret: declaration.secret === true,
        value: capturedValueForPluginEnvDeclaration(declaration, environment),
      },
    ];
  });
}

export function assertRequiredPluginEnvCaptured(
  capturedEnv: PluginCapturedEnvVar[],
): void {
  const missingKeys = capturedEnv
    .filter((envVar) => envVar.required && envVar.value === null)
    .map((envVar) => envVar.key);
  if (missingKeys.length > 0) {
    throw new PluginEnvCaptureError(missingKeys);
  }
}

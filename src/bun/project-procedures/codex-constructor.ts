/**
 * @file src/bun/project-procedures/codex-constructor.ts
 * @description Provider-aware Codex constructor input translation.
 */

import type { CodexOptions } from "@openai/codex-sdk";

import { codexModelProvider, normalizeStoredCodexModel } from "./model-catalog";

const XAI_API_BASE_URL = "https://api.x.ai/v1";
const XAI_API_KEY_ENV_NAME = "XAI_API_KEY";
const XAI_CODEX_PROVIDER_ID = "xai";
const XAI_CODEX_PROVIDER_NAME = "xAI";

export type CodexConstructorOptions = CodexOptions;
export type CodexConstructorConfig = NonNullable<CodexOptions["config"]>;
type CodexConfigValue = CodexConstructorConfig[string];
type CodexConstructorTranslator = (
  input: ResolvedCodexConstructorInput,
) => CodexConstructorOptions;

export type BuildCodexConstructorOptionsInput = Omit<
  CodexConstructorOptions,
  "config"
> & {
  config?: CodexConstructorConfig | null;
  model: string | null | undefined;
};

type ResolvedCodexConstructorInput = Omit<
  BuildCodexConstructorOptionsInput,
  "config" | "model"
> & {
  config: CodexConstructorConfig;
  model: string;
};

function asCodexConfigObject(
  value: CodexConfigValue | null | undefined,
): CodexConstructorConfig {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return value as CodexConstructorConfig;
}

function finalizeCodexConstructorOptions(
  options: Omit<CodexConstructorOptions, "config">,
  config: CodexConstructorConfig,
): CodexConstructorOptions {
  return {
    ...options,
    ...(Object.keys(config).length > 0
      ? {
          config,
        }
      : {}),
  };
}

function buildDefaultCodexConstructorOptions(
  input: ResolvedCodexConstructorInput,
): CodexConstructorOptions {
  const { config, model: _model, ...options } = input;
  return finalizeCodexConstructorOptions(options, config);
}

function buildXaiCodexConstructorOptions(
  input: ResolvedCodexConstructorInput,
): CodexConstructorOptions {
  if (!process.env[XAI_API_KEY_ENV_NAME]?.trim()) {
    throw new Error(
      `${XAI_API_KEY_ENV_NAME} is required to use the xAI model "${input.model}".`,
    );
  }

  const { config, model: _model, ...options } = input;
  const modelProviders = asCodexConfigObject(config.model_providers);

  return finalizeCodexConstructorOptions(options, {
    ...config,
    model_provider: XAI_CODEX_PROVIDER_ID,
    model_providers: {
      ...modelProviders,
      [XAI_CODEX_PROVIDER_ID]: {
        base_url: XAI_API_BASE_URL,
        env_key: XAI_API_KEY_ENV_NAME,
        name: XAI_CODEX_PROVIDER_NAME,
        supports_websockets: false,
        wire_api: "responses",
      },
    },
    web_search: "disabled",
  });
}

const CODEX_CONSTRUCTOR_TRANSLATORS = {
  openai: buildDefaultCodexConstructorOptions,
  xai: buildXaiCodexConstructorOptions,
} satisfies Record<
  ReturnType<typeof codexModelProvider>,
  CodexConstructorTranslator
>;

/**
 * Translates provider/model selection plus generic inputs into exact Codex constructor options.
 */
export function buildCodexConstructorOptions(
  input: BuildCodexConstructorOptionsInput,
): CodexConstructorOptions {
  const normalizedModel = normalizeStoredCodexModel(input.model);
  const { config, model: _model, ...options } = input;
  return CODEX_CONSTRUCTOR_TRANSLATORS[codexModelProvider(normalizedModel)]({
    ...options,
    config: config ?? {},
    model: normalizedModel,
  });
}

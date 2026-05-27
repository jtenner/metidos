import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type ReplicateModel = {
  compat: {
    replicate: {
      maxTokensField: string | null;
      model: string;
      owner: string;
      promptField: string;
      systemField: string | null;
      temperatureField: string | null;
    };
  };
  contextWindow: number;
  cost: {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
  };
  id: string;
  input: ("text" | "image")[];
  maxTokens: number;
  name: string;
  reasoning: boolean;
};

type ReplicatePredictionStatus =
  | "canceled"
  | "failed"
  | "processing"
  | "starting"
  | "succeeded";

const API_KEY_ENV = "REPLICATE_API_TOKEN";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.replicate.com/v1";
const MODELS_URL = `${BASE_URL}/models`;
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 120_000;
const MAX_DISCOVERY_PAGES = 3;
const DEFAULT_CONTEXT_WINDOW = 8_192;
const DEFAULT_MAX_TOKENS = 2_048;
const MAX_PROMPT_CHARS = 60_000;
const MEDIA_MODEL_TERMS = [
  "audio",
  "diffusion",
  "image",
  "music",
  "speech",
  "stable-diffusion",
  "tts",
  "video",
  "voice",
  "whisper",
];
const TEXT_OUTPUT_TERMS = ["string", "text", "tokens"];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = stringValue(entry);
        return normalized ? [normalized] : [];
      })
    : [];
}

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function latestVersion(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const latest = value.latest_version;
  return isRecord(latest) ? latest : null;
}

function schemaRecord(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const direct = value.openapi_schema;
  const latest = latestVersion(value)?.openapi_schema;
  return isRecord(direct) ? direct : isRecord(latest) ? latest : null;
}

function inputProperties(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const schema = schemaRecord(value);
  const components = isRecord(schema?.components) ? schema.components : null;
  const schemas = isRecord(components?.schemas) ? components.schemas : null;
  const input = isRecord(schemas?.Input) ? schemas.Input : null;
  const inputPropertiesValue = isRecord(input?.properties)
    ? input.properties
    : isRecord(schema?.properties)
      ? schema.properties
      : null;
  return inputPropertiesValue ?? {};
}

function outputSchema(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const schema = schemaRecord(value);
  const components = isRecord(schema?.components) ? schema.components : null;
  const schemas = isRecord(components?.schemas) ? components.schemas : null;
  const output = isRecord(schemas?.Output) ? schemas.Output : null;
  return output ?? (isRecord(schema?.output) ? schema.output : null);
}

function schemaTextValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value.toLowerCase()];
  }
  if (Array.isArray(value)) {
    return value.flatMap(schemaTextValues);
  }
  if (!isRecord(value)) {
    return [];
  }
  return [
    stringValue(value.type),
    stringValue(value.format),
    stringValue(value.title),
    stringValue(value.description),
    ...schemaTextValues(value.items),
    ...schemaTextValues(value.anyOf),
    ...schemaTextValues(value.oneOf),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function findFirstProperty(
  properties: Record<string, unknown>,
  candidates: readonly string[],
): string | null {
  for (const candidate of candidates) {
    if (isRecord(properties[candidate])) {
      return candidate;
    }
  }
  return null;
}

function propertyNumberValue(
  properties: Record<string, unknown>,
  propertyName: string | null,
  keys: readonly string[],
): number | null {
  if (!propertyName) {
    return null;
  }
  const property = properties[propertyName];
  if (!isRecord(property)) {
    return null;
  }
  for (const key of keys) {
    const normalized = numberValue(property[key]);
    if (normalized !== null) {
      return Math.floor(normalized);
    }
  }
  return null;
}

function promptField(properties: Record<string, unknown>): string | null {
  return findFirstProperty(properties, ["prompt", "input", "text", "query"]);
}

function systemField(properties: Record<string, unknown>): string | null {
  return findFirstProperty(properties, [
    "system_prompt",
    "system",
    "instructions",
  ]);
}

function maxTokensField(properties: Record<string, unknown>): string | null {
  return findFirstProperty(properties, [
    "max_new_tokens",
    "max_tokens",
    "max_length",
    "max_output_tokens",
  ]);
}

function temperatureField(properties: Record<string, unknown>): string | null {
  return findFirstProperty(properties, ["temperature"]);
}

function supportsTextOutput(model: Record<string, unknown>): boolean {
  const output = outputSchema(model);
  if (!output) {
    return true;
  }
  const textValues = schemaTextValues(output);
  if (textValues.length === 0) {
    return true;
  }
  if (textValues.some((value) => MEDIA_MODEL_TERMS.includes(value))) {
    return false;
  }
  return textValues.some((value) => TEXT_OUTPUT_TERMS.includes(value));
}

function textFieldsForModel(model: Record<string, unknown>): string[] {
  const latest = latestVersion(model);
  return [
    stringValue(model.id),
    stringValue(model.owner),
    stringValue(model.name),
    stringValue(model.description),
    stringValue(model.visibility),
    ...stringArrayValue(model.tags),
    ...stringArrayValue(latest?.cog_version),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function modelLooksLikeTextGeneration(model: Record<string, unknown>): boolean {
  const properties = inputProperties(model);
  const prompt = promptField(properties);
  if (!prompt || !supportsTextOutput(model)) {
    return false;
  }
  const propertyNames = Object.keys(properties).map((name) =>
    name.toLowerCase(),
  );
  if (
    propertyNames.some((name) =>
      ["image", "image_url", "audio", "video", "mask"].includes(name),
    )
  ) {
    return false;
  }
  const textValues = textFieldsForModel(model);
  if (textValues.some((value) => MEDIA_MODEL_TERMS.includes(value))) {
    return false;
  }
  return true;
}

function modelOwnerAndName(value: Record<string, unknown>): {
  id: string;
  model: string;
  owner: string;
} | null {
  const owner = stringValue(value.owner);
  const model = stringValue(value.name);
  if (owner && model) {
    return { id: `${owner}/${model}`, model, owner };
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  const [parsedOwner, parsedModel, ...rest] = id.split("/");
  if (!parsedOwner || !parsedModel || rest.length > 0) {
    return null;
  }
  return { id, model: parsedModel, owner: parsedOwner };
}

function modelDisplayName(id: string, value: Record<string, unknown>): string {
  const title = stringValue(schemaRecord(value)?.title);
  const descriptionName = stringValue(value.description);
  if (title) {
    return title;
  }
  if (descriptionName && descriptionName.length <= 80) {
    return descriptionName;
  }
  return id
    .split("/")
    .map((part) =>
      part
        .replace(/[._-]/gu, " ")
        .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase()),
    )
    .join(" / ");
}

export function normalizeReplicateModel(value: unknown): ReplicateModel | null {
  if (!isRecord(value) || !modelLooksLikeTextGeneration(value)) {
    return null;
  }
  const identity = modelOwnerAndName(value);
  if (!identity) {
    return null;
  }
  const properties = inputProperties(value);
  const prompt = promptField(properties);
  if (!prompt) {
    return null;
  }
  const maxField = maxTokensField(properties);
  const normalizedMaxTokens =
    propertyNumberValue(properties, maxField, ["maximum", "default"]) ??
    DEFAULT_MAX_TOKENS;
  const contextWindow = Math.max(normalizedMaxTokens, DEFAULT_CONTEXT_WINDOW);
  return {
    compat: {
      replicate: {
        maxTokensField: maxField,
        model: identity.model,
        owner: identity.owner,
        promptField: prompt,
        systemField: systemField(properties),
        temperatureField: temperatureField(properties),
      },
    },
    contextWindow,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: identity.id,
    input: ["text"],
    maxTokens: normalizedMaxTokens,
    name: modelDisplayName(identity.id, value),
    reasoning: /reason|thinking/u.test(identity.id.toLowerCase()),
  };
}

function modelsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }
  if (Array.isArray(payload.results)) {
    return payload.results;
  }
  if (Array.isArray(payload.models)) {
    return payload.models;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

function nextModelsUrl(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const next = stringValue(payload.next);
  if (!next) {
    return null;
  }
  try {
    const url = new URL(next);
    return url.origin === BASE_URL.replace(/\/v1$/u, "") &&
      url.pathname === "/v1/models"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

async function logWarning(
  metidos: MetidosPluginApi,
  message: string,
): Promise<void> {
  try {
    await metidos.log?.("warn", message);
  } catch {
    // Ignore logging failures.
  }
}

async function discoverModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<ReplicateModel[]> {
  if (!apiKey) {
    throw new Error(
      "Replicate model discovery requires an api_key Plugin Setting or REPLICATE_API_TOKEN.",
    );
  }
  const models: ReplicateModel[] = [];
  let pageUrl: string | null = MODELS_URL;
  for (let page = 0; pageUrl && page < MAX_DISCOVERY_PAGES; page += 1) {
    const response = await metidos.fetch(pageUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(
        `Replicate model discovery returned HTTP ${response.status} ${response.statusText}`,
      );
    }
    const payload = await response.json();
    models.push(
      ...modelsFromPayload(payload).flatMap((entry) => {
        const model = normalizeReplicateModel(entry);
        return model ? [model] : [];
      }),
    );
    pageUrl = nextModelsUrl(payload);
  }
  return models;
}

function trimText(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : value.slice(value.length - maxChars);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }
      if (part.type === "text") {
        const text = stringValue(part.text);
        return text ? [text] : [];
      }
      if (part.type === "image") {
        return ["[image omitted]"];
      }
      return [];
    })
    .join("\n");
}

export function contextToPrompt(modelContext: Record<string, unknown>): string {
  const lines: string[] = [];
  const systemPrompt = stringValue(modelContext.systemPrompt);
  if (systemPrompt) {
    lines.push(`System: ${systemPrompt}`);
  }
  const messages = Array.isArray(modelContext.messages)
    ? modelContext.messages
    : [];
  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    const role = stringValue(message.role) ?? "message";
    if (role === "assistant") {
      const content = Array.isArray(message.content)
        ? message.content
            .flatMap((part) => {
              if (!isRecord(part)) {
                return [];
              }
              if (part.type === "text" || part.type === "thinking") {
                const text = stringValue(part.text ?? part.thinking);
                return text ? [text] : [];
              }
              if (part.type === "toolCall") {
                const name = stringValue(part.name) ?? "tool";
                return [`[tool call: ${name}]`];
              }
              return [];
            })
            .join("\n")
        : contentToText(message.content);
      if (content) {
        lines.push(`Assistant: ${content}`);
      }
      continue;
    }
    if (role === "toolResult") {
      const toolName = stringValue(message.toolName) ?? "tool";
      const content = contentToText(message.content);
      if (content) {
        lines.push(`Tool ${toolName}: ${content}`);
      }
      continue;
    }
    const content = contentToText(message.content);
    if (content) {
      lines.push(`${role === "user" ? "User" : role}: ${content}`);
    }
  }
  lines.push("Assistant:");
  return trimText(lines.join("\n\n"), MAX_PROMPT_CHARS);
}

function replicateCompatFromModel(
  model: Record<string, unknown>,
): ReplicateModel["compat"]["replicate"] | null {
  const compat = isRecord(model.compat) ? model.compat : null;
  const replicate = isRecord(compat?.replicate) ? compat.replicate : null;
  const owner = stringValue(replicate?.owner);
  const modelName = stringValue(replicate?.model);
  const prompt = stringValue(replicate?.promptField);
  if (!owner || !modelName || !prompt) {
    return null;
  }
  return {
    maxTokensField: stringValue(replicate?.maxTokensField),
    model: modelName,
    owner,
    promptField: prompt,
    systemField: stringValue(replicate?.systemField),
    temperatureField: stringValue(replicate?.temperatureField),
  };
}

export function buildPredictionInput(request: {
  model: Readonly<Record<string, unknown>>;
  modelContext: Readonly<Record<string, unknown>>;
  options?: Readonly<Record<string, unknown>> | undefined;
}): { input: Record<string, unknown>; model: string; owner: string } {
  const replicate = replicateCompatFromModel(request.model);
  if (!replicate) {
    throw new Error(
      "Replicate model metadata did not include execution fields.",
    );
  }
  const input: Record<string, unknown> = {
    [replicate.promptField]: contextToPrompt(request.modelContext),
  };
  const systemPrompt = stringValue(request.modelContext.systemPrompt);
  if (replicate.systemField && systemPrompt) {
    input[replicate.systemField] = systemPrompt;
  }
  const requestedMaxTokens = numberValue(request.options?.maxTokens);
  const modelMaxTokens = numberValue(request.model.maxTokens);
  const maxTokens = requestedMaxTokens ?? modelMaxTokens;
  if (replicate.maxTokensField && maxTokens !== null) {
    input[replicate.maxTokensField] = Math.floor(maxTokens);
  }
  const temperature = numberValue(request.options?.temperature);
  if (replicate.temperatureField && temperature !== null) {
    input[replicate.temperatureField] = temperature;
  }
  return { input, model: replicate.model, owner: replicate.owner };
}

function predictionErrorText(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error)) {
    return stringValue(error.message) ?? JSON.stringify(error);
  }
  return "Replicate prediction failed.";
}

export function predictionOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    return output.map(predictionOutputText).join("");
  }
  if (isRecord(output)) {
    for (const key of [
      "text",
      "output",
      "generated_text",
      "completion",
    ] as const) {
      if (key in output) {
        const text = predictionOutputText(output[key]);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

async function executePrediction(
  metidos: MetidosPluginApi,
  request: {
    model: Readonly<Record<string, unknown>>;
    modelContext: Readonly<Record<string, unknown>>;
    options?: Readonly<Record<string, unknown>> | undefined;
  },
): Promise<{ stopReason: "stop"; text: string }> {
  const apiKey = configuredGlobalOrEnvApiKey(metidos);
  if (!apiKey) {
    throw new Error(
      "Replicate execution requires an api_key Plugin Setting or REPLICATE_API_TOKEN.",
    );
  }
  const prediction = buildPredictionInput(request);
  const response = await metidos.fetch(
    `${BASE_URL}/models/${encodeURIComponent(prediction.owner)}/${encodeURIComponent(prediction.model)}/predictions`,
    {
      body: JSON.stringify({ input: prediction.input }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(
      `Replicate prediction request returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  if (!isRecord(payload)) {
    throw new Error("Replicate prediction response was not an object.");
  }
  const status = stringValue(
    payload.status,
  ) as ReplicatePredictionStatus | null;
  if (status === "failed" || status === "canceled") {
    throw new Error(predictionErrorText(payload));
  }
  if (status !== "succeeded") {
    throw new Error(
      `Replicate prediction did not complete synchronously; current status is ${status ?? "unknown"}.`,
    );
  }
  const text = predictionOutputText(payload.output).trim();
  if (!text) {
    throw new Error(
      "Replicate prediction response did not include text output.",
    );
  }
  return { stopReason: "stop", text };
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "replicate",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: ReplicateModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Replicate model discovery failed; Replicate catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "replicate-predictions",
          id: "default",
          label: "Replicate",
          models,
        },
      ];
    },
    execute(_context, request) {
      return executePrediction(metidos, {
        model: request.model,
        modelContext: request.modelContext,
        options: request.options,
      });
    },
  });
});

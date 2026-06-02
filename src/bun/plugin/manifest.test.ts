/**
 * @file src/bun/plugin/manifest.test.ts
 * @description Drift tests for the published Metidos plugin manifest schema and typed validator.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv, { type AnySchema, type ValidateFunction } from "ajv";

import {
  decodePluginSettingListValue,
  encodePluginSettingListValue,
  parsePluginManifest,
  PLUGIN_MANIFEST_PERMISSIONS,
} from "./manifest";

const SCHEMA_PATH = join("docs", "metidos-plugin.schema.json");
const PERMISSION_REFERENCE_PATH = join("docs", "plugin-permissions.md");
const EXAMPLE_MANIFESTS = [
  "metidos-plugin-minimal-tool.json",
  "metidos-plugin-provider.json",
  join("plugins", "fake_ingress", "metidos-plugin.json"),
  join("plugins", "hello_tool", "metidos-plugin.json"),
  join("plugins", "ntfy_notification_provider", "metidos-plugin.json"),
  join("plugins", "ollama_model_provider", "metidos-plugin.json"),
] as const;

type JsonObject = Record<string, unknown>;

type SchemaBackedInvalidCase = {
  name: string;
  manifest: JsonObject;
  typedIssueCodes: string[];
};

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function permissionReferenceEntries(): string[] {
  const markdown = readFileSync(PERMISSION_REFERENCE_PATH, "utf8");
  const matrixStart = markdown.indexOf("## Permission matrix");
  const reviewStart = markdown.indexOf("## Review checklist");
  if (matrixStart === -1 || reviewStart === -1 || reviewStart <= matrixStart) {
    throw new Error(
      `Expected ${PERMISSION_REFERENCE_PATH} to contain a permission matrix before the review checklist.`,
    );
  }

  return Array.from(
    markdown.slice(matrixStart, reviewStart).matchAll(/^\|\s*`([^`]+)`\s*\|/gm),
  ).flatMap((match) => (match[1] ? [match[1]] : []));
}

function schemaPermissionEnumEntries(): string[] {
  const schema = readJsonFile(SCHEMA_PATH) as {
    $defs?: { permission?: { enum?: unknown } };
    definitions?: { permission?: { enum?: unknown } };
  };
  const permissionEnum =
    schema.$defs?.permission?.enum ?? schema.definitions?.permission?.enum;
  if (
    !Array.isArray(permissionEnum) ||
    !permissionEnum.every((permission) => typeof permission === "string")
  ) {
    throw new Error(
      `Expected ${SCHEMA_PATH} to define a string permission enum.`,
    );
  }
  return permissionEnum;
}

function readExampleManifest(fileName: string): JsonObject {
  return readJsonFile(join("docs", "examples", fileName)) as JsonObject;
}

function buildSchemaValidator(): ValidateFunction {
  const schema = readJsonFile(SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema as AnySchema);
}

function expectSchemaAccepts(
  validateManifest: ValidateFunction,
  manifest: JsonObject,
): void {
  if (!validateManifest(manifest)) {
    throw new Error(
      `Expected manifest to match ${SCHEMA_PATH}: ${JSON.stringify(validateManifest.errors, null, 2)}`,
    );
  }
}

function expectSchemaRejects(
  validateManifest: ValidateFunction,
  manifest: JsonObject,
): void {
  if (validateManifest(manifest)) {
    throw new Error(`Expected manifest to be rejected by ${SCHEMA_PATH}.`);
  }
}

function baseManifest(extra: JsonObject = {}): JsonObject {
  return {
    id: "schema_case",
    name: "Schema Case",
    version: "1.0.0",
    metidosApiVersion: "v1",
    main: "./index.ts",
    description: "Schema-backed manifest validation case.",
    ...extra,
  };
}

function issueCodesFor(manifest: JsonObject): string[] {
  return parsePluginManifest(
    JSON.stringify(manifest),
    "schema-case.json",
  ).issues.map((issue) => issue.code);
}

describe("plugin manifest schema alignment", () => {
  it("keeps the public permission reference aligned with manifest permission enums", () => {
    const manifestPermissions = [...PLUGIN_MANIFEST_PERMISSIONS];

    expect(permissionReferenceEntries()).toEqual(manifestPermissions);
    expect(schemaPermissionEnumEntries()).toEqual(manifestPermissions);
  });

  it("accepts documented examples with the JSON Schema and typed validator", () => {
    const validateManifest = buildSchemaValidator();

    for (const fileName of EXAMPLE_MANIFESTS) {
      const manifest = readExampleManifest(fileName);
      expectSchemaAccepts(validateManifest, manifest);
      expect(
        parsePluginManifest(
          JSON.stringify(manifest),
          join("docs", "examples", fileName),
        ).issues,
      ).toEqual([]);
    }
  });

  it("documents Telegram token reuse without cross-plugin setting sharing", () => {
    const validateManifest = buildSchemaValidator();
    const ingressManifest = readJsonFile(
      join("core_plugins", "telegram_ingress", "metidos-plugin.json"),
    ) as JsonObject;
    const notificationManifest = readJsonFile(
      join(
        "core_plugins",
        "telegram_notification_provider",
        "metidos-plugin.json",
      ),
    ) as JsonObject;

    expectSchemaAccepts(validateManifest, ingressManifest);
    expectSchemaAccepts(validateManifest, notificationManifest);
    expect(
      parsePluginManifest(
        JSON.stringify(ingressManifest),
        join("core_plugins", "telegram_ingress", "metidos-plugin.json"),
      ).issues,
    ).toEqual([]);
    expect(
      parsePluginManifest(
        JSON.stringify(notificationManifest),
        join(
          "core_plugins",
          "telegram_notification_provider",
          "metidos-plugin.json",
        ),
      ).issues,
    ).toEqual([]);

    const ingressEnv = (ingressManifest.env as JsonObject[] | undefined)?.find(
      (entry) => entry.key === "TELEGRAM_BOT_TOKEN",
    );
    const notificationEnv = (
      notificationManifest.env as JsonObject[] | undefined
    )?.find((entry) => entry.key === "TELEGRAM_BOT_TOKEN");
    const ingressBotToken = (ingressManifest.settings as JsonObject[]).find(
      (entry) => entry.key === "bot_token",
    );
    const notificationBotToken = (
      notificationManifest.settings as JsonObject[]
    ).find((entry) => entry.key === "bot_token");

    expect(ingressEnv?.description).toContain(
      "without sharing Plugin Settings",
    );
    expect(notificationEnv?.description).toContain(
      "sharing point with Telegram ingress",
    );
    expect(ingressBotToken?.description).toContain(
      "not read from or shared with the Telegram notification provider",
    );
    expect(notificationBotToken?.description).toContain("notification-only");
  });

  it("keeps schema permission enums accepted by typed validation", () => {
    const schema = readJsonFile(SCHEMA_PATH) as {
      definitions?: { permission?: { enum?: unknown[] } };
    };
    const permissionEnum = schema.definitions?.permission?.enum;
    expect(permissionEnum).toEqual(expect.arrayContaining(["storage:read"]));

    for (const permission of permissionEnum ?? []) {
      expect(typeof permission).toBe("string");
      const permissionManifest = baseManifest({
        network:
          permission === "network:fetch"
            ? { allow: ["https://api.example.test/**"] }
            : undefined,
        permissions: [
          ...(permission === "sqlite" ? ["storage:write"] : []),
          permission,
          ...(["terminal:create", "terminal:kill"].includes(
            permission as string,
          )
            ? ["unsafe"]
            : []),
        ],
      });
      expect(issueCodesFor(permissionManifest)).not.toContain(
        "invalid_manifest_permission",
      );
    }
  });

  it("accepts declared ingress sources with request and reply permissions", () => {
    const parsed = parsePluginManifest(
      JSON.stringify(
        baseManifest({
          ingressSources: [
            {
              id: "fake_dm",
              name: "Fake direct messages",
              description: "Reads fake updates.",
              pollIntervalMs: 5000,
              timeoutMs: 5000,
              supportsReplyToSource: true,
            },
          ],
          permissions: ["plugin:request-ingress", "plugin:reply-to-source"],
        }),
      ),
      "metidos-plugin.json",
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.manifest?.ingressSources).toEqual([
      {
        id: "fake_dm",
        name: "Fake direct messages",
        description: "Reads fake updates.",
        pollIntervalMs: 5000,
        timeoutMs: 5000,
        supportsReplyToSource: true,
      },
    ]);
  });

  it("requires ingress permissions for ingress source declarations", () => {
    expect(
      issueCodesFor(
        baseManifest({
          ingressSources: [{ id: "fake_dm", name: "Fake direct messages" }],
        }),
      ),
    ).toContain("missing_required_permission");
    expect(
      issueCodesFor(
        baseManifest({
          ingressSources: [
            {
              id: "fake_dm",
              name: "Fake direct messages",
              supportsReplyToSource: true,
            },
          ],
          permissions: ["plugin:request-ingress"],
        }),
      ),
    ).toContain("missing_required_permission");
  });

  it("requires prompt injection permission for manifest injection declarations", () => {
    const parsed = parsePluginManifest(
      JSON.stringify(
        baseManifest({
          access: [
            {
              id: "thread_context",
              name: "Thread context",
              injects: [
                {
                  description: "Adds plugin context to thread prompts.",
                  name: "thread_context",
                  timeoutMs: 5_000,
                },
              ],
            },
          ],
        }),
      ),
      "schema-case.json",
    );

    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_required_permission",
          path: "schema-case.json#/permissions",
          message:
            "permissions: `access[].injects` requires `metidos:prompt_inject`.",
        }),
      ]),
    );
  });

  it("accepts network allowlist patterns with omitted HTTPS protocol", () => {
    expect(
      issueCodesFor(
        baseManifest({
          network: { allow: ["api.example.test/v1/**"] },
          permissions: ["network:fetch"],
        }),
      ),
    ).toEqual([]);
  });

  it("accepts WebSocket allowlist patterns with omitted WSS protocol", () => {
    expect(
      issueCodesFor(
        baseManifest({
          network: { webSocketAllow: ["stream.example.test/v1/**"] },
          permissions: ["network:websocket"],
        }),
      ),
    ).toEqual([]);
  });

  it("requires unsafe permission for all-domain network allow patterns", () => {
    expect(
      issueCodesFor(
        baseManifest({
          network: { allow: ["https://**/**"] },
          permissions: ["network:fetch"],
        }),
      ),
    ).toContain("unsafe_network_all_domain_required");

    expect(
      issueCodesFor(
        baseManifest({
          network: { allow: ["https://**/**"] },
          permissions: ["network:fetch", "unsafe"],
        }),
      ),
    ).toEqual([]);

    expect(
      issueCodesFor(
        baseManifest({
          network: { webSocketAllow: ["//**/**"] },
          permissions: ["network:websocket"],
        }),
      ),
    ).toContain("unsafe_network_all_domain_required");
  });

  it("parses nested project file allow and deny declarations with built-in denies", () => {
    const validateManifest = buildSchemaValidator();
    const manifest = baseManifest({
      files: {
        allow: { read: ["./**"], write: ["./tmp/**"] },
        deny: { read: ["./secrets/**"] },
      },
      permissions: ["files:read", "files:write"],
    });

    expectSchemaAccepts(validateManifest, manifest);
    const result = parsePluginManifest(
      JSON.stringify(manifest),
      "file-policy.json",
    );
    expect(result.issues).toEqual([]);
    expect(result.manifest?.files.allow).toMatchObject({
      delete: [],
      read: ["./**"],
      write: ["./tmp/**"],
    });
    expect(result.manifest?.files.deny.read).toEqual(
      expect.arrayContaining(["./.git/**", "./**/.git/**", "./secrets/**"]),
    );
  });

  it("parses static settings declarations into typed backend contracts", () => {
    const manifest = baseManifest({
      settings: {
        global: [
          {
            key: "base_url",
            label: "Base URL",
            kind: "url",
            default: "https://api.example.test/v1",
            required: true,
          },
          {
            key: "mode",
            label: "Mode",
            kind: "enum",
            options: ["fast", "safe"],
            default: "safe",
          },
        ],
        user: [
          {
            key: "notify_on",
            label: "Notify on",
            kind: "list",
            items: { kind: "email" },
            default: ["admin@example.test", "ops@example.test"],
          },
          {
            key: "weights",
            label: "Weights",
            kind: "list",
            items: { kind: "number" },
            default: [1, 2.5],
          },
          {
            key: "birthday",
            label: "Birthday",
            kind: "date",
            default: "2026-04-28",
          },
          {
            key: "token",
            label: "Token",
            kind: "secret",
            default: null,
          },
        ],
      },
    });

    const result = parsePluginManifest(
      JSON.stringify(manifest),
      "settings.json",
    );

    expect(result.issues).toEqual([]);
    expect(result.manifest?.settings).toContainEqual({
      defaultValue: "https://api.example.test/v1",
      description: null,
      hasDefault: true,
      items: null,
      key: "base_url",
      kind: "url",
      label: "Base URL",
      options: [],
      required: true,
    });
    expect(result.manifest?.settings).toContainEqual({
      defaultValue: "safe",
      description: null,
      hasDefault: true,
      items: null,
      key: "mode",
      kind: "enum",
      label: "Mode",
      options: ["fast", "safe"],
      required: false,
    });
  });

  it("parses Pi auth bindings from declared plugin settings", () => {
    const result = parsePluginManifest(
      JSON.stringify(
        baseManifest({
          settings: {
            general: [
              {
                key: "api_key",
                label: "API key",
                kind: "secret",
              },
            ],
          },
          piAuth: [
            {
              kind: "api_key",
              provider: "openai",
              source: "setting",
              value: "api_key",
            },
          ],
        }),
      ),
      "pi-auth.json",
    );

    expect(result.issues).toEqual([]);
    expect(result.manifest?.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "openai",
        source: "setting",
        value: "api_key",
      },
    ]);
  });

  it("rejects Pi auth setting bindings that do not reference declared settings", () => {
    expect(
      issueCodesFor(
        baseManifest({
          piAuth: [
            {
              kind: "api_key",
              provider: "openai",
              source: "setting",
              value: "api_key",
            },
          ],
        }),
      ),
    ).toEqual(expect.arrayContaining(["invalid_manifest_field_value"]));
  });

  it("round-trips list setting storage values with comma and backslash escapes", () => {
    const encoded = encodePluginSettingListValue([
      "alpha,beta",
      "gamma\\delta",
      "",
    ]);

    expect(encoded).toBe("alpha\\,beta,gamma\\\\delta,");

    expect(decodePluginSettingListValue(encoded)).toEqual([
      "alpha,beta",
      "gamma\\delta",
      "",
    ]);
  });

  it("rejects representative schema-backed rules in both validators", () => {
    const validateManifest = buildSchemaValidator();
    const invalidCases: SchemaBackedInvalidCase[] = [
      {
        name: "invalid core field type",
        manifest: baseManifest({ description: null }),
        typedIssueCodes: ["invalid_manifest_field_type"],
      },
      {
        name: "reserved plugin id",
        manifest: baseManifest({ id: "metidos" }),
        typedIssueCodes: ["reserved_plugin_id"],
      },
      {
        name: "reserved plugin display name",
        manifest: baseManifest({ name: "Metidos" }),
        typedIssueCodes: ["reserved_plugin_name"],
      },
      {
        name: "duplicate permission",
        manifest: baseManifest({
          permissions: ["storage:read", "storage:read"],
        }),
        typedIssueCodes: ["duplicate_manifest_permission"],
      },
      {
        name: "sqlite without storage write",
        manifest: baseManifest({ permissions: ["sqlite"] }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "terminal create without unsafe",
        manifest: baseManifest({ permissions: ["terminal:create"] }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "network fetch without allowlist",
        manifest: baseManifest({ permissions: ["network:fetch"] }),
        typedIssueCodes: ["missing_required_manifest_field"],
      },
      {
        name: "credentialed network pattern",
        manifest: baseManifest({
          network: { allow: ["https://user:secret@example.test/**"] },
          permissions: ["network:fetch"],
        }),
        typedIssueCodes: ["credentialed_network_allow_pattern"],
      },
      {
        name: "credentialed network pattern with omitted protocol",
        manifest: baseManifest({
          network: { allow: ["user:secret@example.test/**"] },
          permissions: ["network:fetch"],
        }),
        typedIssueCodes: ["credentialed_network_allow_pattern"],
      },
      {
        name: "file allowlist without permission",
        manifest: baseManifest({ files: { allow: { write: ["./src/**"] } } }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "tool id with colon",
        manifest: baseManifest({
          access: [
            {
              id: "tools",
              name: "Tools",
              tools: [
                {
                  description: "Invalid tool id.",
                  name: "bad:tool",
                  timeoutMs: 5000,
                },
              ],
            },
          ],
        }),
        typedIssueCodes: ["invalid_manifest_field_value"],
      },
      {
        name: "secret env default",
        manifest: baseManifest({
          env: [{ key: "TOKEN", secret: true, default: "unsafe" }],
        }),
        typedIssueCodes: ["secret_env_default"],
      },
      {
        name: "enum setting without options",
        manifest: baseManifest({
          settings: {
            global: [{ key: "mode", label: "Mode", kind: "enum" }],
          },
        }),
        typedIssueCodes: ["missing_required_manifest_field"],
      },
      {
        name: "list setting without items",
        manifest: baseManifest({
          settings: {
            user: [{ key: "recipients", label: "Recipients", kind: "list" }],
          },
        }),
        typedIssueCodes: ["missing_required_manifest_field"],
      },
      {
        name: "invalid date setting default",
        manifest: baseManifest({
          settings: {
            user: [
              {
                key: "birthday",
                label: "Birthday",
                kind: "date",
                default: "04/28/2026",
              },
            ],
          },
        }),
        typedIssueCodes: ["invalid_manifest_field_value"],
      },
      {
        name: "invalid list item kind",
        manifest: baseManifest({
          settings: {
            user: [
              {
                key: "tokens",
                label: "Tokens",
                kind: "list",
                items: { kind: "secret" },
              },
            ],
          },
        }),
        typedIssueCodes: ["invalid_manifest_field_value"],
      },
      {
        name: "provider without permission",
        manifest: baseManifest({
          providers: [
            {
              id: "models",
              name: "Models",
              description: "Registers models.",
              timeoutMs: 30000,
            },
          ],
        }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "notification provider without permission",
        manifest: baseManifest({
          notificationProviders: [
            {
              id: "notify",
              name: "Notify",
              description: "Registers notifications.",
              timeoutMs: 30000,
            },
          ],
        }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "OAuth provider without permission",
        manifest: baseManifest({
          oauthProviders: [
            {
              id: "oauth",
              name: "OAuth",
              description: "Registers OAuth credentials.",
              timeoutMs: 30000,
            },
          ],
        }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "codex auth file without storage read",
        manifest: baseManifest({
          env: [{ key: "CODEX_AUTH_JSON_PATH" }],
          piAuth: [
            {
              kind: "codex_auth",
              provider: "openai-codex",
              source: "env",
              value: "CODEX_AUTH_JSON_PATH",
            },
          ],
        }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "Pi OAuth auth file without storage read",
        manifest: baseManifest({
          env: [{ key: "GITHUB_COPILOT_AUTH_JSON_PATH" }],
          piAuth: [
            {
              kind: "pi_oauth_file",
              provider: "github-copilot",
              source: "env",
              value: "GITHUB_COPILOT_AUTH_JSON_PATH",
            },
          ],
        }),
        typedIssueCodes: ["missing_required_permission"],
      },
      {
        name: "disabled gc declaration",
        manifest: baseManifest({ gc: { enabled: false, timeoutMs: 30000 } }),
        typedIssueCodes: ["invalid_manifest_field_value"],
      },
      {
        name: "limit above maximum",
        manifest: baseManifest({ limits: { maxTextResultBytes: 262145 } }),
        typedIssueCodes: ["invalid_manifest_field_value"],
      },
    ];

    for (const invalidCase of invalidCases) {
      expectSchemaRejects(validateManifest, invalidCase.manifest);
      expect(issueCodesFor(invalidCase.manifest)).toEqual(
        expect.arrayContaining(invalidCase.typedIssueCodes),
      );
    }
  });
});

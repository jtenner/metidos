/**
 * @file src/bun/plugin/inventory.test.ts
 * @description Tests for local-operator-facing Metidos plugin inventory grouping and authorization.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "../db";
import { RPC_PLUGIN_INVENTORY_GROUP_LABELS } from "../rpc-schema/plugin";
import { discoverPluginCandidates, getPluginsDirectoryPath } from "./discovery";
import { PLUGIN_ENV_SECRET_MASK } from "./env";
import {
  buildPluginInventory,
  buildPluginInventoryFromDiscoverySnapshot,
} from "./inventory";
import {
  buildPluginInventoryWithLifecycle,
  computePluginReviewHash,
  recordPluginRuntimeActivation,
  recordPluginRuntimeFailure,
  runPluginAdminAction,
  runPluginLifecycleAction,
} from "./lifecycle";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

const ADMIN_CONTEXT = {
  auth: {
    isAdmin: true,
    sessionId: "admin-session",
    stepUpValidUntil: "2999-01-01T00:00:00.000Z",
    userId: 1,
    username: "admin",
  },
  priority: "foreground" as const,
  signal: new AbortController().signal,
  timeoutMs: null,
};

const USER_CONTEXT = {
  auth: {
    isAdmin: false,
    sessionId: "user-session",
    userId: 2,
    username: "user",
  },
  priority: "foreground" as const,
  signal: new AbortController().signal,
  timeoutMs: null,
};

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function writePlugin(
  pluginsDirectoryPath: string,
  directoryName: string,
  manifest: Record<string, unknown>,
): string {
  const pluginPath = join(pluginsDirectoryPath, directoryName);
  mkdirSync(pluginPath, { recursive: true });
  writeFileSync(
    join(pluginPath, "metidos-plugin.json"),
    `${JSON.stringify({ main: "./index.ts", ...manifest })}\n`,
  );
  writeFileSync(join(pluginPath, "AGENTS.md"), "# Test plugin\n");
  writeFileSync(
    join(pluginPath, "index.ts"),
    "throw new Error('do not run');\n",
  );
  return pluginPath;
}

const REVIEW_HASH_FIXTURE_FILES = {
  "AGENTS.md": "# Review Hash Fixture\n",
  "index.ts": "export default {};\n",
  "metidos-plugin.json": `${JSON.stringify({
    description: "Review hash fixture.",
    id: "review_hash_fixture",
    main: "./index.ts",
    metidosApiVersion: "v1",
    name: "Review Hash Fixture",
    version: "1.0.0",
  })}\n`,
  "seed/default.json": '{"enabled":true}\n',
  "src/support.ts": "export const supported = true;\n",
} as const;

function writeReviewHashFixture(
  pluginPath: string,
  order: readonly (keyof typeof REVIEW_HASH_FIXTURE_FILES)[] = Object.keys(
    REVIEW_HASH_FIXTURE_FILES,
  ) as (keyof typeof REVIEW_HASH_FIXTURE_FILES)[],
): void {
  mkdirSync(pluginPath, { recursive: true });
  for (const relativePath of order) {
    const parts = relativePath.split("/");
    const parentPath =
      parts.length > 1 ? join(pluginPath, ...parts.slice(0, -1)) : pluginPath;
    mkdirSync(parentPath, { recursive: true });
    writeFileSync(
      join(pluginPath, ...parts),
      REVIEW_HASH_FIXTURE_FILES[relativePath],
    );
  }
}

function readExampleManifest(fileName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join("docs", "examples", fileName), "utf8"),
  ) as Record<string, unknown>;
}

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
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

describe("plugin inventory", () => {
  it("accepts documented example manifests and applies core defaults", async () => {
    const appDataDir = createTempDirectory(
      "metidos-plugin-inventory-examples-",
    );
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(
      pluginsDirectoryPath,
      "hello_tool",
      readExampleManifest("metidos-plugin-minimal-tool.json"),
    );
    writePlugin(
      pluginsDirectoryPath,
      "local_ollama_provider",
      readExampleManifest("metidos-plugin-provider.json"),
    );

    const inventory = await buildPluginInventory({
      appDataDir,
      stepUpVerified: true,
    });

    expect(inventory.plugins.map((plugin) => plugin.directoryName)).toEqual([
      "hello_tool",
      "local_ollama_provider",
    ]);
    expect(
      inventory.plugins.flatMap((plugin) => plugin.validationErrors),
    ).toEqual([]);
    expect(inventory.plugins[0]?.manifest).toMatchObject({
      access: [
        expect.objectContaining({
          id: "hello_tools",
          tools: [expect.objectContaining({ name: "hello_world" })],
        }),
      ],
      permissions: ["storage:read", "storage:write", "log:write"],
      storageDefaults: {
        maxDataBytes: 104857600,
        maxFileBytes: 10485760,
        maxFiles: 10000,
      },
      telemetry: true,
    });
    expect(inventory.plugins[1]?.manifest).toMatchObject({
      network: {
        allow: ["http://localhost:11434/**", "http://127.0.0.1:11434/**"],
        enforceHttps: false,
      },
      providers: [expect.objectContaining({ id: "ollama" })],
      settings: [expect.objectContaining({ key: "refresh_interval_minutes" })],
    });
  });

  it("reports activation-blocking core manifest validation errors", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-inventory-core-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(pluginsDirectoryPath, "missing_description", {
      id: "missing_description",
      name: "Missing Description",
      version: "1.0.0",
      metidosApiVersion: "v1",
    });
    writePlugin(pluginsDirectoryPath, "bad_api", {
      id: "bad_api",
      name: "Bad API",
      version: "1.0.0",
      metidosApiVersion: "v2",
      description: "Invalid API version.",
    });
    writePlugin(pluginsDirectoryPath, "bad_id", {
      id: "Bad-ID",
      name: "Bad ID",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Invalid id.",
    });
    writePlugin(pluginsDirectoryPath, "metidos", {
      id: "metidos",
      name: "Reserved ID",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Reserved plugin id.",
    });
    writePlugin(pluginsDirectoryPath, "reserved_name", {
      id: "reserved_name",
      name: "Metidos",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Reserved plugin display name.",
    });
    writePlugin(pluginsDirectoryPath, "duplicate_alpha", {
      id: "duplicate_plugin",
      name: "Duplicate Alpha",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Duplicate plugin id.",
    });
    writePlugin(pluginsDirectoryPath, "duplicate_beta", {
      id: "duplicate_plugin",
      name: "Duplicate Beta",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Duplicate plugin id.",
    });
    writePlugin(pluginsDirectoryPath, "bad_version", {
      id: "bad_version",
      name: "Bad Version",
      version: "01.0.0",
      metidosApiVersion: "v1",
      description: "Invalid semver.",
    });
    writePlugin(pluginsDirectoryPath, "mismatch_plugin", {
      id: "different_plugin",
      name: "Mismatch Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Manifest id must match folder name.",
    });
    const invalidShapePath = writePlugin(
      pluginsDirectoryPath,
      "array_manifest",
      {
        id: "array_manifest",
        name: "Array Manifest",
        version: "1.0.0",
        metidosApiVersion: "v1",
        description: "Invalid manifest shape.",
      },
    );
    writeFileSync(join(invalidShapePath, "metidos-plugin.json"), "[]\n");
    const invalidJsonPath = writePlugin(pluginsDirectoryPath, "invalid_json", {
      id: "invalid_json",
      name: "Invalid JSON",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Invalid manifest JSON.",
    });
    writeFileSync(join(invalidJsonPath, "metidos-plugin.json"), "{\n");

    const inventory = await buildPluginInventory({
      appDataDir,
      stepUpVerified: true,
    });
    const errorsByDirectory = new Map(
      inventory.plugins.map((plugin) => [
        plugin.directoryName,
        plugin.validationErrors,
      ]),
    );

    expect(errorsByDirectory.get("missing_description")).toEqual([
      expect.objectContaining({
        code: "missing_required_manifest_field",
        message: expect.stringContaining("description"),
        path: expect.stringContaining("#/description"),
      }),
    ]);
    expect(errorsByDirectory.get("bad_api")).toEqual([
      expect.objectContaining({
        code: "invalid_manifest_field_value",
        message: expect.stringContaining("metidosApiVersion"),
        path: expect.stringContaining("#/metidosApiVersion"),
      }),
    ]);
    expect(errorsByDirectory.get("bad_id")).toEqual([
      expect.objectContaining({
        code: "invalid_manifest_field_value",
        message: expect.stringContaining("id"),
        path: expect.stringContaining("#/id"),
      }),
    ]);
    expect(errorsByDirectory.get("metidos")).toEqual([
      expect.objectContaining({
        code: "reserved_plugin_id",
        message: expect.stringContaining("metidos"),
        path: expect.stringContaining("#/id"),
      }),
    ]);
    expect(errorsByDirectory.get("reserved_name")).toEqual([
      expect.objectContaining({
        code: "reserved_plugin_name",
        message: expect.stringContaining("Metidos"),
        path: expect.stringContaining("#/name"),
      }),
    ]);
    expect(errorsByDirectory.get("duplicate_alpha")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "plugin_id_directory_mismatch" }),
        expect.objectContaining({ code: "duplicate_plugin_id" }),
      ]),
    );
    expect(errorsByDirectory.get("duplicate_beta")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "plugin_id_directory_mismatch" }),
        expect.objectContaining({ code: "duplicate_plugin_id" }),
      ]),
    );
    expect(errorsByDirectory.get("bad_version")).toEqual([
      expect.objectContaining({
        code: "invalid_manifest_field_value",
        message: expect.stringContaining("version"),
        path: expect.stringContaining("#/version"),
      }),
    ]);
    expect(errorsByDirectory.get("mismatch_plugin")).toEqual([
      expect.objectContaining({ code: "plugin_id_directory_mismatch" }),
    ]);
    expect(errorsByDirectory.get("array_manifest")).toEqual([
      expect.objectContaining({ code: "invalid_manifest_shape" }),
    ]);
    expect(errorsByDirectory.get("invalid_json")).toEqual([
      expect.objectContaining({ code: "invalid_manifest_json" }),
    ]);
  });

  it("summarizes env declarations with masked secret review values", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-inventory-env-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const originalAlphaToken = process.env.ALPHA_TOKEN;
    const originalAlphaRegion = process.env.ALPHA_REGION;
    try {
      process.env.ALPHA_TOKEN = "secret-token";
      delete process.env.ALPHA_REGION;
      writePlugin(pluginsDirectoryPath, "alpha_plugin", {
        description: "Env summary test plugin.",
        env: [
          { key: "ALPHA_TOKEN", required: true, secret: true },
          { key: "ALPHA_REGION", default: "us-west-2" },
        ],
        id: "alpha_plugin",
        metidosApiVersion: "v1",
        name: "Alpha Plugin",
        version: "1.0.0",
      });

      const inventory = await buildPluginInventory({
        appDataDir,
        stepUpVerified: true,
      });
      expect(inventory.plugins[0]?.manifest.env).toEqual([
        {
          defaultValue: null,
          description: null,
          hasDefault: false,
          key: "ALPHA_TOKEN",
          required: true,
          reviewValue: PLUGIN_ENV_SECRET_MASK,
          secret: true,
        },
        {
          defaultValue: "us-west-2",
          description: null,
          hasDefault: true,
          key: "ALPHA_REGION",
          required: null,
          reviewValue: "us-west-2",
          secret: null,
        },
      ]);
      expect(PLUGIN_ENV_SECRET_MASK).toBe("<secret>");
    } finally {
      if (originalAlphaToken === undefined) {
        delete process.env.ALPHA_TOKEN;
      } else {
        process.env.ALPHA_TOKEN = originalAlphaToken;
      }
      if (originalAlphaRegion === undefined) {
        delete process.env.ALPHA_REGION;
      } else {
        process.env.ALPHA_REGION = originalAlphaRegion;
      }
    }
  });

  it("reports activation-blocking permission, access, and file declaration errors", async () => {
    const appDataDir = createTempDirectory(
      "metidos-plugin-inventory-declarations-",
    );
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const manifest = (id: string, extra: Record<string, unknown>) => ({
      id,
      name: id,
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Invalid declaration test plugin.",
      ...extra,
    });

    writePlugin(
      pluginsDirectoryPath,
      "duplicate_permissions",
      manifest("duplicate_permissions", {
        permissions: ["storage:read", "storage:read"],
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "too_many_groups",
      manifest("too_many_groups", {
        access: Array.from({ length: 26 }, (_, index) => ({
          id: `group_${index}`,
          name: `Group ${index}`,
          tools: [
            {
              name: "shared_tool",
              description: "Shared tool.",
              timeoutMs: 5000,
            },
          ],
        })),
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "too_many_tools",
      manifest("too_many_tools", {
        access: [
          {
            id: "tools",
            name: "Tools",
            tools: Array.from({ length: 31 }, (_, index) => ({
              name: `tool_${index}`,
              description: "Tool.",
              timeoutMs: 5000,
            })),
          },
        ],
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "invalid_tool",
      manifest("invalid_tool", {
        access: [
          {
            id: "tools",
            name: "Tools",
            tools: [
              {
                name: "bad:tool",
                description: "Invalid tool.",
                timeoutMs: 999,
              },
            ],
          },
        ],
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "missing_file_permission",
      manifest("missing_file_permission", {
        files: { allow: { write: ["./src/**"] } },
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "broad_file_pattern",
      manifest("broad_file_pattern", {
        permissions: ["files:read"],
        files: { allow: { read: ["./**"] } },
      }),
    );

    const inventory = await buildPluginInventory({
      appDataDir,
      stepUpVerified: true,
    });
    const errorCodesByDirectory = new Map(
      inventory.plugins.map((plugin) => [
        plugin.directoryName,
        plugin.validationErrors.map((error) => error.code),
      ]),
    );
    const invalidToolErrors = inventory.plugins.find(
      (plugin) => plugin.directoryName === "invalid_tool",
    )?.validationErrors;

    expect(errorCodesByDirectory.get("duplicate_permissions")).toContain(
      "duplicate_manifest_permission",
    );
    expect(errorCodesByDirectory.get("too_many_groups")).toContain(
      "too_many_access_groups",
    );
    expect(errorCodesByDirectory.get("too_many_tools")).toEqual(
      expect.arrayContaining([
        "too_many_access_group_tools",
        "too_many_distinct_access_tools",
      ]),
    );
    expect(invalidToolErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_manifest_field_value",
          path: expect.stringContaining("#/access/0/tools/0/name"),
        }),
        expect.objectContaining({
          code: "invalid_manifest_field_value",
          path: expect.stringContaining("#/access/0/tools/0/timeoutMs"),
        }),
      ]),
    );
    expect(errorCodesByDirectory.get("missing_file_permission")).toContain(
      "missing_required_permission",
    );
    expect(errorCodesByDirectory.get("broad_file_pattern")).toEqual([]);
  });

  it("reports activation-blocking network, env, settings, provider, storage, GC, and limit errors", async () => {
    const appDataDir = createTempDirectory(
      "metidos-plugin-inventory-v1-declarations-",
    );
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const manifest = (id: string, extra: Record<string, unknown>) => ({
      id,
      name: id,
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Invalid declaration test plugin.",
      ...extra,
    });

    writePlugin(
      pluginsDirectoryPath,
      "network_missing_allow",
      manifest("network_missing_allow", {
        permissions: ["network:fetch"],
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "network_invalid_patterns",
      manifest("network_invalid_patterns", {
        permissions: ["network:fetch"],
        network: {
          allow: [
            "http://api.example.test/**",
            "https://user:secret@example.test/**",
            "ftp://files.example.test/**",
          ],
        },
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "network_http_explicit",
      manifest("network_http_explicit", {
        permissions: ["network:fetch"],
        network: {
          allow: ["http://localhost:11434/**"],
          enforceHttps: false,
        },
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "network_all_domains_safe",
      manifest("network_all_domains_safe", {
        permissions: ["network:fetch"],
        network: {
          allow: ["https://**/**"],
        },
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "network_all_domains_unsafe",
      manifest("network_all_domains_unsafe", {
        permissions: ["network:fetch", "unsafe"],
        network: {
          allow: ["https://**/**"],
        },
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "env_secret_default",
      manifest("env_secret_default", {
        env: [
          {
            key: "TOKEN",
            required: true,
            secret: true,
            default: "do-not-allow",
          },
        ],
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "settings_invalid_defaults",
      manifest("settings_invalid_defaults", {
        settings: {
          global: [
            {
              key: "launch_day",
              label: "Launch day",
              kind: "date",
              default: "04/28/2026",
            },
            {
              key: "secrets",
              label: "Secrets",
              kind: "secret",
              default: ["not", "scalar"],
            },
          ],
          user: [
            {
              key: "recipients",
              label: "Recipients",
              kind: "list",
              items: { kind: "number" },
            },
          ],
        },
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "provider_missing_permission",
      manifest("provider_missing_permission", {
        providers: [
          {
            id: "models",
            name: "Models",
            description: "Registers models.",
            timeoutMs: 30000,
          },
        ],
        notificationProviders: [
          {
            id: "notify",
            name: "Notify",
            description: "Registers notifications.",
            timeoutMs: 30000,
          },
        ],
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "provider_invalid_fields",
      manifest("provider_invalid_fields", {
        permissions: ["provider:register"],
        providers: [
          {
            id: "Bad Provider",
            name: "",
            description: "Invalid provider.",
            timeoutMs: 999,
          },
        ],
      }),
    );
    writePlugin(
      pluginsDirectoryPath,
      "storage_gc_limits_invalid",
      manifest("storage_gc_limits_invalid", {
        storage: {
          defaults: {
            maxDataBytes: 0,
            maxFileBytes: 1024.5,
            maxFiles: 0,
          },
        },
        gc: {
          enabled: false,
          timeoutMs: 999,
        },
        limits: {
          maxRpcPayloadBytes: 0,
          maxTextResultBytes: 262145,
          maxNetworkResponseBytes: 26214401,
          sidecarMemoryBytes: 1024,
        },
      }),
    );

    const inventory = await buildPluginInventory({
      appDataDir,
      stepUpVerified: true,
    });
    const errorCodesByDirectory = new Map(
      inventory.plugins.map((plugin) => [
        plugin.directoryName,
        plugin.validationErrors.map((error) => error.code),
      ]),
    );
    const warningCodesByDirectory = new Map(
      inventory.plugins.map((plugin) => [
        plugin.directoryName,
        plugin.reviewWarnings.map((warning) => warning.code),
      ]),
    );

    expect(errorCodesByDirectory.get("network_missing_allow")).toContain(
      "missing_required_manifest_field",
    );
    expect(errorCodesByDirectory.get("network_invalid_patterns")).toEqual(
      expect.arrayContaining([
        "network_https_required",
        "credentialed_network_allow_pattern",
        "invalid_network_allow_pattern",
      ]),
    );
    expect(errorCodesByDirectory.get("network_http_explicit")).toEqual([]);
    expect(warningCodesByDirectory.get("network_http_explicit")).toContain(
      "private_network_allow_declared",
    );
    expect(errorCodesByDirectory.get("network_all_domains_safe")).toContain(
      "unsafe_network_all_domain_required",
    );
    expect(errorCodesByDirectory.get("network_all_domains_unsafe")).toEqual([]);
    expect(warningCodesByDirectory.get("network_all_domains_unsafe")).toEqual(
      expect.arrayContaining([
        "unsafe_permission_declared",
        "unsafe_all_domain_network_declared",
      ]),
    );
    expect(errorCodesByDirectory.get("env_secret_default")).toContain(
      "secret_env_default",
    );
    expect(errorCodesByDirectory.get("settings_invalid_defaults")).toEqual(
      expect.arrayContaining([
        "invalid_manifest_field_value",
        "non_scalar_secret_setting",
      ]),
    );
    expect(errorCodesByDirectory.get("provider_missing_permission")).toEqual(
      expect.arrayContaining([
        "missing_required_permission",
        "missing_required_permission",
      ]),
    );
    expect(errorCodesByDirectory.get("provider_invalid_fields")).toContain(
      "invalid_manifest_field_value",
    );
    expect(errorCodesByDirectory.get("storage_gc_limits_invalid")).toEqual(
      expect.arrayContaining([
        "invalid_manifest_field_value",
        "invalid_manifest_field_type",
      ]),
    );
  });

  it("rejects lifecycle approval for permissions requiring stronger grants", async () => {
    const appDataDir = createTempDirectory(
      "metidos-plugin-lifecycle-declarations-",
    );
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(pluginsDirectoryPath, "sqlite_plugin", {
      id: "sqlite_plugin",
      name: "SQLite Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "SQLite without storage write.",
      permissions: ["sqlite"],
    });
    writePlugin(pluginsDirectoryPath, "terminal_plugin", {
      id: "terminal_plugin",
      name: "Terminal Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Terminal create without unsafe.",
      permissions: ["terminal:create"],
    });

    await expect(
      runPluginLifecycleAction(
        {
          action: "enable",
          directoryName: "sqlite_plugin",
        },
        { appDataDir, stepUpVerified: true },
      ),
    ).rejects.toThrow("storage:write");
    await expect(
      runPluginLifecycleAction(
        {
          action: "enable",
          directoryName: "terminal_plugin",
        },
        { appDataDir, stepUpVerified: true },
      ),
    ).rejects.toThrow("unsafe");
  });

  it("rejects lifecycle approval and review actions when core manifest validation fails", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-lifecycle-core-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(pluginsDirectoryPath, "invalid_plugin", {
      id: "invalid_plugin",
      name: "Invalid Plugin",
      version: "1.0.0",
      metidosApiVersion: "v2",
      description: "Lifecycle should reject this plugin.",
    });

    for (const action of ["enable", "review_changes", "reapprove"] as const) {
      await expect(
        runPluginLifecycleAction(
          {
            action,
            directoryName: "invalid_plugin",
          },
          { appDataDir, stepUpVerified: true },
        ),
      ).rejects.toThrow(
        /metidosApiVersion.*#\/metidosApiVersion.*invalid_manifest_field_value/,
      );
    }
  });

  it("groups discovered plugins by the v1 inventory labels and includes safe manifest summaries", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-inventory-groups-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(pluginsDirectoryPath, "alpha_plugin", {
      id: "alpha_plugin",
      name: "Alpha Plugin",
      version: "1.2.3",
      metidosApiVersion: "v1",
      description: "Inventory summary source.",
      permissions: [
        "storage:read",
        "files:read",
        "network:fetch",
        "provider:register",
        "notification:provider",
        "unsafe",
      ],
      access: [
        {
          id: "alpha_access",
          name: "Alpha Access",
          description: "Alpha tools.",
          tools: [
            {
              name: "alpha_tool",
              description: "Runs alpha work.",
              timeoutMs: 10000,
            },
          ],
        },
      ],
      files: {
        allow: {
          read: ["./docs/**"],
        },
      },
      network: {
        allow: ["https://api.example.test/**"],
        enforceHttps: true,
      },
      env: [
        {
          key: "ALPHA_TOKEN",
          description: "Alpha token.",
          required: true,
          secret: true,
        },
      ],
      settings: {
        global: [
          {
            key: "alpha_mode",
            label: "Alpha mode",
            kind: "string",
          },
        ],
      },
      providers: [
        {
          id: "alpha_provider",
          name: "Alpha Provider",
          description: "Provides alpha models.",
          timeoutMs: 30000,
        },
      ],
      notificationProviders: [
        {
          id: "alpha_notify",
          name: "Alpha Notify",
          description: "Sends alpha notifications.",
          timeoutMs: 30000,
        },
      ],
      storage: {
        defaults: {
          maxDataBytes: 1000,
          maxFileBytes: 100,
          maxFiles: 10,
        },
      },
      gc: {
        enabled: true,
        timeoutMs: 30000,
      },
      telemetry: false,
    });
    mkdirSync(join(pluginsDirectoryPath, "broken_plugin"));

    const inventory = await buildPluginInventory({
      appDataDir,
      now: () => new Date("2026-04-28T02:00:00Z"),
    });

    expect(inventory.scannedAt).toBe("2026-04-28T02:00:00.000Z");
    expect(inventory.groups.map((group) => group.label)).toEqual([
      ...RPC_PLUGIN_INVENTORY_GROUP_LABELS,
    ]);
    expect(inventory.groups.map((group) => group.count)).toEqual([
      2, 0, 0, 0, 0, 0,
    ]);
    expect(inventory.plugins.map((plugin) => plugin.directoryName)).toEqual([
      "alpha_plugin",
      "broken_plugin",
    ]);
    expect(inventory.plugins[0]).toMatchObject({
      description: "Inventory summary source.",
      group: "Uninitialized",
      name: "Alpha Plugin",
      pluginId: "alpha_plugin",
      status: "uninitialized",
      structurallyValid: true,
      version: "1.2.3",
    });
    expect(inventory.plugins[0]?.manifest).toMatchObject({
      access: [
        expect.objectContaining({
          id: "alpha_access",
          tools: [expect.objectContaining({ name: "alpha_tool" })],
        }),
      ],
      env: [expect.objectContaining({ key: "ALPHA_TOKEN", secret: true })],
      files: {
        allow: {
          read: ["./docs/**"],
        },
      },
      gc: {
        enabled: true,
        timeoutMs: 30000,
      },
      network: {
        allow: ["https://api.example.test/**"],
        enforceHttps: true,
      },
      notificationProviders: [expect.objectContaining({ id: "alpha_notify" })],
      permissions: [
        "storage:read",
        "files:read",
        "network:fetch",
        "provider:register",
        "notification:provider",
        "unsafe",
      ],
      providers: [expect.objectContaining({ id: "alpha_provider" })],
      settings: [expect.objectContaining({ key: "alpha_mode" })],
      storageDefaults: {
        maxDataBytes: 1000,
        maxFileBytes: 100,
        maxFiles: 10,
      },
      telemetry: false,
    });
    expect(inventory.plugins[0]?.reviewWarnings).toEqual([
      expect.objectContaining({ code: "unsafe_permission_declared" }),
    ]);
    expect(
      inventory.plugins[1]?.validationErrors.map((issue) => issue.code),
    ).toEqual(["missing_required_file", "missing_required_file"]);
  });

  it("places future lifecycle states in stable status groups", async () => {
    const appDataDir = createTempDirectory(
      "metidos-plugin-inventory-lifecycle-",
    );
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    for (const directoryName of [
      "active_plugin",
      "disabled_plugin",
      "failed_plugin",
      "missing_plugin",
      "review_plugin",
      "unavailable_plugin",
    ]) {
      writePlugin(pluginsDirectoryPath, directoryName, {
        id: directoryName,
        name: directoryName,
        version: "1.0.0",
        metidosApiVersion: "v1",
        description: "Lifecycle test plugin.",
      });
    }

    const snapshot = await discoverPluginCandidates({
      appDataDir,
      stepUpVerified: true,
    });
    const inventory = await buildPluginInventoryFromDiscoverySnapshot(
      snapshot,
      {
        lifecycleByDirectoryName: new Map([
          ["active_plugin", { state: "active" }],
          ["disabled_plugin", { state: "restart_required" }],
          ["failed_plugin", { state: "degraded" }],
          ["missing_plugin", { state: "missing" }],
          ["review_plugin", { state: "needs_review" }],
          ["unavailable_plugin", { state: "unavailable" }],
        ]),
      },
    );

    expect(inventory.groups.map((group) => [group.label, group.count])).toEqual(
      [
        ["Uninitialized", 0],
        ["Needs Review", 1],
        ["Active", 1],
        ["Failed/Degraded", 1],
        ["Disabled/Restart Required", 1],
        ["Missing/Unavailable", 2],
      ],
    );
  });

  it("reflects plugin folder additions and removals on subsequent inventory fetches", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-inventory-refresh-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });

    await expect(
      buildPluginInventory({ appDataDir, stepUpVerified: true }),
    ).resolves.toMatchObject({
      plugins: [],
    });

    const pluginPath = writePlugin(pluginsDirectoryPath, "refresh_plugin", {
      id: "refresh_plugin",
      name: "Refresh Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Appears after refresh.",
    });
    await expect(
      buildPluginInventory({ appDataDir, stepUpVerified: true }),
    ).resolves.toMatchObject({
      plugins: [expect.objectContaining({ directoryName: "refresh_plugin" })],
    });

    rmSync(pluginPath, { recursive: true, force: true });
    await expect(
      buildPluginInventory({ appDataDir, stepUpVerified: true }),
    ).resolves.toMatchObject({
      plugins: [],
    });
  });

  it("computes deterministic review hashes over included files and excluded data paths", async () => {
    const rootPath = createTempDirectory("metidos-plugin-review-hash-");
    const pluginAPath = join(rootPath, "plugin-a");
    const pluginBPath = join(rootPath, "plugin-b");
    const fixtureFiles = Object.keys(
      REVIEW_HASH_FIXTURE_FILES,
    ) as (keyof typeof REVIEW_HASH_FIXTURE_FILES)[];
    writeReviewHashFixture(pluginAPath, fixtureFiles);
    writeReviewHashFixture(pluginBPath, [...fixtureFiles].reverse());

    const hashA = await computePluginReviewHash(pluginAPath);
    const hashB = await computePluginReviewHash(pluginBPath);
    expect(hashA.hash).toBeString();
    expect(hashB.hash).toBe(hashA.hash);

    mkdirSync(join(pluginAPath, ".data"));
    mkdirSync(join(pluginAPath, ".logs"));
    mkdirSync(join(pluginAPath, ".data-bak-2026-04-28T00-00-00Z"));
    writeFileSync(join(pluginAPath, ".data", "state.json"), "{}\n");
    writeFileSync(join(pluginAPath, ".logs", "log.txt"), "log\n");
    writeFileSync(
      join(pluginAPath, ".data-bak-2026-04-28T00-00-00Z", "state.json"),
      "{}\n",
    );
    await expect(computePluginReviewHash(pluginAPath)).resolves.toMatchObject({
      hash: hashA.hash,
    });

    for (const relativePath of fixtureFiles) {
      const changedPluginPath = join(
        rootPath,
        `changed-${relativePath.replace(/[^a-z0-9]/gi, "-")}`,
      );
      writeReviewHashFixture(changedPluginPath, fixtureFiles);
      const beforeChange = await computePluginReviewHash(changedPluginPath);
      const parts = relativePath.split("/");
      writeFileSync(
        join(changedPluginPath, ...parts),
        `${REVIEW_HASH_FIXTURE_FILES[relativePath]}changed\n`,
      );
      const afterChange = await computePluginReviewHash(changedPluginPath);
      expect(afterChange.hash).toBeString();
      expect(afterChange.hash).not.toBe(beforeChange.hash);
    }
  });

  it("blocks plugin approval when root node_modules is present", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-node-modules-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const pluginPath = writePlugin(
      pluginsDirectoryPath,
      "node_modules_plugin",
      {
        id: "node_modules_plugin",
        name: "Node Modules Plugin",
        version: "1.0.0",
        metidosApiVersion: "v1",
        description: "Root node_modules must block approval.",
      },
    );
    mkdirSync(join(pluginPath, "node_modules"));

    await expect(
      runPluginLifecycleAction(
        {
          action: "enable",
          directoryName: "node_modules_plugin",
        },
        { appDataDir, stepUpVerified: true },
      ),
    ).rejects.toThrow("node_modules");
  });

  const symlinkAwareIt = process.platform === "win32" ? it.skip : it;

  symlinkAwareIt(
    "blocks plugin review hashing when a symlink is present",
    async () => {
      const appDataDir = createTempDirectory("metidos-plugin-symlink-");
      const outsidePath = createTempDirectory(
        "metidos-plugin-symlink-outside-",
      );
      const pluginsDirectoryPath = getPluginsDirectoryPath({
        appDataDir,
        stepUpVerified: true,
      });
      mkdirSync(pluginsDirectoryPath, { recursive: true });
      const pluginPath = writePlugin(pluginsDirectoryPath, "symlink_plugin", {
        id: "symlink_plugin",
        name: "Symlink Plugin",
        version: "1.0.0",
        metidosApiVersion: "v1",
        description: "Symlinks must block approval.",
      });
      writeFileSync(join(outsidePath, "secret.txt"), "secret\n");
      symlinkSync(
        join(outsidePath, "secret.txt"),
        join(pluginPath, "secret.txt"),
      );

      await expect(computePluginReviewHash(pluginPath)).resolves.toMatchObject({
        hash: null,
        issues: [
          expect.objectContaining({ code: "unsupported_review_symlink" }),
        ],
      });
      await expect(
        runPluginLifecycleAction(
          {
            action: "enable",
            directoryName: "symlink_plugin",
          },
          { appDataDir, stepUpVerified: true },
        ),
      ).rejects.toThrow("symlink");
    },
  );

  it("persists admin lifecycle approval, review, disable, and retry state without executing plugin code", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-lifecycle-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const pluginPath = writePlugin(pluginsDirectoryPath, "review_plugin", {
      id: "review_plugin",
      name: "Review Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Lifecycle action test plugin.",
    });

    const approval = await runPluginLifecycleAction(
      {
        action: "enable",
        directoryName: "review_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:00:00Z"),
        username: "admin",
      },
    );

    expect(approval.plugin).toMatchObject({
      approvedReviewHash: approval.plugin.currentReviewHash,
      group: "Active",
      lifecycle: expect.objectContaining({
        approvedAt: "2026-04-28T03:00:00.000Z",
        approvedBy: "admin",
        enabled: true,
        restartRequired: false,
        state: "active",
      }),
      status: "active",
    });
    const storedLifecycle = JSON.parse(
      readFileSync(join(appDataDir, "plugin-lifecycle-v1.json"), "utf8"),
    ) as {
      plugins: Record<string, Record<string, unknown>>;
    };
    expect(storedLifecycle.plugins.review_plugin).toMatchObject({
      approvedAt: "2026-04-28T03:00:00.000Z",
      approvedBy: "admin",
      approvedReviewHash: approval.plugin.currentReviewHash,
      enabled: true,
      logSettings: {
        enabled: false,
        maxBytes: 25 * 1024 * 1024,
        retentionDays: 14,
      },
      manifest: {
        description: "Lifecycle action test plugin.",
        metidosApiVersion: "v1",
        name: "Review Plugin",
        pluginId: "review_plugin",
        version: "1.0.0",
      },
      notificationSettings: {
        enabled: true,
        perDayLimit: 25,
        perMinuteLimit: 3,
      },
      pluginId: "review_plugin",
      quotaSettings: {
        maxDataBytes: 100 * 1024 * 1024,
        maxFileBytes: 10 * 1024 * 1024,
        maxFiles: 10_000,
      },
      state: "active",
    });

    writeFileSync(join(pluginPath, "README.md"), "# Changed review input\n");
    const changedInventory = await buildPluginInventoryWithLifecycle({
      appDataDir,
    });
    expect(changedInventory.plugins[0]).toMatchObject({
      group: "Needs Review",
      lifecycle: expect.objectContaining({
        enabled: false,
        state: "needs_review",
      }),
      lifecycleMessage:
        "Plugin files changed since approval. Review Plugin Changes and Re-approve Plugin before runtime loading resumes.",
      status: "needs_review",
    });

    const review = await runPluginLifecycleAction(
      {
        action: "review_changes",
        directoryName: "review_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:05:00Z"),
        username: "admin",
      },
    );
    expect(review.plugin).toMatchObject({
      approvedReviewHash: approval.plugin.approvedReviewHash,
      group: "Needs Review",
    });

    const reapproval = await runPluginLifecycleAction(
      {
        action: "reapprove",
        directoryName: "review_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:06:00Z"),
        username: "admin",
      },
    );
    expect(reapproval.plugin).toMatchObject({
      approvedReviewHash: reapproval.plugin.currentReviewHash,
      group: "Active",
      status: "active",
    });

    const disabled = await runPluginLifecycleAction(
      {
        action: "disable",
        directoryName: "review_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:07:00Z"),
        username: "admin",
      },
    );
    expect(disabled.plugin).toMatchObject({
      group: "Disabled/Restart Required",
      status: "disabled_restart_required",
    });
    expect(disabled.message).toContain("Restart Metidos");

    const retried = await runPluginLifecycleAction(
      {
        action: "retry",
        directoryName: "review_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:08:00Z"),
        username: "admin",
      },
    );
    expect(retried.plugin).toMatchObject({
      group: "Active",
      status: "active",
    });
  });

  it("restores approved lifecycle records across inventory rebuilds and preserves activated-once through review", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-lifecycle-restore-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const pluginPath = writePlugin(pluginsDirectoryPath, "restore_plugin", {
      id: "restore_plugin",
      name: "Restore Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Lifecycle restore test plugin.",
    });

    const approval = await runPluginLifecycleAction(
      {
        action: "enable",
        directoryName: "restore_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:10:00Z"),
        username: "admin",
      },
    );
    const approvedReviewHash = approval.plugin.approvedReviewHash;
    if (!approvedReviewHash) {
      throw new Error("Expected approval to persist a review hash.");
    }

    await recordPluginRuntimeActivation("restore_plugin", {
      appDataDir,
      now: () => new Date("2026-04-28T03:11:00Z"),
      username: "runtime",
    });

    const restartedInventory = await buildPluginInventoryWithLifecycle({
      appDataDir,
    });
    expect(restartedInventory.plugins[0]).toMatchObject({
      approvedReviewHash,
      currentReviewHash: approvedReviewHash,
      group: "Active",
      lifecycle: expect.objectContaining({
        activatedOnce: true,
        enabled: true,
        state: "active",
      }),
      status: "active",
    });

    writeFileSync(join(pluginPath, "README.md"), "# Changed review input\n");
    const changedInventory = await buildPluginInventoryWithLifecycle({
      appDataDir,
    });
    expect(changedInventory.plugins[0]).toMatchObject({
      approvedReviewHash,
      group: "Needs Review",
      lifecycle: expect.objectContaining({
        activatedOnce: true,
        enabled: false,
        state: "needs_review",
      }),
      status: "needs_review",
    });

    const review = await runPluginLifecycleAction(
      {
        action: "review_changes",
        directoryName: "restore_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:12:00Z"),
        username: "admin",
      },
    );
    expect(review.plugin.lifecycle).toMatchObject({
      activatedOnce: true,
      state: "needs_review",
    });

    const reapproval = await runPluginLifecycleAction(
      {
        action: "reapprove",
        directoryName: "restore_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:13:00Z"),
        username: "admin",
      },
    );
    expect(reapproval.plugin).toMatchObject({
      approvedReviewHash: reapproval.plugin.currentReviewHash,
      group: "Active",
      lifecycle: expect.objectContaining({
        activatedOnce: true,
        enabled: true,
        state: "active",
      }),
      status: "active",
    });
    expect(reapproval.plugin.approvedReviewHash).not.toBe(approvedReviewHash);

    const storedLifecycle = JSON.parse(
      readFileSync(join(appDataDir, "plugin-lifecycle-v1.json"), "utf8"),
    ) as {
      plugins: Record<string, Record<string, unknown>>;
    };
    expect(storedLifecycle.plugins.restore_plugin).toMatchObject({
      activatedOnce: true,
      approvedReviewHash: reapproval.plugin.currentReviewHash,
      state: "active",
    });
  });

  it("clears retryable runtime crash-loop state without changing the approval hash", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-retry-state-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(pluginsDirectoryPath, "retry_plugin", {
      id: "retry_plugin",
      name: "Retry Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Retry should clear runtime failure state.",
    });

    const approval = await runPluginLifecycleAction(
      {
        action: "enable",
        directoryName: "retry_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T04:00:00Z"),
        username: "admin",
      },
    );
    const approvedReviewHash = approval.plugin.approvedReviewHash;

    await recordPluginRuntimeFailure(
      "retry_plugin",
      "Plugin sidecar exited unexpectedly.",
      {
        appDataDir,
        crashCount: 3,
        crashLoopThresholdReached: true,
        now: () => new Date("2026-04-28T04:01:00Z"),
      },
    );
    const failedInventory = await buildPluginInventoryWithLifecycle({
      appDataDir,
    });
    expect(failedInventory.plugins[0]).toMatchObject({
      approvedReviewHash,
      lifecycle: expect.objectContaining({
        crashLoop: expect.objectContaining({
          crashCount: 3,
          thresholdReached: true,
        }),
        state: "failed",
      }),
      status: "failed_degraded",
    });

    const retry = await runPluginLifecycleAction(
      {
        action: "retry",
        directoryName: "retry_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T04:02:00Z"),
        username: "admin",
      },
    );

    expect(retry.plugin).toMatchObject({
      approvedReviewHash,
      group: "Active",
      lifecycle: expect.objectContaining({
        crashLoop: {
          crashCount: 0,
          lastCrashAt: null,
          threshold: 3,
          thresholdReached: false,
          windowMs: 60_000,
        },
        state: "active",
      }),
      status: "active",
    });
    const storedLifecycle = JSON.parse(
      readFileSync(join(appDataDir, "plugin-lifecycle-v1.json"), "utf8"),
    ) as {
      plugins: Record<string, Record<string, unknown>>;
    };
    expect(storedLifecycle.plugins.retry_plugin).toMatchObject({
      approvedReviewHash,
      crashLoop: {
        crashCount: 0,
        lastCrashAt: null,
        threshold: 3,
        thresholdReached: false,
        windowMs: 60_000,
      },
      state: "active",
    });
  });

  it("keeps missing approved plugin folders visible as unavailable lifecycle records", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-missing-record-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const pluginPath = writePlugin(pluginsDirectoryPath, "missing_plugin", {
      id: "missing_plugin",
      name: "Missing Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Missing folder lifecycle test plugin.",
    });

    const approval = await runPluginLifecycleAction(
      {
        action: "enable",
        directoryName: "missing_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T03:30:00Z"),
        username: "admin",
      },
    );
    rmSync(pluginPath, { recursive: true, force: true });

    const inventory = await buildPluginInventoryWithLifecycle({
      appDataDir,
      stepUpVerified: true,
    });
    expect(inventory.groups.map((group) => [group.label, group.count])).toEqual(
      [
        ["Uninitialized", 0],
        ["Needs Review", 0],
        ["Active", 0],
        ["Failed/Degraded", 0],
        ["Disabled/Restart Required", 0],
        ["Missing/Unavailable", 1],
      ],
    );
    expect(inventory.plugins).toHaveLength(1);
    expect(inventory.plugins[0]).toMatchObject({
      approvedReviewHash: approval.plugin.approvedReviewHash,
      currentReviewHash: null,
      directoryName: "missing_plugin",
      group: "Missing/Unavailable",
      lifecycle: expect.objectContaining({
        enabled: false,
        state: "missing",
      }),
      pluginId: "missing_plugin",
      status: "missing_unavailable",
      validationErrors: [
        expect.objectContaining({ code: "plugin_folder_missing" }),
      ],
    });
    const storedLifecycle = JSON.parse(
      readFileSync(join(appDataDir, "plugin-lifecycle-v1.json"), "utf8"),
    ) as {
      plugins: Record<string, Record<string, unknown>>;
    };
    expect(storedLifecycle.plugins.missing_plugin).toMatchObject({
      approvedReviewHash: approval.plugin.approvedReviewHash,
      state: "active",
    });
  });

  it("exposes admin data and log entry points with storage reset and GC capability reasons", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-admin-actions-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const pluginPath = writePlugin(pluginsDirectoryPath, "admin_plugin", {
      id: "admin_plugin",
      name: "Admin Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Admin action test plugin.",
      gc: {
        enabled: true,
        timeoutMs: 30000,
      },
      storage: {
        defaults: {
          maxDataBytes: 2048,
          maxFileBytes: 512,
          maxFiles: 25,
        },
      },
    });
    mkdirSync(join(pluginPath, ".data", "nested"), { recursive: true });
    mkdirSync(join(pluginPath, ".data-bak-2026-04-28T00-00-00-000Z"));
    mkdirSync(join(pluginPath, ".logs"));
    mkdirSync(join(pluginPath, "seed", "nested"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "alpha.txt"), "hello\n");
    writeFileSync(join(pluginPath, ".data", "nested", "beta.txt"), "world");
    writeFileSync(join(pluginPath, "seed", "nested", "seeded.txt"), "seeded\n");
    writeFileSync(
      join(pluginPath, ".data-bak-2026-04-28T00-00-00-000Z", "old.txt"),
      "ignored backup\n",
    );
    writeFileSync(join(pluginPath, ".logs", "plugin.log"), "ignored log\n");
    writeFileSync(join(pluginPath, "source.txt"), "ignored source\n");

    await runPluginLifecycleAction(
      {
        action: "enable",
        directoryName: "admin_plugin",
      },
      {
        appDataDir,
        stepUpVerified: true,
        now: () => new Date("2026-04-28T04:00:00Z"),
        username: "admin",
      },
    );

    const inventory = await buildPluginInventoryWithLifecycle({
      appDataDir,
      stepUpVerified: true,
    });
    const plugin = inventory.plugins[0];
    expect(plugin).toMatchObject({
      dataUsage: {
        bytes: 11,
        files: 2,
        unavailableReason: null,
      },
      lifecycle: expect.objectContaining({
        settings: expect.objectContaining({
          quota: {
            maxDataBytes: 2048,
            maxFileBytes: 512,
            maxFiles: 25,
          },
        }),
      }),
    });
    expect(plugin?.adminActions).toEqual([
      expect.objectContaining({
        action: "open_data",
        available: true,
        path: join(pluginPath, ".data"),
      }),
      expect.objectContaining({
        action: "open_logs",
        available: true,
        path: join(pluginPath, ".logs"),
      }),
      expect.objectContaining({
        action: "reset_data",
        available: true,
        destructive: true,
        path: join(pluginPath, ".data"),
      }),
      expect.objectContaining({
        action: "run_gc",
        available: true,
        path: null,
      }),
    ]);

    await expect(
      runPluginAdminAction(
        {
          action: "open_data",
          directoryName: "admin_plugin",
        },
        { appDataDir, stepUpVerified: true },
      ),
    ).resolves.toMatchObject({
      path: join(pluginPath, ".data"),
      plugin: expect.objectContaining({ status: "active" }),
    });
    await expect(
      runPluginAdminAction(
        {
          action: "reset_data",
          directoryName: "admin_plugin",
        },
        { appDataDir, stepUpVerified: true },
      ),
    ).rejects.toThrow("typing the plugin folder name");
    await expect(
      runPluginAdminAction(
        {
          action: "run_gc",
          directoryName: "admin_plugin",
        },
        { appDataDir, stepUpVerified: true },
      ),
    ).rejects.toThrow("Plugin GC runtime hook is not available");

    const runtimeEvents: string[] = [];
    const auditEvents: unknown[] = [];
    await expect(
      runPluginAdminAction(
        {
          action: "run_gc",
          directoryName: "admin_plugin",
        },
        {
          appDataDir,
          stepUpVerified: true,
          runPluginGc: (directoryName) => {
            runtimeEvents.push(`gc:${directoryName}`);
          },
          username: "admin",
        },
      ),
    ).resolves.toMatchObject({
      message: "Plugin GC completed.",
      path: null,
      plugin: expect.objectContaining({ status: "active" }),
    });

    const reviewHashBeforeReset = await computePluginReviewHash(pluginPath);
    await expect(
      runPluginAdminAction(
        {
          action: "reset_data",
          confirmation: "admin_plugin",
          directoryName: "admin_plugin",
        },
        {
          appDataDir,
          now: () => new Date("2026-04-28T15:30:45.123Z"),
          recordPluginDataResetAudit: (event) => {
            auditEvents.push(event);
          },
          restartPluginRuntime: (directoryName) => {
            runtimeEvents.push(`restart:${directoryName}`);
          },
          stopPluginRuntime: (directoryName) => {
            runtimeEvents.push(`stop:${directoryName}`);
          },
          username: "admin",
        },
      ),
    ).resolves.toMatchObject({
      message: expect.stringContaining(
        join(pluginPath, ".data-bak-2026-04-28T15-30-45-123Z"),
      ),
      path: join(pluginPath, ".data"),
      plugin: expect.objectContaining({
        dataUsage: expect.objectContaining({ bytes: 7, files: 1 }),
        lifecycle: expect.objectContaining({
          lastActionBy: "admin",
        }),
      }),
    });
    expect(runtimeEvents).toEqual([
      "gc:admin_plugin",
      "stop:admin_plugin",
      "restart:admin_plugin",
    ]);
    expect(auditEvents).toEqual([
      expect.objectContaining({
        backupPath: join(pluginPath, ".data-bak-2026-04-28T15-30-45-123Z"),
        dataPath: join(pluginPath, ".data"),
        directoryName: "admin_plugin",
        pluginId: "admin_plugin",
        username: "admin",
      }),
    ]);
    expect(
      readFileSync(join(pluginPath, ".data", "nested", "seeded.txt"), "utf8"),
    ).toBe("seeded\n");
    expect(existsSync(join(pluginPath, ".data", "alpha.txt"))).toBe(false);
    expect(
      readFileSync(
        join(pluginPath, ".data-bak-2026-04-28T15-30-45-123Z", "alpha.txt"),
        "utf8",
      ),
    ).toBe("hello\n");
    expect(await computePluginReviewHash(pluginPath)).toEqual(
      reviewHashBeforeReset,
    );
    await expect(
      runPluginAdminAction(
        {
          action: "open_data",
          directoryName: "../admin_plugin",
        },
        { appDataDir, stepUpVerified: true },
      ),
    ).rejects.toThrow("invalid");
  });

  it("allows only admin callers to fetch or mutate local plugin lifecycle details", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-inventory-auth-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(pluginsDirectoryPath, "auth_plugin", {
      id: "auth_plugin",
      name: "Auth Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Authorization test plugin.",
    });
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    resetResolvedAppDataDirectory();
    const procedures = await import(
      `../project-procedures?plugin-inventory-auth=${Date.now()}`
    );

    await expect(
      procedures.getPluginInventoryProcedure(undefined, USER_CONTEXT),
    ).rejects.toMatchObject({ code: "admin_required", status: 403 });
    await expect(
      procedures.runPluginLifecycleActionProcedure(
        {
          action: "enable",
          directoryName: "auth_plugin",
        },
        USER_CONTEXT,
      ),
    ).rejects.toMatchObject({ code: "admin_required", status: 403 });
    await expect(
      procedures.runPluginAdminActionProcedure(
        {
          action: "open_data",
          directoryName: "auth_plugin",
        },
        USER_CONTEXT,
      ),
    ).rejects.toMatchObject({ code: "admin_required", status: 403 });
    await expect(
      procedures.getPluginInventoryProcedure(undefined, ADMIN_CONTEXT),
    ).resolves.toMatchObject({
      pluginsDirectoryPath: join(appDataDir, "plugins"),
    });
    await expect(
      procedures.runPluginLifecycleActionProcedure(
        {
          action: "enable",
          directoryName: "auth_plugin",
        },
        ADMIN_CONTEXT,
      ),
    ).resolves.toMatchObject({
      plugin: expect.objectContaining({ status: "active" }),
    });
  });

  it("uses step-up only for plugin actions that approve or run code", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-step-up-policy-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({
      appDataDir,
      stepUpVerified: true,
    });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writePlugin(pluginsDirectoryPath, "step_policy_plugin", {
      gc: { enabled: true, timeoutMs: 1000 },
      id: "step_policy_plugin",
      name: "Step Policy Plugin",
      version: "1.0.0",
      metidosApiVersion: "v1",
      description: "Step-up policy test plugin.",
    });
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    resetResolvedAppDataDirectory();
    const procedures = await import(
      `../project-procedures?plugin-step-up-policy=${Date.now()}`
    );
    const adminWithoutStepUp = {
      ...ADMIN_CONTEXT,
      auth: {
        ...ADMIN_CONTEXT.auth,
        stepUpValidUntil: null,
      },
    };

    await expect(
      procedures.runPluginLifecycleActionProcedure(
        {
          action: "enable",
          directoryName: "step_policy_plugin",
        },
        adminWithoutStepUp,
      ),
    ).rejects.toMatchObject({ code: "step_up_required", status: 403 });

    await procedures.runPluginLifecycleActionProcedure(
      {
        action: "enable",
        directoryName: "step_policy_plugin",
      },
      ADMIN_CONTEXT,
    );

    await expect(
      procedures.runPluginAdminActionProcedure(
        {
          action: "reset_data",
          confirmation: "step_policy_plugin",
          directoryName: "step_policy_plugin",
        },
        adminWithoutStepUp,
      ),
    ).resolves.toMatchObject({
      action: "reset_data",
      plugin: expect.objectContaining({ status: "active" }),
    });

    await expect(
      procedures.runPluginAdminActionProcedure(
        {
          action: "run_gc",
          directoryName: "step_policy_plugin",
        },
        adminWithoutStepUp,
      ),
    ).rejects.toMatchObject({ code: "step_up_required", status: 403 });

    await expect(
      procedures.runPluginLifecycleActionProcedure(
        {
          action: "retry",
          directoryName: "step_policy_plugin",
        },
        adminWithoutStepUp,
      ),
    ).rejects.toMatchObject({ code: "step_up_required", status: 403 });

    await procedures.runPluginLifecycleActionProcedure(
      {
        action: "disable",
        directoryName: "step_policy_plugin",
      },
      adminWithoutStepUp,
    );

    await expect(
      procedures.runPluginLifecycleActionProcedure(
        {
          action: "reapprove",
          directoryName: "step_policy_plugin",
        },
        adminWithoutStepUp,
      ),
    ).rejects.toMatchObject({ code: "step_up_required", status: 403 });
  });
});

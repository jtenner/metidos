/**
 * @file src/bun/plugin/startup-registrations.test.ts
 * @description Tests for Plugin System v1 startup registration validation.
 */

import { describe, expect, it } from "bun:test";
import type {
  RpcPluginInventoryPlugin,
  RpcPluginManifestAccessGroupSummary,
} from "../rpc-schema/plugin";
import {
  PluginStartupRegistrationValidationError,
  validatePluginStartupRegistrations,
} from "./startup-registrations";

function pluginWithAccess(
  access: RpcPluginManifestAccessGroupSummary[],
): RpcPluginInventoryPlugin {
  return {
    pluginId: "alpha_plugin",
    manifest: {
      access,
      crons: [],
      gc: null,
      notificationProviders: [],
      providers: [],
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function pluginWithTools(...tools: string[]): RpcPluginInventoryPlugin {
  return pluginWithAccess([
    {
      id: "main_tools",
      name: "Main tools",
      description: null,
      tools: tools.map((tool) => ({
        description: "Say hello.",
        name: tool,
        timeoutMs: 5_000,
      })),
    },
  ]);
}

function pluginWithInjections(
  permissions = ["metidos:prompt_inject"],
  ...injections: string[]
): RpcPluginInventoryPlugin {
  return {
    pluginId: "alpha_plugin",
    manifest: {
      access: [
        {
          id: "thread_context",
          name: "Thread context",
          description: null,
          injects: injections.map((inject) => ({
            description: "Adds plugin context to thread prompts.",
            name: inject,
            timeoutMs: 5_000,
          })),
          tools: [],
        },
      ],
      crons: [],
      gc: null,
      notificationProviders: [],
      permissions,
      providers: [],
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function pluginWithCronPermission(
  permissions = ["cron:create"],
): RpcPluginInventoryPlugin {
  return {
    pluginId: "alpha_plugin",
    manifest: {
      access: [],
      crons: [],
      gc: null,
      notificationProviders: [],
      permissions,
      providers: [],
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function pluginWithIngressSources(
  permissions = ["plugin:request-ingress"],
  sources: Array<{
    id: string;
    name: string;
    supportsReplyToSource?: boolean;
  }> = [{ id: "fake_dm", name: "Fake direct messages" }],
): RpcPluginInventoryPlugin {
  return {
    pluginId: "alpha_plugin",
    manifest: {
      access: [],
      crons: [],
      gc: null,
      ingressSources: sources.map((source) => ({
        description: null,
        id: source.id,
        name: source.name,
        supportsReplyToSource: source.supportsReplyToSource ?? false,
      })),
      notificationProviders: [],
      permissions,
      providers: [],
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function pluginWithNotificationProviders(
  permissions = ["notification:provider"],
  ...providers: string[]
): RpcPluginInventoryPlugin {
  return {
    pluginId: "alpha_plugin",
    manifest: {
      access: [],
      crons: [],
      gc: null,
      notificationProviders: providers.map((id) => ({
        description: "Send through a test outlet.",
        id,
        name: id,
        timeoutMs: 5_000,
      })),
      permissions,
      providers: [],
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function pluginWithModelProviders(
  permissions = ["provider:register"],
  ...providers: string[]
): RpcPluginInventoryPlugin {
  return {
    pluginId: "alpha_plugin",
    manifest: {
      access: [],
      crons: [],
      gc: null,
      notificationProviders: [],
      permissions,
      providers: providers.map((id) => ({
        description: "Discover models from test endpoints.",
        id,
        name: id,
        timeoutMs: 5_000,
      })),
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function pluginWithOAuthProviders(
  permissions = ["oauth:register"],
  ...providers: string[]
): RpcPluginInventoryPlugin {
  return {
    pluginId: "alpha_plugin",
    manifest: {
      access: [],
      crons: [],
      gc: null,
      notificationProviders: [],
      oauthProviders: providers.map((id) => ({
        description: "Import OAuth credentials from test endpoints.",
        id,
        name: id,
        timeoutMs: 5_000,
      })),
      permissions,
      providers: [],
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function toolRegistration(tool: string) {
  return {
    actionHandle: "tool:action:2",
    description: "Return a greeting.",
    name: "Hello world",
    timeoutMs: 5_000,
    tool,
    validatePropsHandle: "tool:validateProps:1",
  };
}

function injectionRegistration(inject: string) {
  return {
    inject,
    name: "Thread context",
    promptHandle: `injection:prompt:${inject}`,
    timeoutMs: 5_000,
  };
}

function cronRegistration(key: string, schedule = "*/5 * * * *") {
  return {
    actionHandle: `cron:action:${key}`,
    key,
    schedule,
    timeoutMs: 5_000,
  };
}

function notificationProviderRegistration(id: string, timeoutMs = 5_000) {
  return {
    id,
    sendHandle: `notificationProvider:send:${id}`,
    timeoutMs,
  };
}

function ingressSourceRegistration(id = "fake_dm") {
  return {
    id,
    name: "Fake direct messages",
    pollHandle: `ingress:poll:${id}`,
    pollIntervalMs: 30_000,
    promptTemplateHandle: `ingress:promptTemplate:${id}`,
    timeoutMs: 5_000,
  };
}

function modelProviderRegistration(
  id: string,
  configurations: Array<Record<string, unknown>> = [
    { id: "default", baseUrl: "http://localhost:11434" },
  ],
) {
  return {
    configurations,
    id,
    timeoutMs: 5_000,
  };
}

function oauthProviderRegistration(id: string) {
  return {
    id,
    importCredentialsHandle: `oauth:import:${id}`,
    provider: id,
    refreshHandle: `oauth:refresh:${id}`,
    timeoutMs: 5_000,
  };
}

describe("validatePluginStartupRegistrations", () => {
  it("accepts host-aligned agent tool registration handles", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        tools: [toolRegistration("hello_world")],
      },
      pluginWithTools("hello_world"),
    );

    expect(registrations.tools).toEqual([
      {
        ...toolRegistration("hello_world"),
        runtimeId: "alpha_plugin_hello_world",
      },
    ]);
  });

  it("rejects missing required agent tool registration fields", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: [
            {
              description: "Return a greeting.",
              name: "Hello world",
              timeoutMs: 5_000,
              tool: "hello_world",
              validatePropsHandle: "tool:validateProps:1",
            },
          ],
        },
        pluginWithTools("hello_world"),
      ),
    ).toThrow(PluginStartupRegistrationValidationError);

    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: [
            {
              description: "Return a greeting.",
              name: "Hello world",
              timeoutMs: 5_000,
              tool: "hello_world",
              validatePropsHandle: "tool:validateProps:1",
            },
          ],
        },
        pluginWithTools("hello_world"),
      ),
    ).toThrow("tools[0].actionHandle must be a non-empty string");
  });

  it("rejects duplicate and invalid-name agent tool registrations", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: [
            toolRegistration("hello_world"),
            toolRegistration("hello_world"),
          ],
        },
        pluginWithTools("hello_world"),
      ),
    ).toThrow("tools[1].tool duplicates hello_world");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: [toolRegistration("bad:tool")],
        },
        pluginWithTools("hello_world"),
      ),
    ).toThrow("tools[0].tool must be a snake_case identifier");
    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: [toolRegistration("bad:tool")],
        },
        pluginWithTools("hello_world"),
      ),
    ).toThrow("must not contain ':'");
  });

  it("rejects more than 30 agent tool registrations", () => {
    const tools = Array.from({ length: 31 }, (_, index) => `tool_${index}`);

    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: tools.map((tool) => toolRegistration(tool)),
        },
        pluginWithTools(...tools),
      ),
    ).toThrow("tools must contain at most 30 registrations");
  });

  it("requires registered tools to exactly match manifest-declared tools", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: [toolRegistration("hello_world")],
        },
        pluginWithTools("hello_world", "create_task"),
      ),
    ).toThrow("tools is missing manifest-declared tool create_task");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          tools: [
            toolRegistration("hello_world"),
            toolRegistration("undeclared_tool"),
          ],
        },
        pluginWithTools("hello_world"),
      ),
    ).toThrow(
      "tools[1].tool undeclared_tool is not declared by the plugin manifest",
    );
  });

  it("accepts permissioned prompt injection startup registrations", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        injections: [injectionRegistration("thread_context")],
      },
      pluginWithInjections(["metidos:prompt_inject"], "thread_context"),
    );

    expect(registrations.injections).toEqual([
      injectionRegistration("thread_context"),
    ]);
  });

  it("rejects prompt injection startup registrations without prompt injection permission", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          injections: [injectionRegistration("thread_context")],
        },
        pluginWithInjections([], "thread_context"),
      ),
    ).toThrow("injections requires metidos:prompt_inject");
  });

  it("requires registered prompt injections to exactly match manifest declarations", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          injections: [injectionRegistration("thread_context")],
        },
        pluginWithInjections(
          ["metidos:prompt_inject"],
          "thread_context",
          "project_context",
        ),
      ),
    ).toThrow(
      "injections is missing manifest-declared injection project_context",
    );

    expect(() =>
      validatePluginStartupRegistrations(
        {
          injections: [
            injectionRegistration("thread_context"),
            injectionRegistration("undeclared"),
          ],
        },
        pluginWithInjections(["metidos:prompt_inject"], "thread_context"),
      ),
    ).toThrow(
      "injections[1].inject undeclared is not declared by the plugin manifest",
    );
  });

  it("accepts manifest-declared ingress source registrations", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        ingressSources: [ingressSourceRegistration()],
      },
      pluginWithIngressSources(),
    );

    expect(registrations.ingressSources).toEqual([
      {
        ...ingressSourceRegistration(),
        description: null,
        respondHandle: null,
        supportsReplyToSource: false,
      },
    ]);
  });

  it("rejects unauthorized and malformed ingress source registrations", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        { ingressSources: [ingressSourceRegistration()] },
        pluginWithIngressSources([]),
      ),
    ).toThrow("ingressSources requires plugin:request-ingress");

    expect(() =>
      validatePluginStartupRegistrations(
        { ingressSources: [ingressSourceRegistration("undeclared")] },
        pluginWithIngressSources(),
      ),
    ).toThrow(
      "ingressSources[0].id undeclared is not declared by the plugin manifest",
    );

    expect(() =>
      validatePluginStartupRegistrations(
        {
          ingressSources: [
            ingressSourceRegistration(),
            ingressSourceRegistration(),
          ],
        },
        pluginWithIngressSources(),
      ),
    ).toThrow("ingressSources[1].id duplicates fake_dm");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          ingressSources: [
            { ...ingressSourceRegistration(), pollIntervalMs: 500 },
          ],
        },
        pluginWithIngressSources(),
      ),
    ).toThrow(
      "ingressSources[0].pollIntervalMs must be an integer between 5000 and 900000",
    );
  });

  it("requires reply permission for reply-capable ingress sources", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          ingressSources: [
            {
              ...ingressSourceRegistration(),
              respondHandle: "ingress:respond",
            },
          ],
        },
        pluginWithIngressSources(
          ["plugin:request-ingress"],
          [
            {
              id: "fake_dm",
              name: "Fake direct messages",
              supportsReplyToSource: true,
            },
          ],
        ),
      ),
    ).toThrow("ingressSources[0] requires plugin:reply-to-source");
  });

  it("accepts plugin-declared cron registrations without manifest declarations", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        crons: [cronRegistration("refresh_models")],
      },
      pluginWithCronPermission(),
    );

    expect(registrations.crons).toEqual([
      {
        ...cronRegistration("refresh_models"),
        fullKey: "alpha_plugin:refresh_models",
        scope: "global",
      },
    ]);
  });

  it("accepts multiple cron registrations under the cron permission", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        crons: [
          cronRegistration("refresh_models"),
          cronRegistration("daily_digest"),
        ],
      },
      pluginWithCronPermission(),
    );

    expect(registrations.crons).toEqual([
      {
        ...cronRegistration("refresh_models"),
        fullKey: "alpha_plugin:refresh_models",
        scope: "global",
      },
      {
        ...cronRegistration("daily_digest"),
        fullKey: "alpha_plugin:daily_digest",
        scope: "global",
      },
    ]);
  });

  it("rejects invalid cron startup registrations", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          crons: [cronRegistration("refresh_models")],
        },
        pluginWithCronPermission([]),
      ),
    ).toThrow("crons requires cron:create");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          crons: [
            cronRegistration("refresh_models"),
            cronRegistration("refresh_models"),
          ],
        },
        pluginWithCronPermission(),
      ),
    ).toThrow("crons[1].key duplicates refresh_models");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          crons: [cronRegistration("refresh_models", "not a cron")],
        },
        pluginWithCronPermission(),
      ),
    ).toThrow("crons[0].schedule must be a valid cron schedule");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          crons: [{ ...cronRegistration("refresh_models"), timeoutMs: 999 }],
        },
        pluginWithCronPermission(),
      ),
    ).toThrow("crons[0].timeoutMs must be an integer between 1000 and 600000");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          crons: Array.from({ length: 11 }, (_value, index) =>
            cronRegistration(`job_${index}`),
          ),
        },
        pluginWithCronPermission(),
      ),
    ).toThrow("crons must contain at most 10 registrations");
  });

  it("deduplicates manifest tools across access groups when deriving runtime ids", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        tools: [toolRegistration("hello_world")],
      },
      pluginWithAccess([
        {
          id: "main_tools",
          name: "Main tools",
          description: null,
          tools: [
            {
              description: "Say hello.",
              name: "hello_world",
              timeoutMs: 5_000,
            },
          ],
        },
        {
          id: "extra_tools",
          name: "Extra tools",
          description: null,
          tools: [
            {
              description: "Say hello again.",
              name: "hello_world",
              timeoutMs: 10_000,
            },
          ],
        },
      ]),
    );

    expect(registrations.tools.map((tool) => tool.runtimeId)).toEqual([
      "alpha_plugin_hello_world",
    ]);
  });

  it("accepts manifest-declared model provider registrations with startup-discovered configurations", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        modelProviders: [
          modelProviderRegistration("ollama", [
            { id: "local", baseUrl: "http://localhost:11434" },
            { id: "lab", baseUrl: "http://lab.example.test:11434" },
          ]),
        ],
      },
      pluginWithModelProviders(["provider:register"], "ollama"),
    );

    expect(registrations.modelProviders).toEqual([
      {
        configurations: [
          {
            id: "local",
            value: { id: "local", baseUrl: "http://localhost:11434" },
          },
          {
            id: "lab",
            value: { id: "lab", baseUrl: "http://lab.example.test:11434" },
          },
        ],
        executeHandle: null,
        getProviderConfigurationsHandle: null,
        id: "ollama",
        refreshIntervalMs: null,
        timeoutMs: 5_000,
      },
    ]);
  });

  it("rejects invalid model provider permissions and limits", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          modelProviders: [modelProviderRegistration("ollama")],
        },
        pluginWithModelProviders([], "ollama"),
      ),
    ).toThrow("modelProviders requires provider:register");

    const providers = Array.from({ length: 11 }, (_, index) =>
      modelProviderRegistration(`provider_${index}`),
    );
    expect(() =>
      validatePluginStartupRegistrations(
        { modelProviders: providers },
        pluginWithModelProviders(
          ["provider:register"],
          ...providers.map((provider) => provider.id),
        ),
      ),
    ).toThrow("modelProviders must contain at most 10 registrations");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          modelProviders: [
            modelProviderRegistration(
              "ollama",
              Array.from({ length: 26 }, (_, index) => ({
                id: `config_${index}`,
              })),
            ),
          ],
        },
        pluginWithModelProviders(["provider:register"], "ollama"),
      ),
    ).toThrow("modelProviders configurations must contain at most 25 entries");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          modelProviders: [
            { ...modelProviderRegistration("ollama"), configurations: [{}] },
          ],
        },
        pluginWithModelProviders(["provider:register"], "ollama"),
      ),
    ).toThrow(
      "modelProviders[0].configurations[0].id must be a non-empty string",
    );
  });

  it("accepts manifest-declared notification provider registrations", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        notificationProviders: [notificationProviderRegistration("ntfy")],
      },
      pluginWithNotificationProviders(["notification:provider"], "ntfy"),
    );

    expect(registrations.notificationProviders).toEqual([
      notificationProviderRegistration("ntfy"),
    ]);
  });

  it("accepts manifest-declared OAuth provider registrations", () => {
    const registrations = validatePluginStartupRegistrations(
      {
        oauthProviders: [oauthProviderRegistration("github")],
      },
      pluginWithOAuthProviders(["oauth:register"], "github"),
    );

    expect(registrations.oauthProviders).toEqual([
      oauthProviderRegistration("github"),
    ]);
  });

  it("rejects OAuth provider registrations without permission", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          oauthProviders: [oauthProviderRegistration("github")],
        },
        pluginWithOAuthProviders([], "github"),
      ),
    ).toThrow("oauthProviders requires oauth:register");
  });

  it("rejects notification provider registrations without permission", () => {
    expect(() =>
      validatePluginStartupRegistrations(
        {
          notificationProviders: [notificationProviderRegistration("ntfy")],
        },
        pluginWithNotificationProviders([], "ntfy"),
      ),
    ).toThrow("notificationProviders requires notification:provider");
  });

  it("rejects invalid notification provider callbacks and limits", () => {
    const providers = Array.from({ length: 11 }, (_, index) =>
      notificationProviderRegistration(`notify_${index}`),
    );
    expect(() =>
      validatePluginStartupRegistrations(
        { notificationProviders: providers },
        pluginWithNotificationProviders(
          ["notification:provider"],
          ...providers.map((provider) => provider.id),
        ),
      ),
    ).toThrow("notificationProviders must contain at most 10 registrations");

    expect(() =>
      validatePluginStartupRegistrations(
        {
          notificationProviders: [
            { ...notificationProviderRegistration("ntfy"), timeoutMs: 999 },
          ],
        },
        pluginWithNotificationProviders(["notification:provider"], "ntfy"),
      ),
    ).toThrow(
      "notificationProviders[0].timeoutMs must be an integer between 1000 and 600000",
    );

    expect(() =>
      validatePluginStartupRegistrations(
        {
          notificationProviders: [{ id: "ntfy", timeoutMs: 5_000 }],
        },
        pluginWithNotificationProviders(["notification:provider"], "ntfy"),
      ),
    ).toThrow("notificationProviders[0].sendHandle must be a non-empty string");
  });
});

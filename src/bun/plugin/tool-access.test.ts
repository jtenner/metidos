/**
 * @file src/bun/plugin/tool-access.test.ts
 * @description Tests for thread-scoped Plugin System v1 access group helpers.
 */

import { describe, expect, it } from "bun:test";
import type {
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
} from "../rpc-schema/plugin";
import {
  filterPluginToolRegistrationsForThread,
  listAvailablePluginAccessGroupsFromInventory,
  normalizeThreadPluginAccessGroups,
} from "./tool-access";

function plugin(
  overrides: Partial<RpcPluginInventoryPlugin>,
): RpcPluginInventoryPlugin {
  return {
    directoryName: "alpha_plugin",
    group: "Active",
    lifecycle: { state: "active" } as RpcPluginInventoryPlugin["lifecycle"],
    manifest: {
      access: [
        {
          color: "#22c55e",
          description: "Expose alpha tools.",
          id: "alpha_tools",
          name: "Alpha tools",
          tools: [
            {
              description: "Say hello.",
              name: "hello_world",
              timeoutMs: 5_000,
            },
            {
              description: "Create a task.",
              name: "create_task",
              timeoutMs: 5_000,
            },
          ],
        },
      ],
    },
    name: "Alpha Plugin",
    pluginId: "alpha_plugin",
    structurallyValid: true,
    validationErrors: [],
    ...overrides,
  } as RpcPluginInventoryPlugin;
}

function inventory(plugins: RpcPluginInventoryPlugin[]): RpcPluginInventory {
  return { plugins } as RpcPluginInventory;
}

describe("plugin tool access groups", () => {
  it("normalizes enabled thread access group keys deterministically", () => {
    expect(
      normalizeThreadPluginAccessGroups([
        " beta_plugin/tools ",
        "alpha_plugin/alpha_tools",
        "beta_plugin/tools",
        "",
      ]),
    ).toEqual(["alpha_plugin/alpha_tools", "beta_plugin/tools"]);

    expect(() => normalizeThreadPluginAccessGroups(["bad key"])).toThrow(
      "Invalid plugin access group key bad key",
    );
    expect(() => normalizeThreadPluginAccessGroups(["metidos/tools"])).toThrow(
      "Plugin id metidos is reserved",
    );
  });

  it("lists only active approved plugin access groups", () => {
    const groups = listAvailablePluginAccessGroupsFromInventory(
      inventory([
        plugin({ pluginId: "alpha_plugin" }),
        plugin({
          directoryName: "metidos",
          name: "Metidos",
          pluginId: "metidos",
        }),
        plugin({
          directoryName: "invalid_plugin",
          pluginId: "invalid_plugin",
          validationErrors: [
            {
              code: "invalid",
              message: "Invalid.",
              path: "/plugins/invalid_plugin",
            },
          ],
        }),
        plugin({
          directoryName: "needs_review_plugin",
          group: "Needs Review",
          lifecycle: {
            state: "needs_review",
          } as RpcPluginInventoryPlugin["lifecycle"],
          pluginId: "needs_review_plugin",
        }),
        plugin({
          directoryName: "disabled_plugin",
          group: "Disabled/Restart Required",
          lifecycle: {
            state: "disabled",
          } as RpcPluginInventoryPlugin["lifecycle"],
          pluginId: "disabled_plugin",
        }),
      ]),
    );

    expect(groups.map((group) => group.key)).toEqual([
      "alpha_plugin/alpha_tools",
    ]);
    expect(groups[0]?.color).toBe("#22c55e");
  });

  it("filters registered plugin tools by enabled thread access groups", () => {
    const alpha = plugin({ pluginId: "alpha_plugin" });
    const tools = [
      {
        actionHandle: "tool:action:1",
        description: "Say hello.",
        name: "Hello world",
        runtimeId: "alpha_plugin_hello_world",
        timeoutMs: 5_000,
        tool: "hello_world",
        validatePropsHandle: "tool:validate:1",
      },
      {
        actionHandle: "tool:action:2",
        description: "Create a task.",
        name: "Create task",
        runtimeId: "alpha_plugin_create_task",
        timeoutMs: 5_000,
        tool: "create_task",
        validatePropsHandle: "tool:validate:2",
      },
      {
        actionHandle: "tool:action:3",
        description: "Unlisted.",
        name: "Unlisted",
        runtimeId: "alpha_plugin_unlisted",
        timeoutMs: 5_000,
        tool: "unlisted",
        validatePropsHandle: "tool:validate:3",
      },
    ];

    expect(
      filterPluginToolRegistrationsForThread({
        enabledAccessGroups: [],
        plugin: alpha,
        tools,
      }),
    ).toEqual([]);

    expect(
      filterPluginToolRegistrationsForThread({
        enabledAccessGroups: ["alpha_plugin/alpha_tools"],
        plugin: alpha,
        tools,
      }).map((tool) => tool.runtimeId),
    ).toEqual(["alpha_plugin_hello_world", "alpha_plugin_create_task"]);

    expect(
      filterPluginToolRegistrationsForThread({
        enabledAccessGroups: ["alpha_plugin/alpha_tools"],
        plugin: plugin({
          group: "Failed/Degraded",
          lifecycle: {
            state: "failed",
          } as RpcPluginInventoryPlugin["lifecycle"],
        }),
        tools,
      }),
    ).toEqual([]);
  });
});

/**
 * @file src/bun/pi/metidos/permissions.ts
 * @description Agent-facing Metidos permission discovery tool.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  createThreadPermissionDescriptor,
  createThreadPermissionRegistry,
  METIDOS_PERMISSION_PROVIDER_ID,
  permissionDescriptorsForAgentCatalog,
  pluginPermissionDescriptorsFromInventory,
  type ThreadPermissionDescriptor,
  type ThreadPermissionDescriptorInput,
} from "../../thread-permissions";
import {
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  textToolResult,
  withMetidosToolTelemetry,
} from "./shared";

const ListPermissionsToolParameters = Type.Object({});

type PermissionCatalogGroup = {
  providerDescription: string;
  providerId: string;
  descriptors: ThreadPermissionDescriptor[];
};

function descriptorSort(
  left: ThreadPermissionDescriptor,
  right: ThreadPermissionDescriptor,
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.accessId.localeCompare(right.accessId);
}

function groupSort(
  left: PermissionCatalogGroup,
  right: PermissionCatalogGroup,
): number {
  if (left.providerId === METIDOS_PERMISSION_PROVIDER_ID) {
    return -1;
  }
  if (right.providerId === METIDOS_PERMISSION_PROVIDER_ID) {
    return 1;
  }
  return left.providerId.localeCompare(right.providerId);
}

function formatPermissionCatalog(
  descriptors: ThreadPermissionDescriptor[],
): string {
  const groups = new Map<string, PermissionCatalogGroup>();
  for (const descriptor of descriptors) {
    const group = groups.get(descriptor.providerId) ?? {
      descriptors: [],
      providerDescription: descriptor.providerDescription,
      providerId: descriptor.providerId,
    };
    group.descriptors.push(descriptor);
    groups.set(descriptor.providerId, group);
  }

  return [...groups.values()]
    .sort(groupSort)
    .map((group) => {
      const bullets = group.descriptors
        .sort(descriptorSort)
        .map((descriptor) => `- "${descriptor.id}": ${descriptor.description}`);
      return [
        `## ${group.providerDescription}: ${group.providerId}`,
        ...bullets,
      ].join("\n");
    })
    .join("\n\n");
}

async function safePluginPermissionDescriptors(
  host: PiMetidosToolHost,
): Promise<{
  descriptors: ThreadPermissionDescriptorInput[];
  diagnostics: string[];
}> {
  if (!host.getPluginInventory) {
    return { descriptors: [], diagnostics: [] };
  }

  try {
    const inventory = await host.getPluginInventory(undefined);
    const descriptors = pluginPermissionDescriptorsFromInventory(inventory);
    const accepted: ThreadPermissionDescriptorInput[] = [];
    const diagnostics: string[] = [];
    for (const descriptor of descriptors) {
      try {
        createThreadPermissionDescriptor(descriptor);
        accepted.push(descriptor);
      } catch (error) {
        diagnostics.push(
          error instanceof Error
            ? error.message
            : "Invalid plugin permission descriptor.",
        );
      }
    }
    return { descriptors: accepted, diagnostics };
  } catch (error) {
    return {
      descriptors: [],
      diagnostics: [
        error instanceof Error
          ? error.message
          : "Plugin permission descriptors could not be loaded.",
      ],
    };
  }
}

export function createPiMetidosPermissionTools(
  _scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool<typeof ListPermissionsToolParameters, Record<string, unknown>>(
        {
          description:
            "List valid Metidos thread and cron permission strings by provider. Use this before passing permissions to new_thread, new_cron, or update_cron.",
          execute: async () => {
            const { descriptors: pluginDescriptors, diagnostics } =
              await safePluginPermissionDescriptors(host);
            const registry = createThreadPermissionRegistry({
              pluginDescriptors,
            });
            const descriptors = permissionDescriptorsForAgentCatalog(registry);
            return textToolResult(formatPermissionCatalog(descriptors), {
              descriptors: descriptors.map((descriptor) => ({
                accessId: descriptor.accessId,
                description: descriptor.description,
                id: descriptor.id,
                providerDescription: descriptor.providerDescription,
                providerId: descriptor.providerId,
              })),
              diagnostics,
            });
          },
          label: "List Permissions",
          name: "metidos_list_permissions",
          parameters: ListPermissionsToolParameters,
          promptGuidelines: [
            "Use this to discover valid permission strings before creating or updating threads and cron jobs.",
            "Read permission ids exactly as quoted full strings, including their provider prefix.",
          ],
          promptSnippet:
            "List Metidos-native and plugin-provided thread permission strings",
        },
      ),
    ),
  ];
}

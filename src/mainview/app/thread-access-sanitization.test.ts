/**
 * @file src/mainview/app/thread-access-sanitization.test.ts
 * @description Tests for stale Thread Access Control permission sanitization.
 */

import { describe, expect, it } from "bun:test";
import type {
  RpcPluginAccessGroupOption,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import {
  sanitizeThreadAccessValue,
  threadAccessPermissionsWereSanitized,
} from "./thread-access-sanitization";

function descriptor(id: string): RpcThreadPermissionDescriptor {
  return {
    accessId: id.split(":")[1] ?? id,
    category: "plugin",
    defaultEnabled: false,
    description: `${id} description`,
    id,
    label: id,
    order: 0,
    providerDescription: "Provider",
    providerId: id.split(":")[0] ?? "plugin",
    requiresApproval: false,
    unsafe: false,
  };
}

function accessValue(permissions: string[]) {
  return {
    agentsAccess: false,
    calendarAccess: false,
    cronsAccess: permissions.includes("metidos:crons"),
    gitAccess: false,
    githubAccess: false,
    metidosAccess:
      permissions.includes("metidos:threads") ||
      permissions.includes("metidos:crons"),
    notificationsAccess: false,
    permissions,
    pluginAccessGroups: [],
    sqliteAccess: false,
    threadsAccess: permissions.includes("metidos:threads"),
    unsafeMode: false,
    webSearchAccess: false,
    webServerAccess: false,
    weatherAccess: false,
  };
}

function pluginGroup(
  overrides: Partial<RpcPluginAccessGroupOption> = {},
): RpcPluginAccessGroupOption {
  return {
    color: null,
    description: null,
    groupId: "tools",
    groupName: "Tools",
    key: "active_plugin/tools",
    pluginDirectoryName: "active_plugin",
    pluginId: "active_plugin",
    pluginName: "Active Plugin",
    tools: [],
    ...overrides,
  };
}

describe("sanitizeThreadAccessValue", () => {
  it("drops stale plugin permission ids while preserving active native and plugin access", () => {
    const sanitized = sanitizeThreadAccessValue({
      access: {
        agentsAccess: false,
        calendarAccess: false,
        cronsAccess: true,
        gitAccess: false,
        githubAccess: false,
        metidosAccess: true,
        notificationsAccess: false,
        permissions: [
          "active_plugin:tools",
          "metidos:threads",
          "uploadthing:uploadthing_tools",
        ],
        pluginAccessGroups: [
          "active_plugin/tools",
          "uploadthing/uploadthing_tools",
        ],
        sqliteAccess: false,
        threadsAccess: true,
        unsafeMode: false,
        webSearchAccess: false,
        webServerAccess: false,
        weatherAccess: false,
      },
      availablePluginAccessGroups: [pluginGroup()],
      availableThreadPermissionDescriptors: [descriptor("metidos:threads")],
    });

    expect(sanitized.permissions).toEqual([
      "active_plugin:tools",
      "metidos:threads",
    ]);
    expect(sanitized.pluginAccessGroups).toEqual(["active_plugin/tools"]);
    expect(sanitized.threadsAccess).toBe(true);
  });

  it("reports whether stale permission ids were removed", () => {
    const access = accessValue([
      "metidos:threads",
      "uploadthing:uploadthing_tools",
    ]);
    const sanitizedAccess = sanitizeThreadAccessValue({
      access,
      availableThreadPermissionDescriptors: [descriptor("metidos:threads")],
    });

    expect(
      threadAccessPermissionsWereSanitized({ access, sanitizedAccess }),
    ).toBe(true);
    expect(
      threadAccessPermissionsWereSanitized({
        access: sanitizedAccess,
        sanitizedAccess,
      }),
    ).toBe(false);
  });
});

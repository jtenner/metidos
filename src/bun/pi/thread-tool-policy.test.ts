import { describe, expect, test } from "bun:test";

import {
  buildPiThreadToolPolicy,
  hasPiThreadRuntimePermission,
  METIDOS_PERMISSION,
  type MetidosPermissionId,
  type PiThreadToolPolicyThread,
} from "./thread-tool-policy";

function threadWithPermissions(
  permissions: readonly string[],
): PiThreadToolPolicyThread {
  return { permissions: [...permissions] };
}

describe("buildPiThreadToolPolicy", () => {
  test("keeps bash and unsafe child escalation disabled by default", () => {
    expect(buildPiThreadToolPolicy(threadWithPermissions([]))).toEqual({
      activeToolNames: ["read", "ls", "find", "grep", "edit", "write"],
      allowBash: false,
      allowUnsafeModeEscalation: false,
      runtimePromptLine:
        "Unsafe mode is disabled. Bash is unavailable. Use the installed worktree-scoped file/search tools instead. new_thread requests user approval before creating child threads, including unsafe ones; unsafe child cron jobs remain unavailable.",
    });
  });

  test("only metidos:unsafe enables bash and unsafe child escalation", () => {
    const privilegedThread = threadWithPermissions([
      METIDOS_PERMISSION.webSearch,
      METIDOS_PERMISSION.threads,
      METIDOS_PERMISSION.crons,
      "plugin.example:tool",
    ]);

    expect(buildPiThreadToolPolicy(privilegedThread)).toMatchObject({
      allowBash: false,
      allowUnsafeModeEscalation: false,
    });

    expect(
      buildPiThreadToolPolicy(
        threadWithPermissions([
          ...privilegedThread.permissions,
          METIDOS_PERMISSION.unsafe,
        ]),
      ),
    ).toEqual({
      activeToolNames: ["read", "bash", "ls", "find", "grep", "edit", "write"],
      allowBash: true,
      allowUnsafeModeEscalation: true,
      runtimePromptLine:
        "Unsafe mode is enabled. Bash is available, and Metidos tools may create unsafe child threads or cron jobs. Stay within the workspace unless the user explicitly asks for broader host access.",
    });
  });
});

describe("hasPiThreadRuntimePermission", () => {
  const metidosToolFamilies = [
    ["agent coordination", METIDOS_PERMISSION.agents],
    ["calendar", METIDOS_PERMISSION.calendar],
    ["cron jobs", METIDOS_PERMISSION.crons],
    ["git", METIDOS_PERMISSION.git],
    ["GitHub", METIDOS_PERMISSION.github],
    ["LanceDB", METIDOS_PERMISSION.lancedb],
    ["notifications", METIDOS_PERMISSION.notifications],
    ["SQLite", METIDOS_PERMISSION.sqlite],
    ["threads", METIDOS_PERMISSION.threads],
    ["unsafe mode", METIDOS_PERMISSION.unsafe],
    ["web search", METIDOS_PERMISSION.webSearch],
    ["web server", METIDOS_PERMISSION.webServer],
  ] satisfies Array<[string, MetidosPermissionId]>;

  test.each(
    metidosToolFamilies,
  )("shows %s tools only when its exact Metidos permission is present", (_toolFamily, permission) => {
    expect(
      hasPiThreadRuntimePermission(threadWithPermissions([]), permission),
    ).toBe(false);
    expect(
      hasPiThreadRuntimePermission(
        threadWithPermissions([`not-${permission}`, `${permission}:extra`]),
        permission,
      ),
    ).toBe(false);
    expect(
      hasPiThreadRuntimePermission(
        threadWithPermissions([permission]),
        permission,
      ),
    ).toBe(true);
  });

  test("keeps Metidos sub-access flags independent", () => {
    const thread = threadWithPermissions([
      METIDOS_PERMISSION.threads,
      METIDOS_PERMISSION.webSearch,
    ]);

    expect(
      hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.threads),
    ).toBe(true);
    expect(hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.crons)).toBe(
      false,
    );
    expect(
      hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.webSearch),
    ).toBe(true);
  });

  test("ignores Plugin System permissions when evaluating native Metidos tools", () => {
    const thread = threadWithPermissions([
      "core-weather:forecast",
      "plugin.example:threads",
      "plugin.example:unsafe",
    ]);

    expect(
      hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.threads),
    ).toBe(false);
    expect(
      hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.unsafe),
    ).toBe(false);
  });
});

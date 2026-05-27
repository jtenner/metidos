import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import {
  createSettingsRpcHandlers,
  type SettingsRpcHandlerDependencies,
} from "./settings";

const requestContext = {} as RpcRequestContext;

type TimezoneSettings = Awaited<
  ReturnType<SettingsRpcHandlerDependencies["getTimezoneSettingsProcedure"]>
>;

function createTimezoneSettings(timezone: string | null): TimezoneSettings {
  return { timezone } as TimezoneSettings;
}

function createDefaultDependencies(
  overrides: Partial<SettingsRpcHandlerDependencies> = {},
): SettingsRpcHandlerDependencies {
  return {
    getTerminalSettingsProcedure: async () => ({}) as never,
    getTimezoneSettingsProcedure: async () => createTimezoneSettings("UTC"),
    getUserRuntimeSettingsProcedure: async () => ({}) as never,
    syncCronSchedulerTimezone: () => {},
    updateTerminalSettingsProcedure: async () => ({}) as never,
    updateTimezoneSettingsProcedure: async () => createTimezoneSettings("UTC"),
    updateUserRuntimeSettingsProcedure: async () => ({}) as never,
    ...overrides,
  };
}

describe("createSettingsRpcHandlers", () => {
  it("syncs the cron scheduler after changing the timezone", async () => {
    let syncCount = 0;
    const updatedSettings = createTimezoneSettings("America/New_York");
    const handlers = createSettingsRpcHandlers(
      createDefaultDependencies({
        getTimezoneSettingsProcedure: async () => createTimezoneSettings("UTC"),
        syncCronSchedulerTimezone: () => {
          syncCount += 1;
        },
        updateTimezoneSettingsProcedure: async () => updatedSettings,
      }),
    );

    await expect(
      handlers.updateTimezoneSettings(
        { timezone: "America/New_York" },
        requestContext,
      ),
    ).resolves.toBe(updatedSettings);
    expect(syncCount).toBe(1);
  });

  it("does not sync the cron scheduler when the timezone is unchanged", async () => {
    let syncCount = 0;
    const updatedSettings = createTimezoneSettings("UTC");
    const handlers = createSettingsRpcHandlers(
      createDefaultDependencies({
        getTimezoneSettingsProcedure: async () => createTimezoneSettings("UTC"),
        syncCronSchedulerTimezone: () => {
          syncCount += 1;
        },
        updateTimezoneSettingsProcedure: async () => updatedSettings,
      }),
    );

    await expect(
      handlers.updateTimezoneSettings({ timezone: "UTC" }, requestContext),
    ).resolves.toBe(updatedSettings);
    expect(syncCount).toBe(0);
  });

  it("delegates settings reads and non-timezone updates without cron scheduler sync", async () => {
    let syncCount = 0;
    const terminalSettings = { defaultShell: "/bin/zsh" } as Awaited<
      ReturnType<SettingsRpcHandlerDependencies["getTerminalSettingsProcedure"]>
    >;
    const runtimeSettings = { commandTimeoutSeconds: 120 } as Awaited<
      ReturnType<
        SettingsRpcHandlerDependencies["getUserRuntimeSettingsProcedure"]
      >
    >;
    const updatedTerminalSettings = { defaultShell: "/bin/bash" } as Awaited<
      ReturnType<
        SettingsRpcHandlerDependencies["updateTerminalSettingsProcedure"]
      >
    >;
    const updatedRuntimeSettings = { commandTimeoutSeconds: 180 } as Awaited<
      ReturnType<
        SettingsRpcHandlerDependencies["updateUserRuntimeSettingsProcedure"]
      >
    >;
    const handlers = createSettingsRpcHandlers(
      createDefaultDependencies({
        getTerminalSettingsProcedure: async () => terminalSettings,
        getUserRuntimeSettingsProcedure: async () => runtimeSettings,
        syncCronSchedulerTimezone: () => {
          syncCount += 1;
        },
        updateTerminalSettingsProcedure: async () => updatedTerminalSettings,
        updateUserRuntimeSettingsProcedure: async () => updatedRuntimeSettings,
      }),
    );

    await expect(
      handlers.getTerminalSettings(undefined, requestContext),
    ).resolves.toBe(terminalSettings);
    await expect(
      handlers.getUserRuntimeSettings(undefined, requestContext),
    ).resolves.toBe(runtimeSettings);
    await expect(
      handlers.updateTerminalSettings(
        { defaultShell: "/bin/bash" },
        requestContext,
      ),
    ).resolves.toBe(updatedTerminalSettings);
    await expect(
      handlers.updateUserRuntimeSettings(
        { commandTimeoutSeconds: 180 },
        requestContext,
      ),
    ).resolves.toBe(updatedRuntimeSettings);
    expect(syncCount).toBe(0);
  });
});

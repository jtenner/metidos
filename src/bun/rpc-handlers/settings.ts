import type { RpcRequestHandlerMap } from "../rpc-transport";

export type SettingsRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  | "getTerminalSettings"
  | "getTimezoneSettings"
  | "getUserRuntimeSettings"
  | "updateTerminalSettings"
  | "updateTimezoneSettings"
  | "updateUserRuntimeSettings"
>;

export type SettingsRpcHandlerDependencies = {
  getTerminalSettingsProcedure: RpcRequestHandlerMap["getTerminalSettings"];
  getTimezoneSettingsProcedure: RpcRequestHandlerMap["getTimezoneSettings"];
  getUserRuntimeSettingsProcedure: RpcRequestHandlerMap["getUserRuntimeSettings"];
  syncCronSchedulerTimezone: () => void;
  updateTerminalSettingsProcedure: RpcRequestHandlerMap["updateTerminalSettings"];
  updateTimezoneSettingsProcedure: RpcRequestHandlerMap["updateTimezoneSettings"];
  updateUserRuntimeSettingsProcedure: RpcRequestHandlerMap["updateUserRuntimeSettings"];
};

export function createSettingsRpcHandlers({
  getTerminalSettingsProcedure,
  getTimezoneSettingsProcedure,
  getUserRuntimeSettingsProcedure,
  syncCronSchedulerTimezone,
  updateTerminalSettingsProcedure,
  updateTimezoneSettingsProcedure,
  updateUserRuntimeSettingsProcedure,
}: SettingsRpcHandlerDependencies): SettingsRpcHandlerMap {
  return {
    getTerminalSettings: (params, context) =>
      getTerminalSettingsProcedure(params, context),
    getTimezoneSettings: (params, context) =>
      getTimezoneSettingsProcedure(params, context),
    getUserRuntimeSettings: (params, context) =>
      getUserRuntimeSettingsProcedure(params, context),
    updateTerminalSettings: (params, context) =>
      updateTerminalSettingsProcedure(params, context),
    updateTimezoneSettings: async (params, context) => {
      const previousSettings = await getTimezoneSettingsProcedure(
        undefined,
        context,
      );
      const settings = await updateTimezoneSettingsProcedure(params, context);
      if (settings.timezone !== previousSettings.timezone) {
        syncCronSchedulerTimezone();
      }
      return settings;
    },
    updateUserRuntimeSettings: (params, context) =>
      updateUserRuntimeSettingsProcedure(params, context),
  };
}

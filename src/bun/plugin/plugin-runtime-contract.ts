/**
 * @file src/bun/plugin/plugin-runtime-contract.ts
 * @description Language-neutral Plugin System v1 runtime startup contracts.
 */

import type { RpcPluginManifestNetworkSummary } from "../rpc-schema/plugin";
import type { PluginCalendarEventsOperation } from "./calendar-events";
import type { PluginEntrypointBuildResult } from "./entrypoint-build";
import type { PluginLanceDbOperation } from "./lancedb";
import type { PluginNotificationSendResult } from "./notifications";
import type {
  PluginSidecarStartupEnvVar,
  PluginSidecarStartupSettingsPayload,
} from "./sidecar-rpc";
import type { PluginSqliteOperation } from "./sqlite";
import type { PluginTerminalOperation } from "./terminal";

export type PluginRuntimeLanguage = PluginEntrypointBuildResult["language"];

export type PluginRuntimeNotificationSender = (
  request: unknown,
) => Promise<PluginNotificationSendResult>;

export type PluginRuntimeCalendarEventsCaller = (
  operation: PluginCalendarEventsOperation,
  request: unknown,
) => Promise<unknown>;

export type PluginRuntimeTerminalCaller = (
  operation: PluginTerminalOperation,
  request: unknown,
) => Promise<unknown>;

export type PluginRuntimeSqliteCaller = (
  operation: PluginSqliteOperation,
  request: unknown,
) => Promise<unknown>;

export type PluginRuntimeEmbeddingCaller = (
  request: unknown,
) => Promise<unknown>;

export type PluginRuntimeLanceDbCaller = (
  operation: PluginLanceDbOperation,
  request: unknown,
) => Promise<unknown>;

export type PluginRuntimeLogger = (request: unknown) => Promise<unknown>;

export type PluginRuntimeFsCaller = (
  operation: string,
  request: unknown,
) => Promise<unknown>;

export type PluginRuntimeWebSocketCaller = (
  operation: string,
  request: unknown,
) => Promise<unknown>;

export type PluginRuntimeApiOptions = {
  calendarEvents?: PluginRuntimeCalendarEventsCaller;
  embeddings?: PluginRuntimeEmbeddingCaller;
  env?: PluginSidecarStartupEnvVar[];
  fs?: PluginRuntimeFsCaller;
  lancedb?: PluginRuntimeLanceDbCaller;
  log?: PluginRuntimeLogger;
  network?: RpcPluginManifestNetworkSummary | null | undefined;
  permissions?: readonly string[];
  sendNotification?: PluginRuntimeNotificationSender;
  settings?: PluginSidecarStartupSettingsPayload;
  sqlite?: PluginRuntimeSqliteCaller;
  terminal?: PluginRuntimeTerminalCaller;
  unsafeAllowPrivateNetwork?: boolean;
  webSocket?: PluginRuntimeWebSocketCaller;
};

export type PluginRuntimeOptions = {
  memoryLimitBytes?: number;
  pluginApi?: PluginRuntimeApiOptions;
  startupTimeoutMs?: number;
};

export type PluginRuntimeCallbackInput = {
  args: unknown[];
  deadlineMs: number;
  handle: string;
  label: string;
};

export type PluginRuntimeInstance = {
  dispose: () => void;
  invokeCallback: (input: PluginRuntimeCallbackInput) => Promise<unknown>;
  setupResult: unknown;
};

export type PluginRuntimeStart = (
  buildResult: PluginEntrypointBuildResult,
  options?: PluginRuntimeOptions,
) => Promise<PluginRuntimeInstance>;

export type PluginRuntimeAdapter = {
  language: PluginRuntimeLanguage;
  start: PluginRuntimeStart;
};

export type PluginRuntimeResult = {
  setupResult: unknown;
};

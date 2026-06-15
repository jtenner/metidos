import type { RpcRequestHandlerMap } from "../rpc-transport";
import {
  createAppBootstrapRpcHandlers,
  type AppBootstrapRpcHandlerDependencies,
} from "./app-bootstrap";
import {
  createCalendarRpcHandlers,
  type CalendarRpcHandlerDependencies,
} from "./calendar";
import { createCronRpcHandlers, type CronRpcHandlerDependencies } from "./cron";
import {
  createModelCatalogRpcHandlers,
  type ModelCatalogRpcHandlerDependencies,
} from "./model-catalog";
import {
  createMemoryRpcHandlers,
  type MemoryRpcHandlerDependencies,
} from "./memory";
import {
  createPluginAdminRpcHandlers,
  type PluginAdminRpcHandlerDependencies,
} from "./plugin-admin";
import {
  createSettingsRpcHandlers,
  type SettingsRpcHandlerDependencies,
} from "./settings";
import {
  createTerminalRpcHandlers,
  type TerminalRpcHandlerDependencies,
} from "./terminal";
import {
  createThreadRpcHandlers,
  type ThreadRpcHandlerDependencies,
} from "./thread";
import {
  createWorkContextRpcHandlers,
  type WorkContextRpcHandlerDependencies,
} from "./work-context";

export type BackendRpcHandlerDependencies = AppBootstrapRpcHandlerDependencies &
  CalendarRpcHandlerDependencies &
  CronRpcHandlerDependencies &
  MemoryRpcHandlerDependencies &
  ModelCatalogRpcHandlerDependencies &
  PluginAdminRpcHandlerDependencies &
  SettingsRpcHandlerDependencies &
  TerminalRpcHandlerDependencies &
  ThreadRpcHandlerDependencies &
  WorkContextRpcHandlerDependencies;

export function createBackendRpcHandlers(
  dependencies: BackendRpcHandlerDependencies,
): RpcRequestHandlerMap {
  const handlers = {
    ...createWorkContextRpcHandlers(dependencies),
    ...createModelCatalogRpcHandlers(dependencies),
    ...createMemoryRpcHandlers(dependencies),
    ...createPluginAdminRpcHandlers(dependencies),
    ...createAppBootstrapRpcHandlers(dependencies),
    ...createThreadRpcHandlers(dependencies),
    ...createCronRpcHandlers(dependencies),
    ...createCalendarRpcHandlers(dependencies),
    ...createTerminalRpcHandlers(dependencies),
    ...createSettingsRpcHandlers(dependencies),
  } satisfies RpcRequestHandlerMap;

  return handlers;
}

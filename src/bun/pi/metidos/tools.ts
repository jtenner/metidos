/**
 * @file src/bun/pi/metidos/tools.ts
 * @description Pi-native Metidos tool definitions replacing the Codex MCP sidecar path.
 */

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { createPiMetidosCalendarTools } from "./calendar";
import { createPiMetidosCronTools } from "./cron";
import { createPiMetidosModelDiscoveryTools } from "./model-discovery";
import { createPiMetidosNotificationTools } from "./notifications";
import { createPiMetidosPermissionTools } from "./permissions";
import type { PiMetidosToolHost, PiMetidosToolScope } from "./shared";
import { createPiMetidosTerminalTools } from "./terminal";
import {
  createPiMetidosThreadCreationTools,
  createPiMetidosThreadUpdateTools,
} from "./thread";

export type { PiMetidosToolHost, PiMetidosToolScope };

export function createPiMetidosTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  const threadsAccessEnabled =
    scope.threadsAccessEnabled ?? scope.metidosAccessEnabled ?? false;
  const cronsAccessEnabled =
    scope.cronsAccessEnabled ?? scope.metidosAccessEnabled ?? false;
  const fullMetidosAccessEnabled = threadsAccessEnabled && cronsAccessEnabled;
  const modelDiscoveryAccessEnabled =
    threadsAccessEnabled || cronsAccessEnabled;

  return [
    ...createPiMetidosThreadUpdateTools(scope, host),
    ...createPiMetidosPermissionTools(scope, host),
    ...(scope.calendarAccessEnabled
      ? createPiMetidosCalendarTools(scope, host)
      : []),
    ...(cronsAccessEnabled ? createPiMetidosCronTools(scope, host) : []),
    ...(modelDiscoveryAccessEnabled
      ? createPiMetidosModelDiscoveryTools(host)
      : []),
    ...(scope.notificationsAccessEnabled
      ? createPiMetidosNotificationTools(scope, host)
      : []),
    ...(fullMetidosAccessEnabled && scope.unsafeModeEnabled
      ? createPiMetidosTerminalTools(scope, host)
      : []),
    ...(threadsAccessEnabled
      ? createPiMetidosThreadCreationTools(scope, host)
      : []),
  ];
}

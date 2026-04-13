/**
 * @file src/bun/pi-metidos-tools.ts
 * @description Pi-native Metidos tool definitions replacing the Codex MCP sidecar path.
 */

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { createPiMetidosContextTools } from "./pi-metidos-tools-context";
import { createPiMetidosCronTools } from "./pi-metidos-tools-cron";
import { createPiMetidosSandboxTools } from "./pi-metidos-tools-sandbox";
import type {
  PiMetidosToolHost,
  PiMetidosToolScope,
} from "./pi-metidos-tools-shared";
import { createPiMetidosTaskGraphTools } from "./pi-metidos-tools-task-graph";
import {
  createPiMetidosThreadCreationTools,
  createPiMetidosThreadMetadataTools,
} from "./pi-metidos-tools-thread";

export type { PiMetidosToolHost, PiMetidosToolScope };

export function createPiMetidosTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    ...createPiMetidosThreadMetadataTools(scope, host),
    ...createPiMetidosSandboxTools(scope),
    ...createPiMetidosTaskGraphTools(scope, host),
    ...createPiMetidosContextTools(scope, host),
    ...createPiMetidosCronTools(scope, host),
    ...createPiMetidosThreadCreationTools(scope, host),
  ];
}

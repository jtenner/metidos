/**
 * @file src/bun/dev-flows.ts
 * @description Module for dev flows.
 */

import { deleteAuthSecretKey, getAuthSecretKeyPath } from "./auth-secrets";
import { type AppDataPathOptions, deleteAppDatabaseFiles } from "./db";
import { deleteRuntimeStatsSidecarDatabaseFiles } from "./runtime-stats-sidecar";

export const DEV_AUTH_BYPASS_ENV = "METIDOS_DEV_BYPASS";
export const DEV_RESET_ENV = "METIDOS_DEV_RESET";
const DEV_WEBSOCKET_TICKET_LIFETIME_MS = 60 * 1000;

type DevFlowOptions = {
  env?: NodeJS.ProcessEnv;
  isDevServer: boolean;
};

type ResetLocalAppStateOptions = AppDataPathOptions & {
  logger?: Pick<Console, "warn">;
};

export type DevFlowMode = {
  authBypass: boolean;
  resetOnStartup: boolean;
};

export type DevWebSocketTicket = {
  expiresAt: string;
  ticket: string;
};
/**
 * Checks whether an environment flag value represents an enabled state.
 * @param value - Environment value to parse.
 */

function envFlagEnabled(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): boolean {
  return names.some((name) => env[name]?.trim() === "1");
}
/**
 * Ensures a dev-only flag is only enabled when running in dev mode.
 * @param enabled - Whether the flag is enabled.
 * @param flagName - Flag environment variable name.
 * @param isDevServer - Boolean flag indicating isDevServer.
 */

function assertDevOnlyFlag(
  enabled: boolean,
  flagName: string,
  isDevServer: boolean,
): void {
  if (enabled && !isDevServer) {
    throw new Error(`${flagName}=1 requires --dev or METIDOS_DEV=1.`);
  }
}
/**
 * Resolves dev flow mode.
 * @param options - Configuration options used by this operation.
 */

export function resolveDevFlowMode(options: DevFlowOptions): DevFlowMode {
  const env = options.env ?? process.env;
  const authBypass = envFlagEnabled(env, [DEV_AUTH_BYPASS_ENV]);
  const resetOnStartup = envFlagEnabled(env, [DEV_RESET_ENV]);

  assertDevOnlyFlag(authBypass, DEV_AUTH_BYPASS_ENV, options.isDevServer);
  assertDevOnlyFlag(resetOnStartup, DEV_RESET_ENV, options.isDevServer);

  return {
    authBypass,
    resetOnStartup,
  };
}
/**
 * Issues a short-lived dev websocket ticket with expiration.
 * @param nowMs - Timestamp used as the ticket creation baseline.
 */

export function issueDevWebSocketTicket(
  nowMs = Date.now(),
): DevWebSocketTicket {
  return {
    expiresAt: new Date(nowMs + DEV_WEBSOCKET_TICKET_LIFETIME_MS).toISOString(),
    ticket: `dev-${crypto.randomUUID()}`,
  };
}
/**
 * Resets local app state.
 * @param options - Configuration options used by this operation.
 */

export function resetLocalAppState(
  options: ResetLocalAppStateOptions = {},
): string[] {
  const deletedPaths = [
    ...deleteAppDatabaseFiles(options),
    ...deleteRuntimeStatsSidecarDatabaseFiles(options),
  ];

  if (deleteAuthSecretKey(options)) {
    deletedPaths.push(getAuthSecretKeyPath(options));
  }

  if (options.logger) {
    options.logger.warn(
      deletedPaths.length > 0
        ? `[metidos] ${DEV_RESET_ENV}=1 removed local app state at ${deletedPaths.join(", ")}`
        : `[metidos] ${DEV_RESET_ENV}=1 requested, but no local app state files were present.`,
    );
  }

  return deletedPaths;
}

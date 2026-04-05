/**
 * @file src/bun/tls-config.ts
 * @description Module for tls config.
 */

export const TLS_PUBLIC_TRANSPORT_ENV = "JOLT_TLS";

export type ResolvedTlsRuntimeConfig = {
  publicHttpProtocol: "http" | "https";
  publicTls: boolean;
  publicWebSocketProtocol: "ws" | "wss";
};

type ResolveTlsRuntimeConfigOptions = {
  env?: NodeJS.ProcessEnv;
  forceTls?: boolean;
};

export function formatLoopbackHttpOrigin(
  port: number,
  tlsEnabled: boolean,
): string {
  return `${tlsEnabled ? "https" : "http"}://127.0.0.1:${port}`;
}

export function formatLoopbackWebSocketUrl(
  port: number,
  tlsEnabled: boolean,
): string {
  return `${tlsEnabled ? "wss" : "ws"}://127.0.0.1:${port}/rpc`;
}

export function isPublicTlsEnabled(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (args.includes("--tls")) {
    return true;
  }
  return env[TLS_PUBLIC_TRANSPORT_ENV]?.trim() === "1";
}

export function resolveTlsRuntimeConfig(
  options: ResolveTlsRuntimeConfigOptions = {},
): ResolvedTlsRuntimeConfig {
  const publicTls =
    options.forceTls === true ||
    isPublicTlsEnabled([], options.env ?? process.env);
  return {
    publicHttpProtocol: publicTls ? "https" : "http",
    publicTls,
    publicWebSocketProtocol: publicTls ? "wss" : "ws",
  };
}

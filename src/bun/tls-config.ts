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
/**
 * Formats loopback http origin.
 * @param port - port argument for formatLoopbackHttpOrigin.
 * @param tlsEnabled - tlsEnabled argument for formatLoopbackHttpOrigin.
 */

export function formatLoopbackHttpOrigin(
  port: number,
  tlsEnabled: boolean,
): string {
  return `${tlsEnabled ? "https" : "http"}://127.0.0.1:${port}`;
}
/**
 * Formats loopback web socket url.
 * @param port - port argument for formatLoopbackWebSocketUrl.
 * @param tlsEnabled - tlsEnabled argument for formatLoopbackWebSocketUrl.
 */

export function formatLoopbackWebSocketUrl(
  port: number,
  tlsEnabled: boolean,
): string {
  return `${tlsEnabled ? "wss" : "ws"}://127.0.0.1:${port}/rpc`;
}
/**
 * Is public tls enabled.
 * @param args - Argument list passed to isPublicTlsEnabled.
 * @param env - env argument for isPublicTlsEnabled.
 */

export function isPublicTlsEnabled(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (args.includes("--tls")) {
    return true;
  }
  return env[TLS_PUBLIC_TRANSPORT_ENV]?.trim() === "1";
}
/**
 * Resolves tls runtime config.
 * @param options - Configuration options used by this operation.
 */

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

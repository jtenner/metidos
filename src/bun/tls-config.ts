import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { type AppDataPathOptions, getAppDataDirectoryPath } from "./db";

const TLS_DIRECTORY_NAME = "tls";
const DEFAULT_TLS_CERT_FILE_NAME = "loopback-cert.pem";
const DEFAULT_TLS_KEY_FILE_NAME = "loopback-key.pem";
const DEFAULT_TLS_CA_FILE_NAME = "loopback-ca.pem";

export const TLS_CERT_PATH_ENV = "JOLT_TLS_CERT_PATH";
export const TLS_KEY_PATH_ENV = "JOLT_TLS_KEY_PATH";
export const TLS_CA_PATH_ENV = "JOLT_TLS_CA_PATH";
export const TLS_PASSPHRASE_ENV = "JOLT_TLS_PASSPHRASE";

type ProtocolSet = {
  httpProtocol: "http" | "https";
  websocketProtocol: "ws" | "wss";
};

export type TlsFilePaths = {
  caPath: string;
  certPath: string;
  keyPath: string;
};

export type ResolvedTlsRuntimeConfig = ProtocolSet & {
  caPath: string | null;
  certPath: string;
  enabled: boolean;
  keyPath: string;
  passphrase: string | null;
  tlsOptions: Bun.TLSOptions | null;
};

type ResolveTlsRuntimeConfigOptions = AppDataPathOptions & {
  env?: NodeJS.ProcessEnv;
  isDevServer: boolean;
};

type ResolvedTlsEnvPaths = {
  caPath: string;
  certPath: string;
  configuredCaPath: string | null;
  configuredCertPath: string | null;
  configuredKeyPath: string | null;
  keyPath: string;
  passphrase: string | null;
};

function readTrimmedEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveOptionalPath(path: string | null): string | null {
  return path ? resolve(path) : null;
}

export function getDefaultTlsPaths(options?: AppDataPathOptions): TlsFilePaths {
  const tlsDirectory = join(
    getAppDataDirectoryPath(options),
    TLS_DIRECTORY_NAME,
  );
  return {
    caPath: resolve(tlsDirectory, DEFAULT_TLS_CA_FILE_NAME),
    certPath: resolve(tlsDirectory, DEFAULT_TLS_CERT_FILE_NAME),
    keyPath: resolve(tlsDirectory, DEFAULT_TLS_KEY_FILE_NAME),
  };
}

function resolveTlsEnvironmentPaths(
  env: NodeJS.ProcessEnv,
  defaults: TlsFilePaths,
): ResolvedTlsEnvPaths {
  const configuredCertPath = resolveOptionalPath(
    readTrimmedEnvValue(env[TLS_CERT_PATH_ENV]),
  );
  const configuredKeyPath = resolveOptionalPath(
    readTrimmedEnvValue(env[TLS_KEY_PATH_ENV]),
  );
  if (Boolean(configuredCertPath) !== Boolean(configuredKeyPath)) {
    throw new Error(
      `Set both ${TLS_CERT_PATH_ENV} and ${TLS_KEY_PATH_ENV} together when overriding TLS files.`,
    );
  }

  const configuredCaPath = resolveOptionalPath(
    readTrimmedEnvValue(env[TLS_CA_PATH_ENV]),
  );

  return {
    caPath: configuredCaPath ?? defaults.caPath,
    certPath: configuredCertPath ?? defaults.certPath,
    configuredCaPath,
    configuredCertPath,
    configuredKeyPath,
    keyPath: configuredKeyPath ?? defaults.keyPath,
    passphrase: readTrimmedEnvValue(env[TLS_PASSPHRASE_ENV]),
  };
}

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

function buildProtocolSet(tlsEnabled: boolean): ProtocolSet {
  return {
    httpProtocol: tlsEnabled ? "https" : "http",
    websocketProtocol: tlsEnabled ? "wss" : "ws",
  };
}

function buildMissingTlsMessage(
  missingPaths: string[],
  paths: TlsFilePaths,
): string {
  const missingSummary =
    missingPaths.length === 1
      ? `Missing TLS file: ${missingPaths[0]}.`
      : `Missing TLS files: ${missingPaths.join(", ")}.`;
  return [
    "TLS configuration is incomplete.",
    missingSummary,
    `Run \`bun run tls:bootstrap\` to create loopback certificates at ${paths.certPath} and ${paths.keyPath}.`,
    `To use custom files instead, set ${TLS_CERT_PATH_ENV} and ${TLS_KEY_PATH_ENV}.`,
  ].join(" ");
}

export function resolveTlsRuntimeConfig(
  options: ResolveTlsRuntimeConfigOptions,
): ResolvedTlsRuntimeConfig {
  const env = options.env ?? process.env;
  const defaults = getDefaultTlsPaths(options);
  const resolvedPaths = resolveTlsEnvironmentPaths(env, defaults);
  const hasCert = existsSync(resolvedPaths.certPath);
  const hasKey = existsSync(resolvedPaths.keyPath);
  const hasCa = existsSync(resolvedPaths.caPath);
  const usingExplicitPair = Boolean(
    resolvedPaths.configuredCertPath && resolvedPaths.configuredKeyPath,
  );
  const usingExplicitCa = Boolean(resolvedPaths.configuredCaPath);
  const missingPaths = [
    hasCert ? null : resolvedPaths.certPath,
    hasKey ? null : resolvedPaths.keyPath,
    usingExplicitCa && !hasCa ? resolvedPaths.caPath : null,
  ].filter((value): value is string => Boolean(value));

  if (
    missingPaths.length > 0 &&
    (usingExplicitPair || usingExplicitCa || hasCert || hasKey)
  ) {
    throw new Error(buildMissingTlsMessage(missingPaths, defaults));
  }

  if (!hasCert || !hasKey) {
    return {
      ...buildProtocolSet(false),
      caPath: null,
      certPath: resolvedPaths.certPath,
      enabled: false,
      keyPath: resolvedPaths.keyPath,
      passphrase: resolvedPaths.passphrase,
      tlsOptions: null,
    };
  }

  return {
    ...buildProtocolSet(true),
    caPath: hasCa ? resolvedPaths.caPath : null,
    certPath: resolvedPaths.certPath,
    enabled: true,
    keyPath: resolvedPaths.keyPath,
    passphrase: resolvedPaths.passphrase,
    tlsOptions: {
      cert: Bun.file(resolvedPaths.certPath),
      key: Bun.file(resolvedPaths.keyPath),
      ...(resolvedPaths.passphrase
        ? {
            passphrase: resolvedPaths.passphrase,
          }
        : {}),
    },
  };
}

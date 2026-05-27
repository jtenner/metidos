/**
 * @file src/shared/runtime-config.ts
 * @description Browser-safe runtime config shared by server HTML injection and mainview bootstrap.
 */

export const RUNTIME_CONFIG_ELEMENT_ID = "metidos-runtime-config";

export type InjectedRuntimeConfig = {
  devServer: boolean;
  healthUrl?: string;
  preferTls?: boolean;
  rpcWebSocketUrl?: string;
  styleNonce?: string;
};

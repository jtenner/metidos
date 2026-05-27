/**
 * @file src/bun/plugin/notification-capability.ts
 * @description Internal capability seam for Plugin System v1 notification-provider delivery.
 */

import type { AppDataPathOptions } from "../db";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import {
  missingRequiredPluginSettingsMessage,
  pluginRuntimeSettingsForStartup,
  pluginSettingsDeclarations,
  PluginSidecarToolCallError,
  type PluginCapabilitySidecarRequest,
} from "./execution-capability";
import {
  PLUGIN_NOTIFICATION_PROVIDER_FAILED,
  type PluginNotificationReceipt,
  type PluginNotificationSendInput,
} from "./notifications";
import { readPluginSettingsForRuntime } from "./settings";
import type { PluginStartupRegistrations } from "./startup-registrations";

export type PluginNotificationProviderCapabilitySession = {
  directoryName: string;
  plugin: RpcPluginInventoryPlugin;
  ready?: boolean;
  registrations: PluginStartupRegistrations | null;
  stopping?: boolean;
};

export type PluginNotificationProviderRegistration =
  PluginStartupRegistrations["notificationProviders"][number];

export type PluginNotificationProviderInvocation<
  TSession extends PluginNotificationProviderCapabilitySession,
> = {
  registration: PluginNotificationProviderRegistration;
  request: PluginCapabilitySidecarRequest;
  session: TSession;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function normalizePluginNotificationProviderReceipt(input: {
  pluginId: string;
  providerId: string;
  receipt: unknown;
}): PluginNotificationReceipt {
  const provider = `${input.pluginId}/${input.providerId}`;
  if (!isRecord(input.receipt)) {
    return {
      channel: "plugin",
      code: "INVALID_PROVIDER_RECEIPT",
      deliveryId: null,
      message: `Plugin notification provider ${provider} returned an invalid receipt.`,
      outlet: "plugin",
      provider,
      retryable: false,
      status: "failed",
    };
  }
  const status = input.receipt.status === "delivered" ? "delivered" : "failed";
  const message =
    typeof input.receipt.message === "string" &&
    input.receipt.message.length > 0
      ? input.receipt.message
      : status === "delivered"
        ? "Plugin notification provider delivered the notification."
        : "Plugin notification provider failed to deliver the notification.";
  const code = optionalString(input.receipt.code);
  const externalId = optionalString(input.receipt.externalId);
  const externalUrl = optionalString(input.receipt.externalUrl);
  const retryable = optionalBoolean(input.receipt.retryable);
  const receipt: PluginNotificationReceipt = {
    channel: "plugin",
    deliveryId: null,
    message,
    outlet: "plugin",
    provider,
    status,
  };
  if (code !== undefined) {
    receipt.code = code ?? "PROVIDER_FAILED";
  }
  if (externalId !== undefined) {
    receipt.externalId = externalId;
  }
  if (externalUrl !== undefined) {
    receipt.externalUrl = externalUrl;
  }
  if (input.receipt.retryAfter !== undefined) {
    receipt.retryAfter = input.receipt.retryAfter as number | string | null;
  }
  if (retryable !== undefined) {
    receipt.retryable = retryable;
  }
  return receipt;
}

export function pluginNotificationProviderFailureReceipt(input: {
  code: string;
  message: string;
  pluginId: string;
  providerId: string;
  retryable?: boolean;
}): PluginNotificationReceipt {
  return {
    channel: "plugin",
    code: input.code,
    deliveryId: null,
    message: input.message,
    outlet: "plugin",
    provider: `${input.pluginId}/${input.providerId}`,
    retryable: input.retryable ?? false,
    status: "failed",
  };
}

export function pluginNotificationProviderFailureMessage(input: {
  error: unknown;
  pluginId: string;
  providerId: string;
}): string {
  if (input.error instanceof PluginSidecarToolCallError) {
    if (input.error.code === "timeout") {
      return `Plugin notification provider ${input.pluginId}/${input.providerId} timed out.`;
    }
    return `Plugin notification provider ${input.pluginId}/${input.providerId} failed: ${input.error.code}.`;
  }
  return input.error instanceof Error
    ? input.error.message
    : String(input.error);
}

export function isRetryablePluginNotificationProviderFailureCode(
  code: string,
): boolean {
  return (
    code === "timeout" ||
    code === "cancelled" ||
    code === "plugin_callback_timeout" ||
    code === "host_request_timeout"
  );
}

export async function buildPluginNotificationProviderSidecarRequest(input: {
  appDataOptions: AppDataPathOptions;
  directoryName: string;
  plugin: RpcPluginInventoryPlugin;
  pluginId: string;
  registration: PluginNotificationProviderRegistration;
  request: PluginNotificationSendInput;
}): Promise<PluginCapabilitySidecarRequest> {
  const settings = await readPluginSettingsForRuntime({
    declarations: pluginSettingsDeclarations(input.plugin),
    directoryName: input.directoryName,
    options: input.appDataOptions,
  });
  if (settings.missingRequiredKeys.length > 0) {
    throw new PluginSidecarToolCallError({
      code: "missing_required_plugin_settings",
      cause: new Error(
        missingRequiredPluginSettingsMessage(settings.missingRequiredKeys),
      ),
    });
  }
  return {
    directoryName: input.directoryName,
    operation: "notification.provider.send",
    params: {
      providerId: input.registration.id,
      request: {
        ...input.request,
        settings: pluginRuntimeSettingsForStartup(settings),
      },
      sendHandle: input.registration.sendHandle,
    },
    pluginId: input.pluginId,
    timeoutMs: input.registration.timeoutMs,
  };
}

export async function dispatchPluginNotificationProvidersForSessions<
  TSession extends PluginNotificationProviderCapabilitySession,
>(input: {
  appDataOptions: AppDataPathOptions;
  invokeSidecarRequest: (
    invocation: PluginNotificationProviderInvocation<TSession>,
  ) => Promise<unknown>;
  request: PluginNotificationSendInput;
  sessions: Iterable<TSession>;
}): Promise<PluginNotificationReceipt[]> {
  const receipts: PluginNotificationReceipt[] = [];

  const sessions = [...input.sessions].sort((left, right) =>
    left.directoryName.localeCompare(right.directoryName),
  );
  for (const session of sessions) {
    const pluginId = session.plugin.pluginId;
    if (
      !session.ready ||
      session.stopping ||
      !pluginId ||
      !session.registrations
    ) {
      continue;
    }
    for (const registration of session.registrations.notificationProviders) {
      try {
        const request = await buildPluginNotificationProviderSidecarRequest({
          appDataOptions: input.appDataOptions,
          directoryName: session.directoryName,

          plugin: session.plugin,
          pluginId,
          registration,
          request: input.request,
        });
        const result = await input.invokeSidecarRequest({
          registration,
          request,
          session,
        });
        const providerReceipts =
          isRecord(result) && Array.isArray(result.receipts)
            ? result.receipts
            : [
                {
                  code: "INVALID_PROVIDER_RESULT",
                  message:
                    "Plugin notification provider returned an invalid result.",
                  retryable: false,
                  status: "failed",
                },
              ];
        receipts.push(
          ...providerReceipts.map((receipt) =>
            normalizePluginNotificationProviderReceipt({
              pluginId,
              providerId: registration.id,
              receipt,
            }),
          ),
        );
      } catch (error) {
        const code =
          error instanceof PluginSidecarToolCallError
            ? error.code
            : PLUGIN_NOTIFICATION_PROVIDER_FAILED;
        receipts.push(
          pluginNotificationProviderFailureReceipt({
            code,
            message: pluginNotificationProviderFailureMessage({
              error,
              pluginId,
              providerId: registration.id,
            }),
            pluginId,
            providerId: registration.id,
            retryable: isRetryablePluginNotificationProviderFailureCode(code),
          }),
        );
      }
    }
  }
  return receipts;
}

/**
 * @file src/bun/plugin/prompt-injection-capability.ts
 * @description Internal capability seam for Plugin System v1 prompt injection callbacks.
 */

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import type { PluginCapabilitySidecarRequest } from "./execution-capability";
import type { PluginStartupRegistrations } from "./startup-registrations";

export type PluginPromptInjectionContext = {
  contextKind: "promptInjection";
  inject: string;
  ownerUserId?: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
};

export type PluginPromptInjectionRegistrationForThread = {
  directoryName: string;
  inject: string;
  pluginId: string;
  promptHandle: string;
  timeoutMs: number;
};

export type PluginPromptInjectionCapabilitySession = {
  directoryName: string;
  plugin: RpcPluginInventoryPlugin;
  ready?: boolean;
  registrations: PluginStartupRegistrations | null;
  stopping?: boolean;
};

function isReadyPromptInjectionSession(
  session: PluginPromptInjectionCapabilitySession,
): boolean {
  return Boolean(session.ready && !session.stopping);
}

function enabledInjectionNames(input: {
  enabledAccessGroups: Set<string>;
  plugin: RpcPluginInventoryPlugin;
}): Set<string> {
  const names = new Set<string>();
  if (!input.plugin.pluginId) {
    return names;
  }
  for (const group of input.plugin.manifest.access) {
    if (!group.id) {
      continue;
    }
    if (
      !input.enabledAccessGroups.has(`${input.plugin.pluginId}/${group.id}`)
    ) {
      continue;
    }
    for (const inject of group.injects ?? []) {
      if (inject.name) {
        names.add(inject.name);
      }
    }
  }
  return names;
}

export function listPluginPromptInjectionRegistrationsForThread(input: {
  enabledAccessGroups: readonly string[];
  sessions: Iterable<PluginPromptInjectionCapabilitySession>;
}): PluginPromptInjectionRegistrationForThread[] {
  const enabled = new Set(input.enabledAccessGroups);
  const registrations: PluginPromptInjectionRegistrationForThread[] = [];
  for (const session of input.sessions) {
    if (
      !isReadyPromptInjectionSession(session) ||
      !session.plugin.pluginId ||
      !session.registrations
    ) {
      continue;
    }
    const enabledNames = enabledInjectionNames({
      enabledAccessGroups: enabled,
      plugin: session.plugin,
    });
    for (const registration of session.registrations.injections) {
      if (!enabledNames.has(registration.inject)) {
        continue;
      }
      registrations.push({
        directoryName: session.directoryName,
        inject: registration.inject,
        pluginId: session.plugin.pluginId,
        promptHandle: registration.promptHandle,
        timeoutMs: registration.timeoutMs,
      });
    }
  }
  return registrations.sort((left, right) =>
    `${left.pluginId}/${left.inject}`.localeCompare(
      `${right.pluginId}/${right.inject}`,
    ),
  );
}

export function buildPluginPromptInjectionSidecarRequest(input: {
  context: PluginPromptInjectionContext;
  prompt: string;
  registration: PluginPromptInjectionRegistrationForThread;
  signal?: AbortSignal;
}): PluginCapabilitySidecarRequest {
  return {
    directoryName: input.registration.directoryName,
    operation: "prompt.inject",
    params: {
      inject: input.registration.inject,
      prompt: input.prompt,
      promptHandle: input.registration.promptHandle,
      context: input.context,
    },
    pluginId: input.registration.pluginId,
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: input.registration.timeoutMs,
  };
}

export function normalizePluginPromptInjectionResult(result: unknown): string {
  return typeof result === "string" ? result : "";
}

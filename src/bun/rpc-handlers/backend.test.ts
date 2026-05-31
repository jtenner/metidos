import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import {
  createBackendRpcHandlers,
  type BackendRpcHandlerDependencies,
} from "./backend";

const requestContext = {} as RpcRequestContext;

function createDependencies(
  overrides: Partial<BackendRpcHandlerDependencies> = {},
) {
  const calls: Array<{
    name: string;
    args: unknown[];
  }> = [];
  const dependencies = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }
        if (property in overrides) {
          return overrides[property as keyof BackendRpcHandlerDependencies];
        }
        return (...args: unknown[]) => {
          calls.push({ name: property, args });
          return { id: 0 };
        };
      },
    },
  ) as BackendRpcHandlerDependencies;

  return { calls, dependencies };
}

describe("createBackendRpcHandlers", () => {
  it("preserves cross-domain side effects from composed registrars", async () => {
    const sideEffects: string[] = [];
    const { dependencies } = createDependencies({
      getModelCatalogProcedure: async () => ({ providers: [] }) as never,
      newCronProcedure: async () => ({ id: 51 }) as never,
      refreshPluginModelProviderRegistrationsIfDue: () => {
        sideEffects.push("refresh-plugin-model-providers-if-due");
      },
      refreshPluginModelProvidersForCatalog: async () => {
        sideEffects.push("refresh-plugin-model-providers-for-catalog");
      },
      syncCronSchedulerCron: (cronId) => {
        sideEffects.push(`sync-cron-${cronId}`);
      },
    });
    const handlers = createBackendRpcHandlers(dependencies);

    await handlers.getModelCatalog(undefined, requestContext);
    await handlers.getModelCatalog({ refreshProviders: true }, requestContext);
    await handlers.newCron({} as never, requestContext);

    expect(sideEffects).toEqual([
      "refresh-plugin-model-providers-if-due",
      "refresh-plugin-model-providers-for-catalog",
      "sync-cron-51",
    ]);
  });
});

import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import {
  createModelCatalogRpcHandlers,
  type ModelCatalogRpcHandlerDependencies,
} from "./model-catalog";

const requestContext = {} as RpcRequestContext;

function createDefaultDependencies(
  overrides: Partial<ModelCatalogRpcHandlerDependencies> = {},
): ModelCatalogRpcHandlerDependencies {
  return {
    getModelCatalogProcedure: async () => ({ providers: [] }) as never,
    refreshPluginModelProviderRegistrationsIfDue: () => {},
    refreshPluginModelProvidersForCatalog: () => {},
    ...overrides,
  };
}

describe("createModelCatalogRpcHandlers", () => {
  it("refreshes plugin model providers before a forced catalog refresh", async () => {
    const calls: string[] = [];
    const catalog = { providers: [{ id: "provider" }] } as unknown as Awaited<
      ReturnType<ModelCatalogRpcHandlerDependencies["getModelCatalogProcedure"]>
    >;
    const handlers = createModelCatalogRpcHandlers(
      createDefaultDependencies({
        getModelCatalogProcedure: async () => {
          calls.push("get-catalog");
          return catalog;
        },
        refreshPluginModelProviderRegistrationsIfDue: () => {
          calls.push("refresh-if-due");
        },
        refreshPluginModelProvidersForCatalog: () => {
          calls.push("refresh-for-catalog");
        },
      }),
    );

    await expect(
      handlers.getModelCatalog({ refreshProviders: true }, requestContext),
    ).resolves.toBe(catalog);
    expect(calls).toEqual(["refresh-for-catalog", "get-catalog"]);
  });

  it("refreshes due plugin model-provider registrations before normal reads", async () => {
    const calls: string[] = [];
    const catalog = { providers: [] } as unknown as Awaited<
      ReturnType<ModelCatalogRpcHandlerDependencies["getModelCatalogProcedure"]>
    >;
    const handlers = createModelCatalogRpcHandlers(
      createDefaultDependencies({
        getModelCatalogProcedure: async () => {
          calls.push("get-catalog");
          return catalog;
        },
        refreshPluginModelProviderRegistrationsIfDue: () => {
          calls.push("refresh-if-due");
        },
        refreshPluginModelProvidersForCatalog: () => {
          calls.push("refresh-for-catalog");
        },
      }),
    );

    await expect(
      handlers.getModelCatalog(undefined, requestContext),
    ).resolves.toBe(catalog);
    expect(calls).toEqual(["refresh-if-due", "get-catalog"]);
  });
});

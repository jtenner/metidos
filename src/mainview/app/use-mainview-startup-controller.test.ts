import { afterEach, describe, expect, it } from "bun:test";
import { MAINVIEW_HTML_BOOTSTRAP_CONTRACT } from "../../bun/rpc-schema";
import { getMainviewHtmlBootstrapElementId } from "./html-bootstrap";
import { loadMainviewStartupBootstrap } from "./use-mainview-startup-controller";

type TestElement = {
  id: string;
  textContent: string | null;
  remove: () => void;
};

let bootstrapElement: TestElement | null = null;

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    getElementById(id: string) {
      return bootstrapElement?.id === id ? bootstrapElement : null;
    },
  },
});

function installBootstrap(
  data: unknown,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    schema: MAINVIEW_HTML_BOOTSTRAP_CONTRACT.schema,
    createdAt: new Date().toISOString(),
    staleAfterMs: 30_000,
    data,
    ...overrides,
  };
  bootstrapElement = {
    id: getMainviewHtmlBootstrapElementId(),
    textContent: JSON.stringify(payload),
    remove: () => {
      bootstrapElement = null;
    },
  };
}

const persistedState = {
  selectedProjectId: 42,
  selectedWorktreePath: "/repo",
  selectedThreadId: 7,
};

afterEach(() => {
  bootstrapElement = null;
});

describe("loadMainviewStartupBootstrap", () => {
  it("hydrates from valid inline data without an immediate getAppBootstrap RPC", async () => {
    const inlineData = { projects: [{ id: 42 }], marker: "inline" };
    let rpcCalls = 0;
    installBootstrap(inlineData);

    const result = await loadMainviewStartupBootstrap({
      persistedState,
      procedures: {
        getAppBootstrap: async () => {
          rpcCalls += 1;
          return { marker: "rpc" } as never;
        },
      },
    });

    expect(result).toEqual(inlineData as never);
    expect(rpcCalls).toBe(0);
    expect(
      document.getElementById(getMainviewHtmlBootstrapElementId()),
    ).toBeNull();
  });

  it("falls back to getAppBootstrap when inline data is invalid or omitted", async () => {
    let rpcParams: unknown = null;
    bootstrapElement = {
      id: getMainviewHtmlBootstrapElementId(),
      textContent: JSON.stringify({ schema: "wrong", data: { marker: "bad" } }),
      remove: () => {
        bootstrapElement = null;
      },
    };

    const result = await loadMainviewStartupBootstrap({
      persistedState,
      procedures: {
        getAppBootstrap: async (params) => {
          rpcParams = params;
          return { marker: "rpc" } as never;
        },
      },
    });

    expect(result).toEqual({ marker: "rpc" } as never);
    expect(rpcParams).toEqual({
      selectedProjectId: 42,
      selectedWorktreePath: "/repo",
      threadIdHint: 7,
    });
  });
});

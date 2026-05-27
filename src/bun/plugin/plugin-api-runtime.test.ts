/**
 * @file src/bun/plugin/plugin-api-runtime.test.ts
 * @description Tests for shared Metidos plugin API bootstrap source composition.
 */

import { describe, expect, it } from "bun:test";
import vm from "node:vm";

import {
  metidosPluginApiRuntimeSource,
  pluginJavaScriptBootstrapSource,
  pluginPythonBootstrapSource,
} from "./plugin-api-runtime";

function createFetchResponse(payload: Record<string, unknown>) {
  const source = `${metidosPluginApiRuntimeSource({ callbackInvocationToken: "token" })}\nreturn __metidosFetchResponse(arguments[0]);`;
  const context = vm.createContext({
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
  });
  const script = new vm.Script(`(function(payload) { ${source} })`);
  return script.runInContext(context)(payload) as {
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<unknown>;
    text(): Promise<string>;
  };
}

describe("shared plugin API runtime bootstrap", () => {
  it("uses the same Metidos API runtime source for JavaScript and Python bootstraps", () => {
    const options = {
      callbackInvocationToken: "token",
      pluginApi: {
        env: [{ key: "EXAMPLE", required: false, secret: false, value: "ok" }],
        permissions: ["log:write"],
        settings: { missingRequiredKeys: [], values: {} },
      },
    };

    const sharedRuntime = metidosPluginApiRuntimeSource(options);
    expect(pluginJavaScriptBootstrapSource(options)).toBe(sharedRuntime);
    expect(
      pluginPythonBootstrapSource({
        ...options,
        pythonEntrypoint: "./main.py",
      }),
    ).toStartWith(sharedRuntime);
  });

  it("marks Python entrypoints without importing a browser Python runtime", () => {
    const sharedRuntime = metidosPluginApiRuntimeSource({
      callbackInvocationToken: "token",
    });
    const pythonRuntime = pluginPythonBootstrapSource({
      callbackInvocationToken: "token",
      pythonEntrypoint: "./main.py",
    });

    expect(sharedRuntime).not.toContain("@pyscript/core");
    expect(pythonRuntime).not.toContain("@pyscript/core");
    expect(pythonRuntime).toContain("__metidosPythonEntrypoint");
  });

  it("exposes browser-compatible base64 helpers to JavaScript plugins", () => {
    const source = `${metidosPluginApiRuntimeSource({ callbackInvocationToken: "token" })}\nreturn {\n  globalEncoded: globalThis.btoa("\\x00\\xffhello"),\n  globalDecodedCodes: Array.from(globalThis.atob("AP9oZWxsbw==")).map((char) => char.charCodeAt(0)),\n  topLevelEncoded: btoa("ok"),\n  topLevelDecoded: atob("b2s="),\n  utilEncoded: metidos.util.btoa("ok"),\n  utilDecoded: metidos.util.atob("b2s="),\n  rejectsUnicode: (() => {\n    try {\n      globalThis.btoa("✓");\n      return false;\n    } catch {\n      return true;\n    }\n  })(),\n};`;
    const context = vm.createContext({
      TextDecoder,
      TextEncoder,
      URL,
      URLSearchParams,
    });
    const script = new vm.Script(`(function() { ${source} })`);

    expect(script.runInContext(context)()).toEqual({
      globalEncoded: "AP9oZWxsbw==",
      globalDecodedCodes: [0, 255, 104, 101, 108, 108, 111],
      topLevelEncoded: "b2s=",
      topLevelDecoded: "ok",
      utilEncoded: "b2s=",
      utilDecoded: "ok",
      rejectsUnicode: true,
    });
  });

  it("lazily decodes base64 fetch payloads for text and JSON callers", async () => {
    const response = createFetchResponse({
      bodyBase64: "eyJvayI6dHJ1ZX0=",
      status: 200,
    });

    await expect(response.text()).resolves.toBe('{"ok":true}');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("lazily exposes exact binary fetch payload bytes", async () => {
    const response = createFetchResponse({
      bodyBase64: "AAEC/w==",
      status: 200,
    });

    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      0, 1, 2, 255,
    ]);
  });

  it("keeps legacy text-only fetch payload compatibility", async () => {
    const response = createFetchResponse({ body: "legacy", status: 200 });

    await expect(response.text()).resolves.toBe("legacy");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(
      "legacy",
    );
  });
});

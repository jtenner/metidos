/**
 * @file src/bun/plugin/env.test.ts
 * @description Tests for Plugin System v1 manifest-declared environment capture.
 */

import { describe, expect, it } from "bun:test";
import type { RpcPluginManifestEnvVarSummary } from "../rpc-schema/plugin";
import {
  assertRequiredPluginEnvCaptured,
  capturePluginEnvironment,
  PLUGIN_ENV_SECRET_MASK,
  reviewValueForPluginEnvDeclaration,
} from "./env";

function envVar(
  input: Partial<RpcPluginManifestEnvVarSummary> & { key: string },
): RpcPluginManifestEnvVarSummary {
  return {
    defaultValue: null,
    description: null,
    hasDefault: false,
    required: false,
    reviewValue: null,
    secret: false,
    ...input,
  };
}

describe("plugin env capture", () => {
  it("captures only declared env vars with defaults and masks secret review values", () => {
    const declarations = [
      envVar({ key: "API_TOKEN", required: true, secret: true }),
      envVar({
        defaultValue: "safe",
        hasDefault: true,
        key: "PLUGIN_MODE",
      }),
      envVar({ key: "OPTIONAL_REGION" }),
    ];
    const environment = {
      API_TOKEN: "secret-token",
      OPTIONAL_REGION: "us-east-1",
      UNDECLARED_TOKEN: "must-not-capture",
    };

    expect(capturePluginEnvironment(declarations, environment)).toEqual([
      {
        key: "API_TOKEN",
        required: true,
        secret: true,
        value: "secret-token",
      },
      {
        key: "PLUGIN_MODE",
        required: false,
        secret: false,
        value: "safe",
      },
      {
        key: "OPTIONAL_REGION",
        required: false,
        secret: false,
        value: "us-east-1",
      },
    ]);
    expect(
      reviewValueForPluginEnvDeclaration(
        declarations[0] ?? envVar({ key: "" }),
        environment,
      ),
    ).toBe(PLUGIN_ENV_SECRET_MASK);
    expect(
      reviewValueForPluginEnvDeclaration(
        declarations[1] ?? envVar({ key: "" }),
        environment,
      ),
    ).toBe("safe");
  });

  it("rejects missing required declared env vars before sidecar startup", () => {
    const capturedEnv = capturePluginEnvironment(
      [
        envVar({ key: "ALPHA_TOKEN", required: true, secret: true }),
        envVar({ key: "BRAVO_TOKEN", required: true }),
        envVar({ key: "OPTIONAL_TOKEN" }),
      ],
      { BRAVO_TOKEN: "bravo" },
    );

    expect(() => assertRequiredPluginEnvCaptured(capturedEnv)).toThrow(
      "Missing required plugin env vars: ALPHA_TOKEN.",
    );
  });
});

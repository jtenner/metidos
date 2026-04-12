/**
 * @file src/mainview/app/thread-access-defaults.test.ts
 * @description Tests for safe-by-default child thread and cron access helpers.
 */

import { describe, expect, it } from "bun:test";

import { deriveSafeChildAccessDefaults } from "./thread-access-defaults";

describe("deriveSafeChildAccessDefaults", () => {
  it("keeps non-unsafe access scopes while clearing unsafe mode", () => {
    expect(
      deriveSafeChildAccessDefaults({
        webSearchAccess: true,
        githubAccess: true,
        agentsAccess: true,
        metidosAccess: true,
        unsafeMode: true,
      }),
    ).toEqual({
      webSearchAccess: true,
      githubAccess: true,
      agentsAccess: true,
      metidosAccess: true,
      unsafeMode: false,
    });
  });

  it("leaves already-safe access selections unchanged", () => {
    expect(
      deriveSafeChildAccessDefaults({
        webSearchAccess: true,
        githubAccess: false,
        agentsAccess: false,
        metidosAccess: true,
        unsafeMode: false,
      }),
    ).toEqual({
      webSearchAccess: true,
      githubAccess: false,
      agentsAccess: false,
      metidosAccess: true,
      unsafeMode: false,
    });
  });
});

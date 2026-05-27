import { describe, expect, it } from "bun:test";

import {
  DEFAULT_THREAD_ACCESS_PERMISSION_IDS,
  normalizeThreadAccessPermissionIds,
  projectLegacyThreadAccessBooleans,
  projectLegacyThreadAccessControl,
  projectSafeChildThreadAccessControl,
  projectThreadAccessControl,
} from "./thread-access-projection";

describe("thread access projection", () => {
  it("defines canonical default permissions", () => {
    expect(DEFAULT_THREAD_ACCESS_PERMISSION_IDS).toEqual([
      "metidos:crons",
      "metidos:threads",
      "metidos:web-search",
    ]);
    expect(projectThreadAccessControl().permissions).toEqual([
      "metidos:crons",
      "metidos:threads",
      "metidos:web-search",
    ]);
  });

  it("projects legacy booleans from canonical permissions", () => {
    expect(
      projectLegacyThreadAccessBooleans(["metidos:git", "metidos:threads"]),
    ).toMatchObject({
      gitAccess: true,
      threadsAccess: true,
      cronsAccess: false,
      metidosAccess: true,
      unsafeMode: false,
      webSearchAccess: false,
    });
  });

  it("sorts and deduplicates canonical permission arrays", () => {
    expect(
      normalizeThreadAccessPermissionIds([
        " weather:forecast ",
        "metidos:git",
        "",
        "metidos:git",
      ]),
    ).toEqual(["metidos:git", "weather:forecast"]);
  });

  it("removes unsafe permission for safe child defaults", () => {
    expect(
      projectSafeChildThreadAccessControl({
        permissions: ["metidos:unsafe", "metidos:git"],
      }),
    ).toMatchObject({
      permissions: ["metidos:git"],
      gitAccess: true,
      unsafeMode: false,
    });
  });

  it("preserves unknown plugin permissions without assigning legacy booleans", () => {
    expect(
      projectThreadAccessControl({ permissions: ["weather:forecast"] }),
    ).toMatchObject({
      permissions: ["weather:forecast"],
      webSearchAccess: false,
      weatherAccess: false,
    });
  });

  it("projects legacy backend booleans into canonical permissions", () => {
    expect(
      projectLegacyThreadAccessControl(
        {
          gitAccess: true,
          metidosAccess: false,
          threadsAccess: true,
          unsafeMode: true,
          webSearchAccess: false,
        },
        { defaultLegacyAccess: true },
      ),
    ).toMatchObject({
      permissions: ["metidos:git", "metidos:threads", "metidos:unsafe"],
      cronsAccess: false,
      gitAccess: true,
      metidosAccess: true,
      threadsAccess: true,
      unsafeMode: true,
      webSearchAccess: false,
    });
  });
});

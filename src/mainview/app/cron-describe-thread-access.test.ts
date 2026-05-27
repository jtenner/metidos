import { describe, expect, it } from "bun:test";
import { permissionsForDescribeCronThread } from "./cron-describe-thread-access";

describe("permissionsForDescribeCronThread", () => {
  it("adds cron tool access to the helper thread when target cron permissions omit it", () => {
    expect(permissionsForDescribeCronThread(["metidos:threads"])).toEqual([
      "metidos:threads",
      "metidos:crons",
    ]);
  });

  it("preserves existing permissions when cron tool access is already present", () => {
    const permissions = ["metidos:crons", "metidos:web-search"];

    expect(permissionsForDescribeCronThread(permissions)).toBe(permissions);
  });
});

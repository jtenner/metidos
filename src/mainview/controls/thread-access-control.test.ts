/**
 * @file src/mainview/controls/thread-access-control.test.ts
 * @description Test file for thread access control.
 */

import { describe, expect, it } from "bun:test";

import { accessDescriptionPopoverPositionClassName } from "./thread-access-control";

describe("accessDescriptionPopoverPositionClassName", () => {
  it("positions desktop access descriptions to the right of the trigger", () => {
    expect(accessDescriptionPopoverPositionClassName("desktop")).toContain(
      "left-full",
    );
    expect(accessDescriptionPopoverPositionClassName("desktop")).toContain(
      "ml-2",
    );
  });

  it("positions mobile access descriptions to the left of the trigger", () => {
    expect(accessDescriptionPopoverPositionClassName("mobile")).toContain(
      "right-full",
    );
    expect(accessDescriptionPopoverPositionClassName("mobile")).toContain(
      "mr-2",
    );
  });
});

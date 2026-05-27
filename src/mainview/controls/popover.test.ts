/**
 * @file src/mainview/controls/popover.test.ts
 * @description Test file for shared popover helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  createPointReference,
  derivePopoverVisibilityState,
  shouldRestoreFocusForPopoverClose,
  surfaceRoleForMode,
} from "./popover";

describe("createPointReference", () => {
  it("builds a virtual reference from viewport coordinates", () => {
    const reference = createPointReference({
      height: 12,
      width: 24,
      x: 40,
      y: 55,
    });
    const rect = reference.getBoundingClientRect();

    expect(rect.left).toBe(40);
    expect(rect.top).toBe(55);
    expect(rect.width).toBe(24);
    expect(rect.height).toBe(12);
    expect(rect.right).toBe(64);
    expect(rect.bottom).toBe(67);
  });
});

describe("surfaceRoleForMode", () => {
  it("maps chooser and nonmodal surfaces to dialog semantics", () => {
    expect(surfaceRoleForMode("chooser")).toBe("dialog");
    expect(surfaceRoleForMode("nonmodal-dialog")).toBe("dialog");
  });

  it("keeps tooltip semantics explicit and leaves plain surfaces unnamed", () => {
    expect(surfaceRoleForMode("tooltip")).toBe("tooltip");
    expect(surfaceRoleForMode("plain")).toBeUndefined();
  });
});

describe("derivePopoverVisibilityState", () => {
  it("reports visible when hide middleware did not flag any clipping", () => {
    expect(derivePopoverVisibilityState({})).toEqual({
      escaped: false,
      referenceHidden: false,
      visible: true,
    });
  });

  it("reports hidden when the reference is clipped away", () => {
    expect(
      derivePopoverVisibilityState({
        hide: {
          referenceHidden: true,
        },
      }),
    ).toEqual({
      escaped: false,
      referenceHidden: true,
      visible: false,
    });
  });

  it("can keep surfaces visible when viewport changes clip the reference", () => {
    expect(
      derivePopoverVisibilityState(
        {
          hide: {
            referenceHidden: true,
          },
        },
        {
          hideWhenReferenceHidden: false,
        },
      ),
    ).toEqual({
      escaped: false,
      referenceHidden: true,
      visible: true,
    });
  });

  it("keeps escaped surfaces visible by default so portaled popovers can leave scroll containers", () => {
    expect(
      derivePopoverVisibilityState({
        hide: {
          escaped: true,
        },
      }),
    ).toEqual({
      escaped: true,
      referenceHidden: false,
      visible: true,
    });
  });

  it("reports hidden when the floating surface escaped its clipping context and the caller opts into escaped hiding", () => {
    expect(
      derivePopoverVisibilityState(
        {
          hide: {
            escaped: true,
          },
        },
        {
          hideWhenEscaped: true,
        },
      ),
    ).toEqual({
      escaped: true,
      referenceHidden: false,
      visible: false,
    });
  });
});

describe("shouldRestoreFocusForPopoverClose", () => {
  it("restores focus for keyboard dismissal but not outside pointer dismissal", () => {
    expect(shouldRestoreFocusForPopoverClose("escape")).toBeTrue();
    expect(shouldRestoreFocusForPopoverClose("outside-press")).toBeFalse();
  });
});

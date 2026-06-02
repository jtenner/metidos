import { describe, expect, it } from "bun:test";
import {
  ENABLE_NATIVE_CLIPBOARD_ENV,
  sanitizeBackendDisplayEnvironment,
} from "./start-env";

describe("backend display environment sanitization", () => {
  it("clears display variables by default", () => {
    const env: Record<string, string | undefined> = {
      DISPLAY: ":1",
      WAYLAND_DISPLAY: "wayland-1",
    };

    sanitizeBackendDisplayEnvironment(env);

    expect(env).toEqual({});
  });

  it("preserves display variables only when native clipboard integration is explicitly enabled", () => {
    const env = {
      [ENABLE_NATIVE_CLIPBOARD_ENV]: "1",
      DISPLAY: ":1",
      WAYLAND_DISPLAY: "wayland-1",
    };

    sanitizeBackendDisplayEnvironment(env);

    expect(env).toEqual({
      [ENABLE_NATIVE_CLIPBOARD_ENV]: "1",
      DISPLAY: ":1",
      WAYLAND_DISPLAY: "wayland-1",
    });
  });

  it("treats any value other than an exact trimmed 1 as disabled", () => {
    for (const value of [undefined, "", "0", "true", " yes "]) {
      const env: Record<string, string | undefined> = {
        [ENABLE_NATIVE_CLIPBOARD_ENV]: value,
        DISPLAY: ":1",
        WAYLAND_DISPLAY: "wayland-1",
      };

      sanitizeBackendDisplayEnvironment(env);

      expect(env.DISPLAY).toBeUndefined();
      expect(env.WAYLAND_DISPLAY).toBeUndefined();
    }
  });
});

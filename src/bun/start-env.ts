export const ENABLE_NATIVE_CLIPBOARD_ENV = "METIDOS_BACKEND_NATIVE_CLIPBOARD";

type MutableEnv = Record<string, string | undefined>;

export function sanitizeBackendDisplayEnvironment(env: MutableEnv): void {
  if (env[ENABLE_NATIVE_CLIPBOARD_ENV]?.trim() === "1") {
    return;
  }

  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
}

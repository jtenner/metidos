/**
 * @file src/bun/start.ts
 * @description Package-script bootstrap for the long-running Metidos backend.
 */

const ENABLE_NATIVE_CLIPBOARD_ENV = "METIDOS_BACKEND_NATIVE_CLIPBOARD";

if (process.env[ENABLE_NATIVE_CLIPBOARD_ENV]?.trim() !== "1") {
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
}

const { runBackendCli } = await import("./index");

await runBackendCli();

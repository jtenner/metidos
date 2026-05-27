/**
 * @file src/mainview/dev-log.ts
 * @description Small development-only frontend logging helper.
 */

export function devLog(...args: unknown[]): void {
  if (window.__metidosRuntime?.devServer) {
    console.debug("[metidos]", ...args);
  }
}

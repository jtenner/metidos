/**
 * @file src/bun/build-mainview.ts
 * @description Module for build mainview.
 */

import { resolve } from "node:path";

import reactCompiler from "../../bun-plugin-react-compiler";

/** Absolute path to the main frontend entry module used to produce the browser bundle. */
const MAINVIEW_ENTRYPOINT = resolve(process.cwd(), "src/mainview/index.ts");

/** Output directory for the built frontend assets consumed by the Bun sidecar. */
export const MAINVIEW_BUILD_DIR = resolve(process.cwd(), ".metidos-build");

/**
 * Build the mainview frontend bundle and return the emitted `index.js` path.
 *
 * Uses Bun’s bundler with the custom React compiler plugin to transform TSX.
 * Returns an absolute path and throws when the bundling result is incomplete.
 *
 * @returns Absolute file path to the generated `index.js` bundle.
 */
export async function buildMainviewBundle(): Promise<string> {
  // Keep build config explicit here so caller behavior and generated artifact location
  // are deterministic and easy to audit.
  const buildResult = await Bun.build({
    entrypoints: [MAINVIEW_ENTRYPOINT],
    format: "esm",
    minify: false,
    outdir: MAINVIEW_BUILD_DIR,
    plugins: [reactCompiler],
    sourcemap: "external",
    target: "browser",
  });

  // Surface build errors early and include Bun-provided diagnostic logs for debugging.
  if (!buildResult.success) {
    for (const log of buildResult.logs) {
      console.error(log);
    }
    throw new Error("Failed to build browser bundle");
  }

  // The output naming is controlled by Bun; we require `index.js` for the runtime loader.
  const mainviewBundle = buildResult.outputs.find((output) =>
    output.path.endsWith("index.js"),
  );
  if (!mainviewBundle) {
    throw new Error("Mainview JavaScript bundle was not emitted");
  }

  return mainviewBundle.path;
}

/** CLI entrypoint: build and print the produced bundle path when directly executed. */
if (import.meta.main) {
  // Useful for one-off local builds and scripts that only need a single status line.
  const mainviewBundlePath = await buildMainviewBundle();
  console.log(`Built mainview bundle at ${mainviewBundlePath}`);
}

import { resolve } from "node:path";

import reactCompiler from "../../bun-plugin-react-compiler";

const MAINVIEW_ENTRYPOINT = resolve(process.cwd(), "src/mainview/index.ts");

export const MAINVIEW_BUILD_DIR = resolve(process.cwd(), ".jolt-build");

export async function buildMainviewBundle(): Promise<string> {
  const buildResult = await Bun.build({
    entrypoints: [MAINVIEW_ENTRYPOINT],
    format: "esm",
    minify: false,
    outdir: MAINVIEW_BUILD_DIR,
    plugins: [reactCompiler],
    sourcemap: "external",
    target: "browser",
  });

  if (!buildResult.success) {
    for (const log of buildResult.logs) {
      console.error(log);
    }
    throw new Error("Failed to build browser bundle");
  }

  const mainviewBundle = buildResult.outputs.find((output) =>
    output.path.endsWith("index.js"),
  );
  if (!mainviewBundle) {
    throw new Error("Mainview JavaScript bundle was not emitted");
  }

  return mainviewBundle.path;
}

if (import.meta.main) {
  const mainviewBundlePath = await buildMainviewBundle();
  console.log(`Built mainview bundle at ${mainviewBundlePath}`);
}

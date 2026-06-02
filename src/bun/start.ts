/**
 * @file src/bun/start.ts
 * @description Package-script bootstrap for the long-running Metidos backend.
 */

import { sanitizeBackendDisplayEnvironment } from "./start-env";

sanitizeBackendDisplayEnvironment(process.env);

const { runBackendCli } = await import("./index");

await runBackendCli();

/**
 * @file src/bun/pi-ollama-web-search.ts
 * @description Runtime loader for the Ollama Pi web-search extension.
 */

import { createRequire } from "node:module";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

const require = createRequire(import.meta.url);

const loadedModule = require("@ollama/pi-web-search") as
  | ExtensionFactory
  | {
      default: ExtensionFactory;
    };

const registerOllamaPiWebSearchTools =
  typeof loadedModule === "function" ? loadedModule : loadedModule.default;

export default registerOllamaPiWebSearchTools;

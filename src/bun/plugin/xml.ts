import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_NODES = 20_000;
const DEFAULT_MAX_TEXT_CHARS = 1_000_000;
const HARD_MAX_BYTES = 10 * 1024 * 1024;
const HARD_MAX_DEPTH = 256;
const HARD_MAX_NODES = 100_000;
const HARD_MAX_TEXT_CHARS = 2_000_000;

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export type MetidosXmlElement = {
  attributes: Record<string, string>;
  children: MetidosXmlElement[];
  name: string;
  text: string;
  type: "element";
};

export type MetidosXmlParseOptions = {
  loose?: boolean;
  lowercaseNames?: boolean;
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxTextChars?: number;
  trimText?: boolean;
};

class MetidosXmlParseError extends Error {
  code = "plugin_xml_parse_error";

  constructor(message: string) {
    super(message);
    this.name = "MetidosXmlParseError";
  }
}

function finitePositiveInteger(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.trunc(value), max);
}

type NormalizedXmlParseOptions = Required<MetidosXmlParseOptions>;

function normalizedOptions(input: unknown): NormalizedXmlParseOptions {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    loose: record.loose === true,
    lowercaseNames: record.lowercaseNames === true,
    maxBytes: finitePositiveInteger(
      record.maxBytes,
      DEFAULT_MAX_BYTES,
      HARD_MAX_BYTES,
    ),
    maxDepth: finitePositiveInteger(
      record.maxDepth,
      DEFAULT_MAX_DEPTH,
      HARD_MAX_DEPTH,
    ),
    maxNodes: finitePositiveInteger(
      record.maxNodes,
      DEFAULT_MAX_NODES,
      HARD_MAX_NODES,
    ),
    maxTextChars: finitePositiveInteger(
      record.maxTextChars,
      DEFAULT_MAX_TEXT_CHARS,
      HARD_MAX_TEXT_CHARS,
    ),
    trimText: record.trimText === true,
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

type XmloxideWasmExports = {
  memory: WebAssembly.Memory;
  metidos_xmloxide_alloc(len: number): number;
  metidos_xmloxide_dealloc(ptr: number, len: number): void;
  metidos_xmloxide_parse(
    ptr: number,
    len: number,
    loose: number,
    lowercaseNames: number,
    trimText: number,
    maxNodes: number,
    maxDepth: number,
    maxTextChars: number,
  ): number;
  metidos_xmloxide_result_free(): void;
  metidos_xmloxide_result_len(): number;
  metidos_xmloxide_result_ptr(): number;
};

type XmloxideParseResponse =
  | { diagnostics?: unknown; ok: true; root?: unknown }
  | { error?: unknown; ok: false };

let xmloxideExports: XmloxideWasmExports | null = null;

function xmloxideWasmPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../native/xmloxide-wasm/dist/metidos_xmloxide_wasm.wasm",
  );
}

function loadXmloxideWasm(): XmloxideWasmExports {
  if (xmloxideExports) return xmloxideExports;
  let wasmBytes: Uint8Array<ArrayBuffer>;
  try {
    const bundle =
      require("../../../native/xmloxide-wasm/dist/metidos_xmloxide_wasm.cjs") as {
        wasmBytes?: unknown;
      };
    if (typeof bundle.wasmBytes !== "function") {
      throw new Error("xmloxide bundle did not export wasmBytes().");
    }
    wasmBytes = new Uint8Array(bundle.wasmBytes() as Uint8Array);
  } catch (error) {
    const wasmPath = xmloxideWasmPath();
    if (!existsSync(wasmPath)) {
      throw new MetidosXmlParseError(
        `XML parsing requires the xmloxide WASM bundle or artifact. Run bun run native/xmloxide-wasm/build.ts. Missing ${wasmPath}; bundle load error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    wasmBytes = new Uint8Array(readFileSync(wasmPath));
  }
  const module = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(module, {});
  xmloxideExports = instance.exports as XmloxideWasmExports;
  return xmloxideExports;
}

function assertXmlElement(value: unknown): MetidosXmlElement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MetidosXmlParseError("XML parser returned invalid output.");
  }
  const record = value as Partial<MetidosXmlElement>;
  if (
    record.type !== "element" ||
    typeof record.name !== "string" ||
    typeof record.text !== "string" ||
    !record.attributes ||
    typeof record.attributes !== "object" ||
    Array.isArray(record.attributes) ||
    !Array.isArray(record.children)
  ) {
    throw new MetidosXmlParseError("XML parser returned invalid output.");
  }
  return {
    attributes: Object.fromEntries(
      Object.entries(record.attributes).map(([key, value]) => [
        key,
        String(value ?? ""),
      ]),
    ),
    children: record.children.map(assertXmlElement),
    name: record.name,
    text: record.text,
    type: "element",
  };
}

function parseXmlDocumentWithXmloxide(
  content: string,
  options: NormalizedXmlParseOptions,
): MetidosXmlElement {
  const encoder = new TextEncoder();
  const input = encoder.encode(content);
  const wasm = loadXmloxideWasm();
  const inputPtr = wasm.metidos_xmloxide_alloc(input.byteLength);
  try {
    new Uint8Array(wasm.memory.buffer).set(input, inputPtr);
    wasm.metidos_xmloxide_parse(
      inputPtr,
      input.byteLength,
      options.loose ? 1 : 0,
      options.lowercaseNames ? 1 : 0,
      options.trimText ? 1 : 0,
      options.maxNodes,
      options.maxDepth,
      options.maxTextChars,
    );
    const resultPtr = wasm.metidos_xmloxide_result_ptr();
    const resultLen = wasm.metidos_xmloxide_result_len();
    if (!resultPtr || resultLen <= 0) {
      throw new MetidosXmlParseError("XML parser returned no result.");
    }
    const output = new TextDecoder().decode(
      new Uint8Array(wasm.memory.buffer, resultPtr, resultLen),
    );
    const parsed = JSON.parse(output) as XmloxideParseResponse;
    if (!parsed.ok) {
      throw new MetidosXmlParseError(
        String(parsed.error ?? "XML parse failed."),
      );
    }
    return assertXmlElement(parsed.root);
  } finally {
    wasm.metidos_xmloxide_dealloc(inputPtr, input.byteLength);
    wasm.metidos_xmloxide_result_free();
  }
}

export function parseXmlDocument(
  input: unknown,
  parseOptions?: unknown,
): MetidosXmlElement {
  const content = String(input ?? "");
  const options = normalizedOptions(parseOptions);
  if (byteLength(content) > options.maxBytes) {
    throw new MetidosXmlParseError(
      `XML input exceeded ${options.maxBytes} bytes.`,
    );
  }
  if (/<!DOCTYPE\b/iu.test(content)) {
    throw new MetidosXmlParseError(
      "XML DTD declarations are not allowed in plugin XML parsing.",
    );
  }
  return parseXmlDocumentWithXmloxide(content, options);
}

export function encodeXmlText(input: unknown): string {
  return String(input ?? "").replace(
    /[&<>"']/gu,
    (char) => XML_ESCAPES[char] ?? char,
  );
}

/**
 * @file src/bun/plugin/plugin-api-runtime.ts
 * @description Shared Plugin System v1 Metidos API bootstrap source for JS and Python entrypoint runtimes.
 */

import {
  PLUGIN_INGRESS_CALLBACK_TIMEOUT_MAX_MS,
  PLUGIN_INGRESS_CALLBACK_TIMEOUT_MIN_MS,
  PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS,
  PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS,
  PLUGIN_REPLY_TO_SOURCE_PERMISSION,
  PLUGIN_REQUEST_INGRESS_PERMISSION,
} from "./ingress";
import { PLUGIN_LOG_WRITE_PERMISSION } from "./log";
import { PLUGIN_NOTIFICATION_PROVIDER_PERMISSION } from "./notifications";
import type {
  PluginSidecarStartupEnvVar,
  PluginSidecarStartupSettingsPayload,
} from "./sidecar-rpc";
import {
  PLUGIN_CRON_CREATE_PERMISSION,
  PLUGIN_MODEL_PROVIDER_PERMISSION,
  PLUGIN_OAUTH_PROVIDER_PERMISSION,
  PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS,
  PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS,
  PLUGIN_STARTUP_CRON_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_INGRESS_SOURCE_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT,
  PLUGIN_STARTUP_MODEL_PROVIDER_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_NOTIFICATION_PROVIDER_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_OAUTH_PROVIDER_REGISTRATION_LIMIT,
} from "./startup-registrations";

export type PluginRuntimeApiBootstrapOptions = {
  callbackInvocationToken: string;
  pluginApi?: {
    env?: PluginSidecarStartupEnvVar[];
    permissions?: readonly string[];
    settings?: PluginSidecarStartupSettingsPayload;
  };
};

const PLUGIN_API_SHIM_SOURCE = `
export function definePlugin(definition) {
  if (typeof definition === "function") {
    const setupResult = definition(globalThis.metidos);
    const snapshotRegistrations = () => globalThis.__metidosPluginStartupRegistrations();
    if (setupResult && typeof setupResult.then === "function") {
      const registrations = setupResult.then(snapshotRegistrations);
      globalThis.__metidosDefinedPlugin = registrations;
      return registrations;
    }
    const registrations = snapshotRegistrations();
    globalThis.__metidosDefinedPlugin = registrations;
    return registrations;
  }
  globalThis.__metidosDefinedPlugin = definition;
  return definition;
}
export const metidos = globalThis.metidos;
export const atob = globalThis.atob;
export const btoa = globalThis.btoa;
export default { definePlugin, metidos, atob, btoa };
`;

const QUICKJS_FORBIDDEN_GLOBALS_SOURCE = `
for (const forbiddenGlobal of ["Bun", "fetch", "process", "require", "setTimeout", "setInterval", "queueMicrotask", "eval", "Function"]) {
  Object.defineProperty(globalThis, forbiddenGlobal, {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
}
`;

export function createMetidosPluginApiBuildPlugin(): Bun.BunPlugin {
  return {
    name: "metidos-plugin-api-shim",
    setup(build) {
      build.onResolve({ filter: /^@metidos\/plugin-api$/ }, () => ({
        namespace: "metidos-plugin-api",
        path: "metidos-plugin-api",
      }));
      build.onLoad({ filter: /.*/, namespace: "metidos-plugin-api" }, () => ({
        contents: PLUGIN_API_SHIM_SOURCE,
        loader: "js",
      }));
    },
  };
}

function jsonForPluginBootstrap(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replaceAll("<", "\\u003c");
}

function envRecordForPluginApi(
  env: PluginSidecarStartupEnvVar[] = [],
): Record<string, string | null> {
  return Object.fromEntries(env.map((envVar) => [envVar.key, envVar.value]));
}

function emptySettings(): PluginSidecarStartupSettingsPayload {
  return { missingRequiredKeys: [], values: {} };
}

export function metidosPluginApiRuntimeSource(
  input: PluginRuntimeApiBootstrapOptions,
): string {
  const pluginApi = input.pluginApi ?? {};
  const envValues = envRecordForPluginApi(pluginApi.env);
  const settings = pluginApi.settings ?? emptySettings();

  return `
Object.defineProperty(globalThis, "__metidosDefaultExport", {
  configurable: false,
  enumerable: false,
  value: undefined,
  writable: true,
});
Object.defineProperty(globalThis, "__metidosDefinedPlugin", {
  configurable: false,
  enumerable: false,
  value: undefined,
  writable: true,
});
let __metidosActiveCallbackContextValue = null;
let __metidosActiveCallbackDeadlineMsValue = null;
Object.defineProperty(globalThis, "__metidosActiveCallbackContext", {
  configurable: false,
  enumerable: false,
  get() { return __metidosActiveCallbackContextValue; },
  set() { throw new Error("Plugin callback context is read-only."); },
});
Object.defineProperty(globalThis, "__metidosActiveCallbackDeadlineMs", {
  configurable: false,
  enumerable: false,
  get() { return __metidosActiveCallbackDeadlineMsValue; },
  set() { throw new Error("Plugin callback deadline is read-only."); },
});
const __metidosCloneValue = (value) => Array.isArray(value) ? value.slice() : value;
const __metidosCloneRecord = (record) => Object.freeze(Object.fromEntries(
  Object.entries(record).map(([key, value]) => [key, __metidosCloneValue(value)]),
));
const __metidosGetDeclared = (record, key, label) => {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(\`Plugin \${label} key must be a non-empty string.\`);
  }
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new Error(\`Plugin \${label} "\${key}" is not declared.\`);
  }
  return __metidosCloneValue(record[key]);
};
const __metidosSettingsApi = (values, label) => Object.freeze({
  all() {
    return __metidosCloneRecord(values);
  },
  get(key) {
    return __metidosGetDeclared(values, key, label);
  },
  has(key) {
    return typeof key === "string" && Object.prototype.hasOwnProperty.call(values, key);
  },
});
const __metidosHostError = (payload, fallbackName, fallbackMessage) => {
  const error = new Error(payload.error?.message ?? fallbackMessage);
  error.name = payload.error?.name ?? fallbackName;
  error.code = payload.error?.code;
  return error;
};
const __metidosStructuredDataOperation = (operation, input) => {
  if (typeof globalThis.__metidosHostStructuredDataOperation !== "function") {
    throw new Error("Plugin structured data host API is unavailable.");
  }
  const payload = JSON.parse(
    globalThis.__metidosHostStructuredDataOperation(operation, input),
  );
  if (payload.error) {
    throw __metidosHostError(
      payload,
      "PluginStructuredDataError",
      "Plugin structured data operation failed.",
    );
  }
  return payload.result;
};
const __metidosUtf8Encode = (value) => {
  const bytes = [];
  for (const char of String(value ?? "")) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
  }
  return new Uint8Array(bytes);
};
const __metidosUtf8Decode = (bytes) => {
  let output = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    if (first < 0x80) {
      output += String.fromCodePoint(first);
    } else if (first < 0xe0) {
      output += String.fromCodePoint(((first & 0x1f) << 6) | (bytes[index++] & 0x3f));
    } else if (first < 0xf0) {
      output += String.fromCodePoint(((first & 0x0f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f));
    } else {
      output += String.fromCodePoint(((first & 0x07) << 18) | ((bytes[index++] & 0x3f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f));
    }
  }
  return output;
};
const __metidosFetchResponse = (payload) => {
  let body = typeof payload.body === "string" ? payload.body : null;
  let bytes = null;
  const getBytes = () => {
    if (bytes === null) {
      bytes = typeof payload.bodyBase64 === "string" ? __metidosBase64ToBytes(payload.bodyBase64) : __metidosUtf8Encode(body ?? "");
    }
    return bytes;
  };
  const getBody = () => {
    if (body === null) {
      body = __metidosUtf8Decode(getBytes());
    }
    return body;
  };
  return Object.freeze({
    headers: Object.freeze({ ...(payload.headers ?? {}) }),
    ok: payload.status >= 200 && payload.status < 300,
    redirected: payload.redirected === true,
    status: payload.status,
    statusText: payload.statusText,
    url: payload.url,
    arrayBuffer() {
      const value = getBytes();
      return Promise.resolve(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    },
    json() {
      const value = getBody();
      if (!value.trim()) {
        return Promise.reject(new Error("Plugin fetch response body is empty; cannot parse JSON."));
      }
      try {
        return Promise.resolve(JSON.parse(value));
      } catch (error) {
        return Promise.reject(new Error("Plugin fetch response body is not valid JSON: " + value.slice(0, 200)));
      }
    },
    text() {
      return Promise.resolve(getBody());
    },
  });
};
const __metidosRegistrations = { crons: [], gc: null, ingressSources: [], injections: [], modelProviders: [], notificationProviders: [], oauthProviders: [], tools: [] };
const __metidosCallbackHandles = Object.create(null);
let __metidosNextCallbackHandle = 1;
const __metidosStartupOnly = (feature) => {
  if (globalThis.__metidosActiveCallbackContext !== null) {
    const error = new Error("Plugin " + feature + " registration is available only during initialization.");
    error.name = "PluginContextError";
    error.code = "plugin_context_error";
    throw error;
  }
};
const __metidosRequirePermission = (permission, feature) => {
  if (!${jsonForPluginBootstrap(pluginApi.permissions ?? [])}.includes(permission)) {
    const error = new Error(feature + " requires " + permission + ".");
    error.name = "PluginPermissionError";
    error.code = "plugin_permission_error";
    throw error;
  }
};
const __metidosAssertRecord = (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(\`\${path} must be an object.\`);
  }
};
const __metidosStringField = (record, key, path) => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(\`\${path}.\${key} must be a non-empty string.\`);
  }
  return value;
};
const __metidosIngressTimeoutField = (record, path) => {
  const value = record.timeoutMs;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < ${PLUGIN_INGRESS_CALLBACK_TIMEOUT_MIN_MS} ||
    value > ${PLUGIN_INGRESS_CALLBACK_TIMEOUT_MAX_MS}
  ) {
    throw new Error(
      \`\${path}.timeoutMs must be an integer between ${PLUGIN_INGRESS_CALLBACK_TIMEOUT_MIN_MS} and ${PLUGIN_INGRESS_CALLBACK_TIMEOUT_MAX_MS}.\`,
    );
  }
  return value;
};
const __metidosIngressPollIntervalField = (record, path) => {
  const value = record.pollIntervalMs;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < ${PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS} ||
    value > ${PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS}
  ) {
    throw new Error(
      \`\${path}.pollIntervalMs must be an integer between ${PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS} and ${PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS}.\`,
    );
  }
  return value;
};
const __metidosTimeoutField = (record, path) => {
  const value = record.timeoutMs;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS} ||
    value > ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS}
  ) {
    throw new Error(
      \`\${path}.timeoutMs must be an integer between ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS} and ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS}.\`,
    );
  }
  return value;
};
const __metidosFunctionHandle = (record, key, path, prefix = "tool") => {
  const value = record[key];
  if (typeof value !== "function") {
    throw new Error(\`\${path}.\${key} must be a function.\`);
  }
  const handle = \`\${prefix}:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = value;
  return handle;
};
const __metidosNotificationProviderSendHandle = (record, key, path) => {
  const value = record[key];
  if (typeof value !== "function") {
    throw new Error(\`\${path}.\${key} must be a function.\`);
  }
  const handle = \`notificationProvider:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = async (...args) => {
    const result = await value(...args);
    if (!result || typeof result !== "object" || Array.isArray(result) || !Array.isArray(result.receipts)) {
      throw new Error(\`\${path}.\${key} must return an object with a receipts array.\`);
    }
    for (const [index, receipt] of result.receipts.entries()) {
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
        throw new Error(\`\${path}.\${key} receipt \${index} must be an object.\`);
      }
      if (receipt.status !== "delivered" && receipt.status !== "failed") {
        throw new Error(\`\${path}.\${key} receipt \${index} status must be delivered or failed.\`);
      }
      if (typeof receipt.message !== "string" || receipt.message.length === 0) {
        throw new Error(\`\${path}.\${key} receipt \${index} message must be a non-empty string.\`);
      }
    }
    return result;
  };
  return handle;
};
const __metidosModelProviderConfigurationCallback = (record, key, path) => {
  const value = record[key];
  if (typeof value !== "function") {
    throw new Error(path + "." + key + " must be a function.");
  }
  const handle = \`modelProvider:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = value;
  return Object.freeze({ handle, value });
};
const __metidosCronActionHandle = (record, key, path) => {
  const value = record[key];
  if (typeof value !== "function") {
    throw new Error(path + "." + key + " must be a function.");
  }
  const handle = \`cron:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = value;
  return handle;
};
const __metidosGcActionHandle = (record, key, path) => {
  const value = record[key];
  if (typeof value !== "function") {
    throw new Error(path + "." + key + " must be a function.");
  }
  const handle = \`gc:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = value;
  return handle;
};
const __metidosOptionalOAuthCallback = (record, key, path) => {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new Error(path + "." + key + " must be a function when provided.");
  }
  const handle = \`oauthProvider:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = value;
  return handle;
};
const __metidosBase64Decode = (input) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = 0;
  let bitLength = 0;
  const bytes = [];
  for (const char of input.replace(/=+$/g, "")) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
      throw new Error("Invalid base64 character.");
    }
    bits = (bits << 6) | value;
    bitLength += 6;
    if (bitLength >= 8) {
      bitLength -= 8;
      bytes.push((bits >> bitLength) & 0xff);
    }
  }
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
};
const __metidosJwtPayload = (token) => {
  if (typeof token !== "string") {
    return null;
  }
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = __metidosBase64Decode(padded);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
const __metidosOptionalModelProviderExecuteCallback = (record, key, path) => {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new Error(path + "." + key + " must be a function when provided.");
  }
  const handle = \`modelProvider:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = value;
  return handle;
};
const __metidosOptionalModelProviderEmbedCallback = (record, key, path) => {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new Error(path + "." + key + " must be a function when provided.");
  }
  const handle = \`modelProvider:\${key}:\${__metidosNextCallbackHandle++}\`;
  __metidosCallbackHandles[handle] = value;
  return handle;
};
const __metidosRefreshIntervalField = (record, path) => {
  const value = record.refreshIntervalMs;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(path + ".refreshIntervalMs must be a positive integer.");
  }
  return value;
};
const __metidosCalendarEventsOperation = async (operation, params = {}) => {
  if (typeof globalThis.__metidosHostCalendarEventsOperation !== "function") {
    throw new Error("Plugin calendar/events host API is unavailable.");
  }
  const payload = JSON.parse(
    await globalThis.__metidosHostCalendarEventsOperation(operation, params ?? {}, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!payload.ok) {
    throw __metidosHostError(
      payload,
      "PluginCalendarEventsError",
      "Plugin calendar/events operation failed.",
    );
  }
  return payload.result;
};
const __metidosTerminalOperation = async (operation, params = {}) => {
  if (typeof globalThis.__metidosHostTerminalOperation !== "function") {
    throw new Error("Plugin terminal host API is unavailable.");
  }
  const payload = JSON.parse(
    await globalThis.__metidosHostTerminalOperation(operation, params ?? {}, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!payload.ok) {
    throw __metidosHostError(
      payload,
      "PluginTerminalError",
      "Plugin terminal operation failed.",
    );
  }
  return payload.result;
};
const __metidosSqliteOperation = async (operation, params = {}) => {
  if (typeof globalThis.__metidosHostSqliteOperation !== "function") {
    throw new Error("Plugin SQLite host API is unavailable.");
  }
  const payload = JSON.parse(
    await globalThis.__metidosHostSqliteOperation(operation, params ?? {}, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!payload.ok) {
    throw __metidosHostError(
      payload,
      "PluginSqliteError",
      "Plugin SQLite operation failed.",
    );
  }
  return payload.result;
};
const __metidosBase64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const __metidosBytesToBase64 = (bytes) => {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;
    output += __metidosBase64Alphabet[(combined >> 18) & 63];
    output += __metidosBase64Alphabet[(combined >> 12) & 63];
    output += index + 1 < bytes.length ? __metidosBase64Alphabet[(combined >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? __metidosBase64Alphabet[combined & 63] : "=";
  }
  return output;
};
const __metidosBase64ToBytes = (value) => {
  const clean = String(value ?? "").replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes = [];
  for (let index = 0; index < clean.length; index += 4) {
    const enc1 = __metidosBase64Alphabet.indexOf(clean[index]);
    const enc2 = __metidosBase64Alphabet.indexOf(clean[index + 1]);
    const enc3 = clean[index + 2] === "=" ? -1 : __metidosBase64Alphabet.indexOf(clean[index + 2]);
    const enc4 = clean[index + 3] === "=" ? -1 : __metidosBase64Alphabet.indexOf(clean[index + 3]);
    if (enc1 < 0 || enc2 < 0) break;
    const combined = (enc1 << 18) | (enc2 << 12) | ((enc3 < 0 ? 0 : enc3) << 6) | (enc4 < 0 ? 0 : enc4);
    bytes.push((combined >> 16) & 255);
    if (enc3 >= 0) bytes.push((combined >> 8) & 255);
    if (enc4 >= 0) bytes.push(combined & 255);
  }
  return new Uint8Array(bytes);
};
const __metidosAtob = (value) => {
  const clean = String(value ?? "").replace(/[\\t\\n\\f\\r ]/g, "");
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(clean)) {
    throw new Error("Invalid base64 input.");
  }
  const paddingIndex = clean.indexOf("=");
  if (paddingIndex >= 0) {
    const padding = clean.slice(paddingIndex);
    if (!/^=+$/.test(padding) || padding.length > 2 || clean.length % 4 !== 0) {
      throw new Error("Invalid base64 input.");
    }
  }
  const padded = clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), "=");
  const bytes = __metidosBase64ToBytes(padded);
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
};
const __metidosBtoa = (value) => {
  const text = String(value ?? "");
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) {
      throw new Error("btoa input must be a binary string with only Latin-1 code points.");
    }
    bytes.push(code);
  }
  return __metidosBytesToBase64(new Uint8Array(bytes));
};
const __metidosInstallTopLevelFunction = (name, value) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    } else if (descriptor.writable && typeof globalThis[name] !== "function") {
      globalThis[name] = value;
    }
  } catch {
    try {
      globalThis[name] = value;
    } catch {}
  }
  return typeof globalThis[name] === "function" ? globalThis[name] : value;
};
var atob = __metidosInstallTopLevelFunction("atob", __metidosAtob);
var btoa = __metidosInstallTopLevelFunction("btoa", __metidosBtoa);
const __metidosBytePayload = (bytes) => Object.freeze({ __metidosBytesBase64: __metidosBytesToBase64(bytes) });
const __metidosNormalizeFetchOptions = (options) => {
  const normalized = { ...(options ?? {}) };
  const body = normalized.body;
  if (body instanceof ArrayBuffer) {
    normalized.body = __metidosBytePayload(new Uint8Array(body));
  } else if (ArrayBuffer.isView(body)) {
    normalized.body = __metidosBytePayload(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  return normalized;
};
const __metidosMaybeBytes = (value) => {
  if (value && typeof value === "object" && typeof value.__metidosBytesBase64 === "string") {
    return __metidosBase64ToBytes(value.__metidosBytesBase64);
  }
  return value;
};
const __metidosFsOperation = async (operation, params = {}) => {
  if (typeof globalThis.__metidosHostFsOperation !== "function") {
    throw new Error("Plugin fs host API is unavailable.");
  }
  const payload = JSON.parse(
    await globalThis.__metidosHostFsOperation(operation, params ?? {}, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!payload.ok) {
    throw __metidosHostError(payload, "PluginFsError", "Plugin fs operation failed.");
  }
  return __metidosMaybeBytes(payload.result);
};
const __metidosWebSocketOperation = async (operation, params = {}) => {
  if (typeof globalThis.__metidosHostWebSocketOperation !== "function") {
    throw new Error("Plugin WebSocket host API is unavailable.");
  }
  const payload = JSON.parse(
    await globalThis.__metidosHostWebSocketOperation(operation, params ?? {}, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!payload.ok) {
    throw __metidosHostError(
      payload,
      "PluginWebSocketError",
      "Plugin WebSocket operation failed.",
    );
  }
  return payload.result;
};
const __metidosCreateWebSocketClient = (id, url) => {
  const client = Object.freeze({
    id,
    url,
    async close(code, reason) {
      await __metidosWebSocketOperation("websocket.close", { id, code, reason });
    },
    async receive(options = {}) {
      return Object.freeze(await __metidosWebSocketOperation("websocket.receive", { id, options }));
    },
    async sendText(text) {
      await __metidosWebSocketOperation("websocket.send", { id, text: String(text) });
    },
    async state() {
      const result = await __metidosWebSocketOperation("websocket.state", { id });
      return String(result.state);
    },
    async *events(options = {}) {
      while (true) {
        const event = Object.freeze(await __metidosWebSocketOperation("websocket.receive", { id, options }));
        yield event;
        if (event.type === "close" || event.type === "error") {
          return;
        }
      }
    },
  });
  return client;
};
const __metidosEmbeddingPayload = (value) => {
  if (value instanceof ArrayBuffer) {
    return __metidosBytePayload(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    return __metidosBytePayload(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  return value;
};
const __metidosLanceDbOperation = async (operation, params) => {
  if (typeof globalThis.__metidosHostLanceDbOperation !== "function") {
    throw new Error("Plugin LanceDB host API is unavailable.");
  }
  const response = JSON.parse(
    await globalThis.__metidosHostLanceDbOperation(operation, params, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!response.ok) {
    throw __metidosHostError(response, "PluginLanceDbError", "Plugin LanceDB operation failed.");
  }
  return Object.freeze(response.result);
};
const __metidosEmbeddingsOperation = async (input, payload) => {
  if (typeof globalThis.__metidosHostEmbeddingsOperation !== "function") {
    throw new Error("Plugin embeddings host API is unavailable.");
  }
  const response = JSON.parse(
    await globalThis.__metidosHostEmbeddingsOperation({ input: __metidosEmbeddingPayload(input), payload: payload ?? null }, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!response.ok) {
    throw __metidosHostError(response, "PluginEmbeddingsError", "Plugin embeddings operation failed.");
  }
  return Object.freeze(response.result.slice());
};
const __metidosLogOperation = async (level, message) => {
  __metidosRequirePermission(${jsonForPluginBootstrap(PLUGIN_LOG_WRITE_PERMISSION)}, "metidos.log");
  if (typeof globalThis.__metidosHostLog !== "function") {
    throw new Error("Plugin log host API is unavailable.");
  }
  const payload = JSON.parse(
    await globalThis.__metidosHostLog({ level: String(level), message: String(message) }, {
      context: globalThis.__metidosActiveCallbackContext,
      deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
    }),
  );
  if (!payload.ok) {
    throw __metidosHostError(
      payload,
      "PluginLogError",
      "Plugin log operation failed.",
    );
  }
};
const __metidosNormalizeModelProviderConfigurations = (provider) => {
  const configurations = Array.isArray(provider.configurations)
    ? provider.configurations
    : [];
  const path = "metidos.providers.addProvider " + provider.id + ".configurations";
  return configurations.map((configuration, index) => {
    const configurationPath = path + "[" + index + "]";
    __metidosAssertRecord(configuration, configurationPath);
    __metidosStringField(configuration, "id", configurationPath);
    return Object.freeze({ ...configuration });
  });
};
const __metidosSnapshotRegistrations = async () => {
  const snapshot = {
    tools: __metidosRegistrations.tools.map((tool) => Object.freeze({ ...tool })),
  };
  if (__metidosRegistrations.crons.length > 0) {
    snapshot.crons = __metidosRegistrations.crons.map((cron) => Object.freeze({ ...cron }));
  }
  if (__metidosRegistrations.gc !== null) {
    snapshot.gc = Object.freeze({ ...__metidosRegistrations.gc });
  }
  if (__metidosRegistrations.ingressSources.length > 0) {
    snapshot.ingressSources = __metidosRegistrations.ingressSources.map((source) => Object.freeze({ ...source }));
  }
  if (__metidosRegistrations.modelProviders.length > 0) {
    const modelProviders = [];
    let configurationCount = 0;
    for (const provider of __metidosRegistrations.modelProviders) {
      const configurations = await __metidosNormalizeModelProviderConfigurations(provider);
      configurationCount += configurations.length;
      if (configurationCount > ${PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT}) {
        throw new Error("metidos.providers.addProvider supports at most ${PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT} provider configurations per plugin.");
      }
      modelProviders.push(Object.freeze({
        configurations: Object.freeze(configurations),
        ...(provider.embedHandle === undefined ? {} : { embedHandle: provider.embedHandle }),
        ...(provider.executeHandle === undefined ? {} : { executeHandle: provider.executeHandle }),
        getProviderConfigurationsHandle: provider.getProviderConfigurationsHandle,
        id: provider.id,
        ...(provider.refreshIntervalMs === undefined ? {} : { refreshIntervalMs: provider.refreshIntervalMs }),
        timeoutMs: provider.timeoutMs,
      }));
    }
    snapshot.modelProviders = modelProviders;
  }
  if (__metidosRegistrations.notificationProviders.length > 0) {
    snapshot.notificationProviders = __metidosRegistrations.notificationProviders.map((provider) => Object.freeze({ ...provider }));
  }
  if (__metidosRegistrations.oauthProviders.length > 0) {
    snapshot.oauthProviders = __metidosRegistrations.oauthProviders.map((provider) => Object.freeze({ ...provider }));
  }
  if (__metidosRegistrations.injections.length > 0) {
    snapshot.injections = __metidosRegistrations.injections.map((injection) => Object.freeze({ ...injection }));
  }
  return Object.freeze(snapshot);
};
Object.defineProperty(globalThis, "__metidosPluginStartupRegistrations", {
  configurable: false,
  enumerable: false,
  value: __metidosSnapshotRegistrations,
  writable: false,
});
Object.defineProperty(globalThis, "__metidosPluginCallbackHandles", {
  configurable: false,
  enumerable: false,
  value: __metidosCallbackHandles,
  writable: false,
});
Object.defineProperty(globalThis, "__metidosInvokePluginCallback", {
  configurable: false,
  enumerable: false,
  value: async (token, handle, args, deadlineMs) => {
    if (token !== ${jsonForPluginBootstrap(input.callbackInvocationToken)}) {
      throw new Error("Plugin callback invocation token is invalid.");
    }
    const callback = __metidosCallbackHandles[handle];
    if (typeof callback !== "function") {
      throw new Error("Plugin callback handle " + String(handle) + " is not registered.");
    }
    const previousContext = __metidosActiveCallbackContextValue;
    const previousDeadlineMs = __metidosActiveCallbackDeadlineMsValue;
    const callbackContext = args[0] ?? null;
    __metidosActiveCallbackContextValue = callbackContext;
    __metidosActiveCallbackDeadlineMsValue = deadlineMs;
    try {
      return await callback(...args);
    } finally {
      __metidosActiveCallbackContextValue = previousContext;
      __metidosActiveCallbackDeadlineMsValue = previousDeadlineMs;
    }
  },
  writable: false,
});
const __metidosApi = {
  async fetch(url, options = {}) {
    if (typeof globalThis.__metidosHostFetch !== "function") {
      throw new Error("Plugin fetch host API is unavailable.");
    }
    const rawPayload = await globalThis.__metidosHostFetch(String(url), __metidosNormalizeFetchOptions(options));
    if (typeof rawPayload !== "string" || rawPayload.trim().length === 0) {
      throw new Error("Plugin fetch host returned an empty RPC payload.");
    }
    const payload = JSON.parse(rawPayload);
    if (!payload.ok) {
      throw __metidosHostError(payload, "PluginFetchError", "Plugin fetch failed.");
    }
    return __metidosFetchResponse(payload.response);
  },
  websocket: Object.freeze({
    async connect(url, options = {}) {
      const result = await __metidosWebSocketOperation("websocket.connect", {
        options,
        url: String(url),
      });
      return __metidosCreateWebSocketClient(result.id, result.url);
    },
  }),
  fs: Object.freeze({
    exists(path) {
      return __metidosFsOperation("fs.exists", { path });
    },
    glob(pattern) {
      return __metidosFsOperation("fs.glob", { pattern });
    },
    ls(path) {
      return __metidosFsOperation("fs.ls", { path });
    },
    mkdir(path, options = {}) {
      return __metidosFsOperation("fs.mkdir", { options, path });
    },
    read(path) {
      return __metidosFsOperation("fs.read", { path });
    },
    readText(path) {
      return __metidosFsOperation("fs.readText", { path });
    },
    rm(path, options = {}) {
      return __metidosFsOperation("fs.rm", { options, path });
    },
    stat(path) {
      return __metidosFsOperation("fs.stat", { path });
    },
    write(path, bytes) {
      const data = bytes instanceof ArrayBuffer
        ? __metidosBytePayload(new Uint8Array(bytes))
        : ArrayBuffer.isView(bytes)
          ? __metidosBytePayload(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
          : bytes;
      return __metidosFsOperation("fs.write", { bytes: data, path });
    },
    writeText(path, contents) {
      return __metidosFsOperation("fs.writeText", { contents, path });
    },
  }),
  embeddings: Object.freeze({
    embed(input, payload = null) {
      return __metidosEmbeddingsOperation(input, payload);
    },
  }),
  lancedb: Object.freeze({
    async open(path) {
      const normalizedPath = String(path);
      return Object.freeze({
        path: normalizedPath,
        async query(vector, options = {}) {
          return __metidosLanceDbOperation("lancedb.query", {
            limit: options && typeof options === "object" ? options.limit : undefined,
            path: normalizedPath,
            vector,
          });
        },
        async remove(id) {
          return __metidosLanceDbOperation("lancedb.delete", {
            id,
            path: normalizedPath,
          });
        },
        async upsert(rows) {
          return __metidosLanceDbOperation("lancedb.upsert", {
            path: normalizedPath,
            rows: Array.isArray(rows) ? rows : [rows],
          });
        },
      });
    },
  }),
  async log(level, message) {
    await __metidosLogOperation(level, message);
  },
  cron(registration) {
    const path = "metidos.cron registration";
    __metidosStartupOnly("cron");
    __metidosRequirePermission(${jsonForPluginBootstrap(PLUGIN_CRON_CREATE_PERMISSION)}, "metidos.cron");
    __metidosAssertRecord(registration, path);
    if (__metidosRegistrations.crons.length >= ${PLUGIN_STARTUP_CRON_REGISTRATION_LIMIT}) {
      throw new Error("metidos.cron supports at most ${PLUGIN_STARTUP_CRON_REGISTRATION_LIMIT} crons per plugin.");
    }
    const key = __metidosStringField(registration, "key", path);
    const schedule = __metidosStringField(registration, "schedule", path);
    const timeoutMs = __metidosTimeoutField(registration, path);
    const actionHandle = __metidosCronActionHandle(registration, "action", path);
    const normalized = Object.freeze({ actionHandle, key, schedule, timeoutMs });
    __metidosRegistrations.crons.push(normalized);
    return normalized;
  },
  gc(registration) {
    const path = "metidos.gc registration";
    __metidosStartupOnly("GC");
    __metidosAssertRecord(registration, path);
    if (__metidosRegistrations.gc !== null) {
      throw new Error("metidos.gc supports only one registration per plugin.");
    }
    const timeoutMs = __metidosTimeoutField(registration, path);
    const actionHandle = __metidosGcActionHandle(registration, "action", path);
    const normalized = Object.freeze({ actionHandle, timeoutMs });
    __metidosRegistrations.gc = normalized;
    return normalized;
  },
  addInjection(registration) {
    const path = "metidos.addInjection registration";
    __metidosStartupOnly("prompt injection");
    __metidosRequirePermission("metidos:prompt_inject", "metidos.addInjection");
    __metidosAssertRecord(registration, path);
    const inject = __metidosStringField(registration, "inject", path);
    const name = __metidosStringField(registration, "name", path);
    const timeoutMs = __metidosTimeoutField(registration, path);
    const promptHandle = __metidosFunctionHandle(registration, "prompt", path, "injection");
    const normalized = Object.freeze({ inject, name, promptHandle, timeoutMs });
    __metidosRegistrations.injections.push(normalized);
    return normalized;
  },
  addAgentTool(registration) {
    const path = "metidos.addAgentTool registration";
    __metidosAssertRecord(registration, path);
    const tool = __metidosStringField(registration, "tool", path);
    const name = __metidosStringField(registration, "name", path);
    const description = __metidosStringField(registration, "description", path);
    const timeoutMs = __metidosTimeoutField(registration, path);
    const validatePropsHandle = __metidosFunctionHandle(registration, "validateProps", path);
    const actionHandle = __metidosFunctionHandle(registration, "action", path);
    const normalized = Object.freeze({
      actionHandle,
      description,
      name,
      timeoutMs,
      tool,
      validatePropsHandle,
    });
    __metidosRegistrations.tools.push(normalized);
    return normalized;
  },
  ingress: Object.freeze({
    registerSource(registration) {
      const path = "metidos.ingress.registerSource registration";
      __metidosStartupOnly("ingress source");
      __metidosRequirePermission(${jsonForPluginBootstrap(PLUGIN_REQUEST_INGRESS_PERMISSION)}, "metidos.ingress.registerSource");
      __metidosAssertRecord(registration, path);
      if (__metidosRegistrations.ingressSources.length >= ${PLUGIN_STARTUP_INGRESS_SOURCE_REGISTRATION_LIMIT}) {
        throw new Error("metidos.ingress.registerSource supports at most ${PLUGIN_STARTUP_INGRESS_SOURCE_REGISTRATION_LIMIT} sources per plugin.");
      }
      const id = __metidosStringField(registration, "id", path);
      const name = __metidosStringField(registration, "name", path);
      const description = typeof registration.description === "string" && registration.description.length > 0 ? registration.description : null;
      const timeoutMs = __metidosIngressTimeoutField(registration, path);
      const pollIntervalMs = __metidosIngressPollIntervalField(registration, path);
      const pollHandle = __metidosFunctionHandle(registration, "poll", path, "ingress");
      const promptTemplateHandle = __metidosFunctionHandle(registration, "promptTemplate", path, "ingress");
      const respondHandle = typeof registration.respond === "function" ? __metidosFunctionHandle(registration, "respond", path, "ingress") : null;
      const supportsReplyToSource = Boolean(registration.supportsReplyToSource || respondHandle);
      if (supportsReplyToSource) {
        __metidosRequirePermission(${jsonForPluginBootstrap(PLUGIN_REPLY_TO_SOURCE_PERMISSION)}, "metidos.ingress.registerSource reply support");
      }
      const normalized = Object.freeze({ description, id, name, pollHandle, pollIntervalMs, promptTemplateHandle, respondHandle, supportsReplyToSource, timeoutMs });
      __metidosRegistrations.ingressSources.push(normalized);
      return normalized;
    },
  }),
  env: Object.freeze({
    get(key) {
      return __metidosGetDeclared(${jsonForPluginBootstrap(envValues)}, key, "env");
    },
  }),
  settings: __metidosSettingsApi(${jsonForPluginBootstrap(
    settings.values,
  )}, "setting"),
  providers: Object.freeze({
    addProvider(registration) {
      const path = "metidos.providers.addProvider registration";
      __metidosStartupOnly("model provider");
      __metidosRequirePermission(${jsonForPluginBootstrap(PLUGIN_MODEL_PROVIDER_PERMISSION)}, "metidos.providers.addProvider");
      __metidosAssertRecord(registration, path);
      if (__metidosRegistrations.modelProviders.length >= ${PLUGIN_STARTUP_MODEL_PROVIDER_REGISTRATION_LIMIT}) {
        throw new Error("metidos.providers.addProvider supports at most ${PLUGIN_STARTUP_MODEL_PROVIDER_REGISTRATION_LIMIT} provider families per plugin.");
      }
      const id = __metidosStringField(registration, "id", path);
      const timeoutMs = __metidosTimeoutField(registration, path);
      const getProviderConfigurations = __metidosModelProviderConfigurationCallback(registration, "getProviderConfigurations", path);
      const embedHandle = __metidosOptionalModelProviderEmbedCallback(registration, "embed", path);
      const executeHandle = __metidosOptionalModelProviderExecuteCallback(registration, "execute", path);
      const refreshIntervalMs = __metidosRefreshIntervalField(registration, path);
      const normalized = Object.freeze({
        ...(embedHandle === undefined ? {} : { embedHandle }),
        ...(executeHandle === undefined ? {} : { executeHandle }),
        configurations: Array.isArray(registration.configurations)
          ? registration.configurations
          : [],
        getProviderConfigurations: getProviderConfigurations.value,
        getProviderConfigurationsHandle: getProviderConfigurations.handle,
        id,
        refreshIntervalMs,
        timeoutMs,
      });
      __metidosRegistrations.modelProviders.push(normalized);
      return Object.freeze({ id, ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs }), timeoutMs });
    },
    registerProvider(registration) {
      return this.addProvider(registration);
    },
  }),
  registerOAuth(registration) {
    return this.oauth.registerProvider(registration);
  },
  oauth: Object.freeze({
    registerProvider(registration) {
      const path = "metidos.oauth.registerProvider registration";
      __metidosStartupOnly("OAuth provider");
      __metidosRequirePermission(${jsonForPluginBootstrap(PLUGIN_OAUTH_PROVIDER_PERMISSION)}, "metidos.oauth.registerProvider");
      __metidosAssertRecord(registration, path);
      if (__metidosRegistrations.oauthProviders.length >= ${PLUGIN_STARTUP_OAUTH_PROVIDER_REGISTRATION_LIMIT}) {
        throw new Error("metidos.oauth.registerProvider supports at most ${PLUGIN_STARTUP_OAUTH_PROVIDER_REGISTRATION_LIMIT} providers per plugin.");
      }
      const id = __metidosStringField(registration, "id", path);
      const provider = __metidosStringField(registration, "provider", path);
      const timeoutMs = __metidosTimeoutField(registration, path);
      const importCredentialsHandle = __metidosOptionalOAuthCallback(registration, "importCredentials", path);
      const refreshHandle = __metidosOptionalOAuthCallback(registration, "refresh", path);
      if (importCredentialsHandle === undefined && refreshHandle === undefined) {
        throw new Error(path + " must provide importCredentials or refresh.");
      }
      const normalized = Object.freeze({
        id,
        provider,
        ...(importCredentialsHandle === undefined ? {} : { importCredentialsHandle }),
        ...(refreshHandle === undefined ? {} : { refreshHandle }),
        timeoutMs,
      });
      __metidosRegistrations.oauthProviders.push(normalized);
      return normalized;
    },
  }),
  notifications: Object.freeze({
    addProvider(registration) {
      const path = "metidos.notifications.addProvider registration";
      __metidosStartupOnly("notification provider");
      __metidosRequirePermission(${jsonForPluginBootstrap(PLUGIN_NOTIFICATION_PROVIDER_PERMISSION)}, "metidos.notifications.addProvider");
      __metidosAssertRecord(registration, path);
      if (__metidosRegistrations.notificationProviders.length >= ${PLUGIN_STARTUP_NOTIFICATION_PROVIDER_REGISTRATION_LIMIT}) {
        throw new Error(\`metidos.notifications.addProvider supports at most ${PLUGIN_STARTUP_NOTIFICATION_PROVIDER_REGISTRATION_LIMIT} providers per plugin.\`);
      }
      const id = __metidosStringField(registration, "id", path);
      const timeoutMs = __metidosTimeoutField(registration, path);
      const sendHandle = __metidosNotificationProviderSendHandle(registration, "send", path);
      const normalized = Object.freeze({ id, sendHandle, timeoutMs });
      __metidosRegistrations.notificationProviders.push(normalized);
      return normalized;
    },
    registerProvider(registration) {
      return this.addProvider(registration);
    },
    async send(input) {
      if (typeof globalThis.__metidosHostNotificationSend !== "function") {
        throw new Error("Plugin notification host API is unavailable.");
      }
      const payload = JSON.parse(
        await globalThis.__metidosHostNotificationSend(input ?? {}, {
          context: globalThis.__metidosActiveCallbackContext,
          deadlineMs: globalThis.__metidosActiveCallbackDeadlineMs,
        }),
      );
      if (!payload.ok) {
        throw __metidosHostError(
          payload,
          "PluginNotificationError",
          "Plugin notification send failed.",
        );
      }
      return Object.freeze({
        ...payload.result,
        receipts: Object.freeze(
          (payload.result?.receipts ?? []).map((receipt) => Object.freeze({ ...receipt })),
        ),
      });
    },
  }),
  calendar: Object.freeze({
    list(params = {}) {
      return __metidosCalendarEventsOperation("calendar.list", params);
    },
    create(params) {
      return __metidosCalendarEventsOperation("calendar.create", params);
    },
    modify(params) {
      return __metidosCalendarEventsOperation("calendar.modify", params);
    },
    delete(params) {
      return __metidosCalendarEventsOperation("calendar.delete", params);
    },
  }),
  events: Object.freeze({
    list(params) {
      return __metidosCalendarEventsOperation("events.list", params);
    },
    get(params) {
      return __metidosCalendarEventsOperation("events.get", params);
    },
    create(params) {
      return __metidosCalendarEventsOperation("events.create", params);
    },
    modify(params) {
      return __metidosCalendarEventsOperation("events.modify", params);
    },
    delete(params) {
      return __metidosCalendarEventsOperation("events.delete", params);
    },
  }),
  terminal: Object.freeze({
    create(params = {}) {
      return __metidosTerminalOperation("terminal.create", params);
    },
    read(params) {
      return __metidosTerminalOperation("terminal.read", params);
    },
    grep(params) {
      return __metidosTerminalOperation("terminal.grep", params);
    },
    kill(params) {
      return __metidosTerminalOperation("terminal.kill", params);
    },
  }),
  toml: Object.freeze({
    parse(content) {
      return __metidosStructuredDataOperation("toml.parse", String(content));
    },
    stringify(value) {
      return String(__metidosStructuredDataOperation("toml.stringify", value));
    },
  }),
  html: Object.freeze({
    toMarkdown(htmlText) {
      return String(__metidosStructuredDataOperation("html.toMarkdown", String(htmlText)));
    },
    fromMarkdown(mdText) {
      return String(__metidosStructuredDataOperation("html.fromMarkdown", String(mdText)));
    },
  }),
  util: Object.freeze({
    atob(value) {
      return __metidosAtob(value);
    },
    btoa(value) {
      return __metidosBtoa(value);
    },
    decodeJwtExp(token) {
      const payload = __metidosJwtPayload(token);
      const exp = payload && typeof payload.exp === "number" ? payload.exp : null;
      return Number.isFinite(exp) ? exp * 1000 : null;
    },
  }),
  yaml: Object.freeze({
    parse(content) {
      return __metidosStructuredDataOperation("yaml.parse", String(content));
    },
    stringify(value) {
      return String(__metidosStructuredDataOperation("yaml.stringify", value));
    },
  }),
  xml: Object.freeze({
    encode(value) {
      return String(__metidosStructuredDataOperation("xml.encode", value));
    },
    parse(content, options = {}) {
      return __metidosStructuredDataOperation("xml.parse", { content: String(content), options });
    },
  }),
  sqlite(path) {
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("metidos.sqlite(path) requires a non-empty virtual path string.");
    }
    const virtualPath = String(path);
    const connection = Object.freeze({
      path: virtualPath,
      async all(statement, bindings) {
        const payload = await __metidosSqliteOperation("sqlite.all", { path: virtualPath, statement, bindings });
        return Object.freeze((payload.rows ?? []).map((row) => Object.freeze({ ...row })));
      },
      async get(statement, bindings) {
        const payload = await __metidosSqliteOperation("sqlite.get", { path: virtualPath, statement, bindings });
        return payload.row ? Object.freeze({ ...payload.row }) : null;
      },
      async query(statement, bindings) {
        return this.all(statement, bindings);
      },
      async run(statement, bindings) {
        return Object.freeze(await __metidosSqliteOperation("sqlite.run", { path: virtualPath, statement, bindings }));
      },
      async close() {
        return Object.freeze({ success: true });
      },
    });
    return connection;
  },
};
Object.defineProperty(globalThis, "metidos", {
  configurable: false,
  enumerable: false,
  value: Object.freeze(__metidosApi),
  writable: false,
});
${QUICKJS_FORBIDDEN_GLOBALS_SOURCE}
`;
}

export function pluginJavaScriptBootstrapSource(
  input: PluginRuntimeApiBootstrapOptions,
): string {
  return metidosPluginApiRuntimeSource(input);
}

export function pluginPythonBootstrapSource(
  input: PluginRuntimeApiBootstrapOptions & { pythonEntrypoint: string },
): string {
  return `${metidosPluginApiRuntimeSource(input)}\n${pythonEntrypointLoaderSource(input.pythonEntrypoint)}`;
}

function pythonEntrypointLoaderSource(pythonEntrypoint: string): string {
  return `
Object.defineProperty(globalThis, "__metidosPythonEntrypoint", {
  configurable: false,
  enumerable: false,
  value: ${jsonForPluginBootstrap(pythonEntrypoint)},
  writable: false,
});
`;
}

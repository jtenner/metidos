/**
 * @file src/bun/plugin/python-runtime.ts
 * @description Python plugin entrypoint source generation and Metidos API bridge bootstrap.
 */

import { loadPyodide, type PyodideInterface } from "pyodide";
import type { PluginCalendarEventsOperation } from "./calendar-events";
import type { PluginEntrypointBuildResult } from "./entrypoint-build";
import type { PluginLanceDbOperation } from "./lancedb";
import {
  executePluginHostCalendarEventsOperation,
  executePluginHostEmbeddingsOperation,
  executePluginHostFetchOperation,
  executePluginHostFsOperation,
  executePluginHostLanceDbOperation,
  executePluginHostLogOperation,
  executePluginHostNotificationSendOperation,
  executePluginHostSqliteOperation,
  executePluginHostTerminalOperation,
  executePluginHostWebSocketOperation,
} from "./host-capabilities";
import { executePluginStructuredDataOperation } from "./host-structured-data";
import { pluginPythonBootstrapSource } from "./plugin-api-runtime";
import type {
  PluginRuntimeCallbackInput,
  PluginRuntimeInstance,
  PluginRuntimeOptions,
} from "./plugin-runtime-contract";
import { DEFAULT_PLUGIN_QUICKJS_STARTUP_TIMEOUT_MS } from "./quickjs-runtime";
import type { PluginSqliteOperation } from "./sqlite";
import {
  PLUGIN_CRON_CREATE_PERMISSION,
  PLUGIN_MODEL_PROVIDER_PERMISSION,
  PLUGIN_OAUTH_PROVIDER_PERMISSION,
  PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS,
  PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS,
  PLUGIN_STARTUP_CRON_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT,
  PLUGIN_STARTUP_MODEL_PROVIDER_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_NOTIFICATION_PROVIDER_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_OAUTH_PROVIDER_REGISTRATION_LIMIT,
  PLUGIN_STARTUP_TOOL_REGISTRATION_LIMIT,
} from "./startup-registrations";
import type { PluginTerminalOperation } from "./terminal";

export type PluginPythonExecutionHost = {
  pyodide: PyodideInterface;
  runPythonAsync: (
    source: string,
    options?: { filename?: string },
  ) => Promise<unknown>;
};

type PythonCallback = (...args: unknown[]) => unknown;

type PythonRuntimePhase = "startup" | "callback";

type PythonStartupRegistrationState = {
  activeCallbackContext: unknown;
  activeCallbackDeadlineMs: number | null;
  callbackHandles: Map<string, PythonCallback>;
  crons: unknown[];
  modelProviders: unknown[];
  nextCallbackHandle: number;
  notificationProviders: unknown[];
  oauthProviders: unknown[];
  permissions: Set<string>;
  injections: unknown[];
  phase: PythonRuntimePhase;
  tools: unknown[];
};

export class PluginPythonRuntimeError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : options);
    this.name = "PluginPythonRuntimeError";
  }
}

function jsonForPythonRuntime(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replaceAll("<", "\\u003c");
}

export function pythonMetidosModuleSource(): string {
  return `
from js import metidos as _js_metidos

metidos = _js_metidos
fs = _js_metidos.fs
env = _js_metidos.env
settings = _js_metidos.settings
try:
    embeddings = _js_metidos.embeddings
except AttributeError:
    embeddings = None
try:
    lancedb = _js_metidos.lancedb
except AttributeError:
    lancedb = None
notifications = _js_metidos.notifications
calendar = _js_metidos.calendar
events = _js_metidos.events
terminal = _js_metidos.terminal
websocket = _js_metidos.websocket
providers = _js_metidos.providers
oauth = _js_metidos.oauth
toml = _js_metidos.toml
try:
    html = _js_metidos.html
except AttributeError:
    html = None
yaml = _js_metidos.yaml
xml = _js_metidos.xml
util = _js_metidos.util




def add_agent_tool(registration):
    return _js_metidos.addAgentTool(registration)


def add_injection(registration):
    return _js_metidos.addInjection(registration)


def cron(registration):
    return _js_metidos.cron(registration)


def fetch(url, options=None):
    return _js_metidos.fetch(url, options or {})


def log(level, message):
    return _js_metidos.log(level, message)


def sqlite(path):
    return _js_metidos.sqlite(path)


def register_oauth(registration):
    return _js_metidos.registerOAuth(registration)
`;
}

export function pythonPluginEntrypointSource(input: {
  callbackInvocationToken: string;
  entrypointPath: string;
  pluginApi?: Parameters<typeof pluginPythonBootstrapSource>[0]["pluginApi"];
  pythonSource: string;
}): string {
  return `${pluginPythonBootstrapSource({
    callbackInvocationToken: input.callbackInvocationToken,
    pythonEntrypoint: input.entrypointPath,
    ...(input.pluginApi === undefined ? {} : { pluginApi: input.pluginApi }),
  })}

const __metidosPythonModuleSource = ${jsonForPythonRuntime(pythonMetidosModuleSource())};
const __metidosPythonSource = ${jsonForPythonRuntime(input.pythonSource)};

export async function __metidosStartPythonPlugin() {
  // Runtime execution is wired through this single generated entrypoint so the
  // Python bridge and the JavaScript bootstrap cannot drift. The host runtime
  // installs __metidosPythonModuleSource as the Python metidos module before
  // evaluating __metidosPythonSource inside the safe Pyodide execution host.
  return { metidosModuleSource: __metidosPythonModuleSource, source: __metidosPythonSource };
}

export default __metidosStartPythonPlugin();
`;
}

function pyProxyToJs(value: unknown): unknown {
  if (value && typeof value === "object" && "toJs" in value) {
    return (value as { toJs: (options?: unknown) => unknown }).toJs({
      dict_converter: Object.fromEntries,
    });
  }
  return value;
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  const converted = pyProxyToJs(value);
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    throw new PluginPythonRuntimeError(`${path} must be an object.`);
  }
  return converted as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PluginPythonRuntimeError(
      `${path}.${key} must be a non-empty string.`,
    );
  }
  return value;
}

function timeoutField(record: Record<string, unknown>, path: string): number {
  const value = record.timeoutMs;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS ||
    value > PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS
  ) {
    throw new PluginPythonRuntimeError(
      `${path}.timeoutMs must be an integer between ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MIN_MS} and ${PLUGIN_STARTUP_CALLBACK_TIMEOUT_MAX_MS}.`,
    );
  }
  return value;
}

function optionalTimeoutField(
  record: Record<string, unknown>,
  path: string,
): number | undefined {
  if (record.timeoutMs === undefined || record.timeoutMs === null) {
    return undefined;
  }
  return timeoutField(record, path);
}

function optionalPositiveIntegerField(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new PluginPythonRuntimeError(
      `${path}.${key} must be a positive integer.`,
    );
  }
  return value;
}

function ensureRegistrationLimit(
  registrations: unknown[],
  limit: number,
  feature: string,
): void {
  if (registrations.length >= limit) {
    throw new PluginPythonRuntimeError(
      `${feature} supports at most ${limit} registrations per plugin.`,
    );
  }
}

function functionHandle(input: {
  key: string;
  path: string;
  prefix: string;
  record: Record<string, unknown>;
  state: PythonStartupRegistrationState;
}): string {
  const value = input.record[input.key];
  if (typeof value !== "function") {
    throw new PluginPythonRuntimeError(
      `${input.path}.${input.key} must be a function.`,
    );
  }
  const handle = `${input.prefix}:${input.key}:${input.state.nextCallbackHandle++}`;
  input.state.callbackHandles.set(handle, value as PythonCallback);
  return handle;
}

function requirePermission(
  state: PythonStartupRegistrationState,
  permission: string,
  feature: string,
): void {
  if (!state.permissions.has(permission)) {
    const error = new PluginPythonRuntimeError(
      `${feature} requires ${permission}.`,
    );
    error.name = "PluginPermissionError";
    throw error;
  }
}

function requireStartup(
  state: PythonStartupRegistrationState,
  feature: string,
): void {
  if (state.phase === "startup") {
    return;
  }
  throw new PluginPythonRuntimeError(
    `${feature} may only be registered during plugin startup.`,
  );
}

function createDeclaredValueBridge(
  valuesInput: Record<string, unknown> | (() => Record<string, unknown> | null),
  label: string,
): Record<string, unknown> {
  const values = () =>
    typeof valuesInput === "function" ? (valuesInput() ?? {}) : valuesInput;
  return Object.freeze({
    all() {
      return Object.freeze({ ...values() });
    },
    get(key: string) {
      const record = values();
      if (typeof key !== "string" || key.length === 0) {
        throw new PluginPythonRuntimeError(
          `Plugin ${label} key must be a non-empty string.`,
        );
      }
      if (!Object.hasOwn(record, key)) {
        throw new PluginPythonRuntimeError(
          `Plugin ${label} ${JSON.stringify(key)} is not declared.`,
        );
      }
      return record[key];
    },
    has(key: string) {
      return typeof key === "string" && Object.hasOwn(values(), key);
    },
  });
}

function envValuesForPluginApi(
  options: PluginRuntimeOptions,
): Record<string, string | null> {
  return Object.fromEntries(
    (options.pluginApi?.env ?? []).map((envVar) => [envVar.key, envVar.value]),
  );
}

function activeHostMetadata(state: PythonStartupRegistrationState) {
  return {
    context: state.activeCallbackContext ?? null,
    deadlineMs: state.activeCallbackDeadlineMs ?? null,
  };
}

function normalizeParams(params: unknown): Record<string, unknown> {
  const converted = pyProxyToJs(params);
  return converted && typeof converted === "object" && !Array.isArray(converted)
    ? (converted as Record<string, unknown>)
    : {};
}

function createPythonFetchResponse(payload: Record<string, unknown>) {
  let body = typeof payload.body === "string" ? payload.body : null;
  let bytes: Buffer | null = null;
  const status = typeof payload.status === "number" ? payload.status : 0;
  const getBytes = () => {
    if (bytes === null) {
      bytes =
        typeof payload.bodyBase64 === "string"
          ? Buffer.from(payload.bodyBase64, "base64")
          : Buffer.from(body ?? "");
    }
    return bytes;
  };
  const getBody = () => {
    if (body === null) {
      body = getBytes().toString();
    }
    return body;
  };
  return Object.freeze({
    async arrayBuffer() {
      const value = getBytes();
      return value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      );
    },
    headers: Object.freeze({
      ...((payload.headers as Record<string, unknown> | undefined) ?? {}),
    }),
    async json() {
      return JSON.parse(getBody());
    },
    ok: status >= 200 && status < 300,
    redirected: payload.redirected === true,
    status,
    statusText: String(payload.statusText ?? ""),
    async text() {
      return getBody();
    },
    url: String(payload.url ?? ""),
  });
}

function _createPythonWebSocketClient(input: {
  operation: (name: string, params?: unknown) => Promise<unknown>;
  result: Record<string, unknown>;
}) {
  const id = input.result.id;
  const url = String(input.result.url ?? "");
  return Object.freeze({
    async close(code?: number, reason?: string) {
      await input.operation("websocket.close", { code, id, reason });
    },
    async *events(options: unknown = {}) {
      while (true) {
        const event = Object.freeze(
          (await input.operation("websocket.receive", {
            id,
            options: pyProxyToJs(options),
          })) as Record<string, unknown>,
        );
        yield event;
        if (event.type === "close" || event.type === "error") {
          return;
        }
      }
    },
    id,
    async receive(options: unknown = {}) {
      return Object.freeze(
        (await input.operation("websocket.receive", {
          id,
          options: pyProxyToJs(options),
        })) as Record<string, unknown>,
      );
    },
    async sendText(text: unknown) {
      await input.operation("websocket.send", { id, text: String(text) });
    },
    async state() {
      const result = (await input.operation("websocket.state", {
        id,
      })) as Record<string, unknown>;
      return String(result.state ?? "");
    },
    url,
  });
}

function executeStructuredDataOperation(
  operation: unknown,
  payload: unknown,
): unknown {
  return executePluginStructuredDataOperation({
    createError: (message) => new PluginPythonRuntimeError(message),
    operation,
    payload,
  });
}

function createFsBridge(
  options: PluginRuntimeOptions,
  state: PythonStartupRegistrationState,
): Record<string, unknown> {
  const operation = async (name: string, params: Record<string, unknown>) =>
    await executePluginHostFsOperation({
      createError: (message) => new PluginPythonRuntimeError(message),
      metadata: activeHostMetadata(state),
      operation: name,
      params: normalizeParams(params),
      pluginApi: options.pluginApi,
    });
  return Object.freeze({
    exists(path: string) {
      return operation("fs.exists", { path });
    },
    glob(pattern: string) {
      return operation("fs.glob", { pattern });
    },
    ls(path: string) {
      return operation("fs.ls", { path });
    },
    mkdir(path: string, mkdirOptions: Record<string, unknown> = {}) {
      return operation("fs.mkdir", { options: mkdirOptions, path });
    },
    read(path: string) {
      return operation("fs.read", { path });
    },
    readText(path: string) {
      return operation("fs.readText", { path });
    },
    rm(path: string, rmOptions: Record<string, unknown> = {}) {
      return operation("fs.rm", { options: rmOptions, path });
    },
    stat(path: string) {
      return operation("fs.stat", { path });
    },
    write(path: string, bytes: unknown) {
      return operation("fs.write", { bytes, path });
    },
    writeText(path: string, contents: string) {
      return operation("fs.writeText", { contents, path });
    },
  });
}

function createCalendarBridge(
  options: PluginRuntimeOptions,
  state: PythonStartupRegistrationState,
): Record<string, unknown> {
  const operation = async (
    name: PluginCalendarEventsOperation,
    params: unknown = {},
  ) => {
    return await executePluginHostCalendarEventsOperation({
      createError: (message) => new PluginPythonRuntimeError(message),
      metadata: activeHostMetadata(state),
      operation: name,
      params: normalizeParams(params),
      pluginApi: options.pluginApi,
    });
  };
  return Object.freeze({
    create(params: unknown) {
      return operation("calendar.create", params);
    },
    delete(params: unknown) {
      return operation("calendar.delete", params);
    },
    list(params: unknown = {}) {
      return operation("calendar.list", params);
    },
    modify(params: unknown) {
      return operation("calendar.modify", params);
    },
  });
}

function createEventsBridge(
  options: PluginRuntimeOptions,
  state: PythonStartupRegistrationState,
): Record<string, unknown> {
  const operation = async (
    name: PluginCalendarEventsOperation,
    params: unknown = {},
  ) => {
    return await executePluginHostCalendarEventsOperation({
      createError: (message) => new PluginPythonRuntimeError(message),
      metadata: activeHostMetadata(state),
      operation: name,
      params: normalizeParams(params),
      pluginApi: options.pluginApi,
    });
  };
  return Object.freeze({
    create(params: unknown) {
      return operation("events.create", params);
    },
    delete(params: unknown) {
      return operation("events.delete", params);
    },
    get(params: unknown) {
      return operation("events.get", params);
    },
    list(params: unknown = {}) {
      return operation("events.list", params);
    },
    modify(params: unknown) {
      return operation("events.modify", params);
    },
  });
}

function createTerminalBridge(
  options: PluginRuntimeOptions,
  state: PythonStartupRegistrationState,
): Record<string, unknown> {
  const operation = async (
    name: PluginTerminalOperation,
    params: unknown = {},
  ) => {
    return await executePluginHostTerminalOperation({
      createError: (message) => new PluginPythonRuntimeError(message),
      metadata: activeHostMetadata(state),
      operation: name,
      params: normalizeParams(params),
      pluginApi: options.pluginApi,
    });
  };
  return Object.freeze({
    create(params: unknown = {}) {
      return operation("terminal.create", params);
    },
    grep(params: unknown) {
      return operation("terminal.grep", params);
    },
    kill(params: unknown) {
      return operation("terminal.kill", params);
    },
    read(params: unknown) {
      return operation("terminal.read", params);
    },
  });
}

function createLanceDbBridge(
  options: PluginRuntimeOptions,
  state: PythonStartupRegistrationState,
): Record<string, unknown> {
  return Object.freeze({
    async open(path: string) {
      if (typeof path !== "string" || path.length === 0) {
        throw new PluginPythonRuntimeError(
          "metidos.lancedb.open(path) requires a non-empty virtual path string.",
        );
      }
      const operation = async (
        name: PluginLanceDbOperation,
        params: Record<string, unknown>,
      ) => {
        return await executePluginHostLanceDbOperation({
          createError: (message) => new PluginPythonRuntimeError(message),
          metadata: activeHostMetadata(state),
          operation: name,
          params,
          pluginApi: options.pluginApi,
        });
      };
      return Object.freeze({
        path,
        query(vector: unknown, queryOptions: unknown = {}) {
          const record =
            queryOptions && typeof queryOptions === "object"
              ? (queryOptions as Record<string, unknown>)
              : {};
          return operation("lancedb.query", {
            limit: record.limit,
            path,
            vector: pyProxyToJs(vector),
          });
        },
        remove(id: unknown) {
          return operation("lancedb.delete", { id: pyProxyToJs(id), path });
        },
        upsert(rows: unknown) {
          const jsRows = pyProxyToJs(rows);
          return operation("lancedb.upsert", {
            path,
            rows: Array.isArray(jsRows) ? jsRows : [jsRows],
          });
        },
      });
    },
  });
}

function createEmbeddingsBridge(
  options: PluginRuntimeOptions,
  state: PythonStartupRegistrationState,
): Record<string, unknown> {
  return Object.freeze({
    async embed(input: unknown, payload: unknown = null) {
      return await executePluginHostEmbeddingsOperation({
        createError: (message) => new PluginPythonRuntimeError(message),
        metadata: activeHostMetadata(state),
        params: { input: pyProxyToJs(input), payload: pyProxyToJs(payload) },
        pluginApi: options.pluginApi,
      });
    },
  });
}

function createSqliteBridge(
  options: PluginRuntimeOptions,
  state: PythonStartupRegistrationState,
): (path: string) => Record<string, unknown> {
  return (path: string) => {
    if (typeof path !== "string" || path.length === 0) {
      throw new PluginPythonRuntimeError(
        "metidos.sqlite(path) requires a non-empty virtual path string.",
      );
    }
    const operation = async (
      name: PluginSqliteOperation,
      params: Record<string, unknown>,
    ) => {
      return await executePluginHostSqliteOperation({
        createError: (message) => new PluginPythonRuntimeError(message),
        metadata: activeHostMetadata(state),
        operation: name,
        params,
        pluginApi: options.pluginApi,
      });
    };
    return Object.freeze({
      all(statement: string, bindings?: unknown) {
        return operation("sqlite.all", {
          bindings: pyProxyToJs(bindings),
          path,
          statement,
        });
      },
      close() {
        return Object.freeze({ success: true });
      },
      get(statement: string, bindings?: unknown) {
        return operation("sqlite.get", {
          bindings: pyProxyToJs(bindings),
          path,
          statement,
        });
      },
      query(statement: string, bindings?: unknown) {
        return operation("sqlite.all", {
          bindings: pyProxyToJs(bindings),
          path,
          statement,
        });
      },
      run(statement: string, bindings?: unknown) {
        return operation("sqlite.run", {
          bindings: pyProxyToJs(bindings),
          path,
          statement,
        });
      },
      path,
    });
  };
}

function createPythonMetidosBridge(
  state: PythonStartupRegistrationState,
  options: PluginRuntimeOptions,
): Record<string, unknown> {
  const notifications = Object.freeze({
    addProvider(registration: unknown) {
      const path = "metidos.notifications.add_provider registration";
      requireStartup(state, "metidos.notifications.add_provider");
      requirePermission(
        state,
        "notification:provider",
        "metidos.notifications.add_provider",
      );
      ensureRegistrationLimit(
        state.notificationProviders,
        PLUGIN_STARTUP_NOTIFICATION_PROVIDER_REGISTRATION_LIMIT,
        "metidos.notifications.add_provider",
      );
      const record = assertRecord(registration, path);
      const normalized = Object.freeze({
        id: stringField(record, "id", path),
        sendHandle: functionHandle({
          key: "send",
          path,
          prefix: "notificationProvider",
          record,
          state,
        }),
        timeoutMs: timeoutField(record, path),
      });
      state.notificationProviders.push(normalized);
      return normalized;
    },
    registerProvider(registration: unknown) {
      return this.addProvider(registration);
    },
    async send(input: unknown) {
      return await executePluginHostNotificationSendOperation({
        createError: (message) => new PluginPythonRuntimeError(message),
        metadata: activeHostMetadata(state),
        pluginApi: options.pluginApi,
        request: pyProxyToJs(input),
      });
    },
  });

  const oauth = Object.freeze({
    registerProvider(registration: unknown) {
      const path = "metidos.oauth.register_provider registration";
      requireStartup(state, "metidos.oauth.register_provider");
      requirePermission(
        state,
        PLUGIN_OAUTH_PROVIDER_PERMISSION,
        "metidos.oauth.register_provider",
      );
      ensureRegistrationLimit(
        state.oauthProviders,
        PLUGIN_STARTUP_OAUTH_PROVIDER_REGISTRATION_LIMIT,
        "metidos.oauth.register_provider",
      );
      const record = assertRecord(registration, path);
      const importCredentialsHandle =
        typeof record.importCredentials === "function"
          ? functionHandle({
              key: "importCredentials",
              path,
              prefix: "oauth",
              record,
              state,
            })
          : undefined;
      const refreshHandle =
        typeof record.refresh === "function"
          ? functionHandle({
              key: "refresh",
              path,
              prefix: "oauth",
              record,
              state,
            })
          : undefined;
      if (!importCredentialsHandle && !refreshHandle) {
        throw new PluginPythonRuntimeError(
          `${path} must provide importCredentials or refresh.`,
        );
      }
      const normalized = Object.freeze({
        id: stringField(record, "id", path),
        ...(importCredentialsHandle ? { importCredentialsHandle } : {}),
        provider: stringField(record, "provider", path),
        ...(refreshHandle ? { refreshHandle } : {}),
        timeoutMs: timeoutField(record, path),
      });
      state.oauthProviders.push(normalized);
      return normalized;
    },
  });

  const providers = Object.freeze({
    addProvider(registration: unknown) {
      const path = "metidos.providers.add_provider registration";
      requireStartup(state, "metidos.providers.add_provider");
      requirePermission(
        state,
        PLUGIN_MODEL_PROVIDER_PERMISSION,
        "metidos.providers.add_provider",
      );
      ensureRegistrationLimit(
        state.modelProviders,
        PLUGIN_STARTUP_MODEL_PROVIDER_REGISTRATION_LIMIT,
        "metidos.providers.add_provider",
      );
      const record = assertRecord(registration, path);
      const getProviderConfigurations = record.getProviderConfigurations;
      if (
        typeof getProviderConfigurations !== "function" &&
        !Array.isArray(record.configurations)
      ) {
        throw new PluginPythonRuntimeError(
          `${path} must provide getProviderConfigurations or configurations.`,
        );
      }
      const configurations = Array.isArray(record.configurations)
        ? record.configurations.map((item, index) => ({
            ...assertRecord(item, `${path}.configurations[${index}]`),
          }))
        : [];
      if (
        configurations.length >
        PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT
      ) {
        throw new PluginPythonRuntimeError(
          `${path}.configurations supports at most ${PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT} configurations.`,
        );
      }
      const embedHandle =
        typeof record.embed === "function"
          ? functionHandle({
              key: "embed",
              path,
              prefix: "modelProvider",
              record,
              state,
            })
          : undefined;
      const executeHandle =
        typeof record.execute === "function"
          ? functionHandle({
              key: "execute",
              path,
              prefix: "modelProvider",
              record,
              state,
            })
          : undefined;
      const getProviderConfigurationsHandle =
        typeof getProviderConfigurations === "function"
          ? functionHandle({
              key: "getProviderConfigurations",
              path,
              prefix: "modelProvider",
              record,
              state,
            })
          : undefined;
      const timeoutMs = optionalTimeoutField(record, path);
      const refreshIntervalMs = optionalPositiveIntegerField(
        record,
        "refreshIntervalMs",
        path,
      );
      const normalized = Object.freeze({
        configurations,
        ...(embedHandle ? { embedHandle } : {}),
        ...(executeHandle ? { executeHandle } : {}),
        ...(getProviderConfigurationsHandle
          ? { getProviderConfigurationsHandle }
          : {}),
        id: stringField(record, "id", path),
        ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      state.modelProviders.push(normalized);
      return Object.freeze({
        id: normalized.id,
        ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    },
    registerProvider(registration: unknown) {
      return this.addProvider(registration);
    },
  });

  const bridge: Record<string, unknown> = {
    addInjection(registration: unknown) {
      const path = "metidos.add_injection registration";
      requireStartup(state, "metidos.add_injection");
      requirePermission(
        state,
        "metidos:prompt_inject",
        "metidos.add_injection",
      );
      ensureRegistrationLimit(state.injections, 25, "metidos.add_injection");
      const record = assertRecord(registration, path);
      const normalized = Object.freeze({
        inject: stringField(record, "inject", path),
        name: stringField(record, "name", path),
        promptHandle: functionHandle({
          key: "prompt",
          path,
          prefix: "injection",
          record,
          state,
        }),
        timeoutMs: timeoutField(record, path),
      });
      state.injections.push(normalized);
      return normalized;
    },
    addAgentTool(registration: unknown) {
      const path = "metidos.add_agent_tool registration";
      requireStartup(state, "metidos.add_agent_tool");
      ensureRegistrationLimit(
        state.tools,
        PLUGIN_STARTUP_TOOL_REGISTRATION_LIMIT,
        "metidos.add_agent_tool",
      );
      const record = assertRecord(registration, path);
      const normalized = Object.freeze({
        actionHandle: functionHandle({
          key: "action",
          path,
          prefix: "tool",
          record,
          state,
        }),
        description: stringField(record, "description", path),
        name: stringField(record, "name", path),
        timeoutMs: timeoutField(record, path),
        tool: stringField(record, "tool", path),
        validatePropsHandle: functionHandle({
          key: "validateProps",
          path,
          prefix: "tool",
          record,
          state,
        }),
      });
      state.tools.push(normalized);
      return normalized;
    },
    calendar: createCalendarBridge(options, state),
    cron(registration: unknown) {
      const path = "metidos.cron registration";
      requireStartup(state, "metidos.cron");
      requirePermission(state, PLUGIN_CRON_CREATE_PERMISSION, "metidos.cron");
      ensureRegistrationLimit(
        state.crons,
        PLUGIN_STARTUP_CRON_REGISTRATION_LIMIT,
        "metidos.cron",
      );
      const record = assertRecord(registration, path);
      const normalized = Object.freeze({
        actionHandle: functionHandle({
          key: "action",
          path,
          prefix: "cron",
          record,
          state,
        }),
        key: stringField(record, "key", path),
        schedule: stringField(record, "schedule", path),
        timeoutMs: timeoutField(record, path),
      });
      state.crons.push(normalized);
      return normalized;
    },
    embeddings: createEmbeddingsBridge(options, state),
    lancedb: createLanceDbBridge(options, state),
    env: createDeclaredValueBridge(envValuesForPluginApi(options), "env"),
    events: createEventsBridge(options, state),
    async fetch(url: string, fetchOptions: unknown = {}) {
      const payload = await executePluginHostFetchOperation({
        createError: (message) => new PluginPythonRuntimeError(message),
        metadata: activeHostMetadata(state),
        options: pyProxyToJs(fetchOptions),
        pluginApi: options.pluginApi,
        url,
      });
      return createPythonFetchResponse(payload as Record<string, unknown>);
    },
    fs: createFsBridge(options, state),
    settings: createDeclaredValueBridge(
      options.pluginApi?.settings?.values ?? {},
      "setting",
    ),
    async log(level: string, message: string) {
      return await executePluginHostLogOperation({
        createError: (message) => new PluginPythonRuntimeError(message),
        metadata: activeHostMetadata(state),
        params: { level: String(level), message: String(message) },
        pluginApi: options.pluginApi,
      });
    },
    notifications,
    oauth,
    providers,
    registerOAuth(registration: unknown) {
      return oauth.registerProvider(registration);
    },
    sqlite: createSqliteBridge(options, state),
    terminal: createTerminalBridge(options, state),
    toml: Object.freeze({
      parse(content: unknown) {
        return executeStructuredDataOperation("toml.parse", content);
      },
      stringify(value: unknown) {
        return String(
          executeStructuredDataOperation("toml.stringify", pyProxyToJs(value)),
        );
      },
    }),
    html: Object.freeze({
      fromMarkdown(mdText: unknown) {
        return String(
          executeStructuredDataOperation("html.fromMarkdown", mdText),
        );
      },
      toMarkdown(htmlText: unknown) {
        return String(
          executeStructuredDataOperation("html.toMarkdown", htmlText),
        );
      },
    }),
    util: Object.freeze({
      decodeJwtExp(token: unknown) {
        const parts = String(token).split(".");
        if (parts.length < 2 || !parts[1]) {
          return null;
        }
        try {
          const payload = JSON.parse(
            Buffer.from(parts[1], "base64url").toString("utf8"),
          );
          const exp = typeof payload.exp === "number" ? payload.exp : null;
          return Number.isFinite(exp) ? exp * 1000 : null;
        } catch {
          return null;
        }
      },
    }),
    xml: Object.freeze({
      encode(value: unknown) {
        return String(executeStructuredDataOperation("xml.encode", value));
      },
      parse(content: unknown, options: unknown = {}) {
        return executeStructuredDataOperation("xml.parse", {
          content,
          options: pyProxyToJs(options),
        });
      },
    }),
    websocket: Object.freeze({
      async connect(url: string, connectOptions: unknown = {}) {
        const operation = async (name: string, params: unknown = {}) =>
          await executePluginHostWebSocketOperation({
            createError: (message) => new PluginPythonRuntimeError(message),
            metadata: activeHostMetadata(state),
            operation: name,
            params: normalizeParams(params),
            pluginApi: options.pluginApi,
          });
        const result = await operation("websocket.connect", {
          options: pyProxyToJs(connectOptions),
          url: String(url),
        });
        return _createPythonWebSocketClient({
          operation,
          result: assertRecord(result, "metidos.websocket.connect result"),
        });
      },
      operation(operation: string, params: unknown = {}) {
        return executePluginHostWebSocketOperation({
          createError: (message) => new PluginPythonRuntimeError(message),
          metadata: activeHostMetadata(state),
          operation: String(operation),
          params: normalizeParams(params),
          pluginApi: options.pluginApi,
        });
      },
    }),
    yaml: Object.freeze({
      parse(content: unknown) {
        return executeStructuredDataOperation("yaml.parse", content);
      },
      stringify(value: unknown) {
        return String(
          executeStructuredDataOperation("yaml.stringify", pyProxyToJs(value)),
        );
      },
    }),
  };
  return Object.freeze(bridge);
}

async function withPythonRuntimeTimeout<T>(
  promise: Promise<T>,
  input: { deadlineMs: number; message: string },
): Promise<T> {
  const remainingMs = input.deadlineMs - Date.now();
  if (remainingMs <= 0) {
    throw new PluginPythonRuntimeError(input.message);
  }
  let timeoutHandle: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new PluginPythonRuntimeError(input.message));
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function errorSummary(error: unknown): string {
  return error instanceof Error
    ? (error.message.split("\n")[0] ?? error.message)
    : String(error);
}

async function assertPythonCodeFails(input: {
  code: string;
  label: string;
  pyodide: PyodideInterface;
}): Promise<void> {
  try {
    await input.pyodide.runPythonAsync(input.code);
  } catch {
    return;
  }
  throw new PluginPythonRuntimeError(
    `Python sandbox safety check failed: ${input.label} was accessible.`,
  );
}

export async function createPluginPythonExecutionHost(input: {
  metidos: Record<string, unknown>;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
}): Promise<PluginPythonExecutionHost> {
  const pyodide = await loadPyodide({
    fullStdLib: false,
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
    ...(input.stdout === undefined ? {} : { stdout: input.stdout }),
  });

  try {
    pyodide.unregisterJsModule("js");
  } catch (error) {
    throw new PluginPythonRuntimeError(
      `Python sandbox safety check failed: could not remove Pyodide's default js module (${errorSummary(error)}).`,
      { cause: error },
    );
  }
  pyodide.registerJsModule("js", { metidos: input.metidos });
  pyodide.runPython(
    `
import sys
import types
_metidos_module = types.ModuleType("metidos")
exec(${JSON.stringify(pythonMetidosModuleSource())}, _metidos_module.__dict__)
sys.modules["metidos"] = _metidos_module
del _metidos_module
`,
    { filename: "<metidos-python-bootstrap>" },
  );

  await assertPythonCodeFails({
    code: "from js import process",
    label: "host process global",
    pyodide,
  });
  await assertPythonCodeFails({
    code: "from js import Bun",
    label: "Bun host global",
    pyodide,
  });
  await assertPythonCodeFails({
    code: "from js import globalThis",
    label: "host globalThis",
    pyodide,
  });
  await assertPythonCodeFails({
    code: "open('/etc/passwd').read()",
    label: "host filesystem",
    pyodide,
  });

  return {
    pyodide,
    runPythonAsync(source, options = {}) {
      return pyodide.runPythonAsync(source, {
        filename: options.filename ?? "<metidos-python-plugin>",
      });
    },
  };
}

export async function startPluginPythonRuntime(
  buildResult: PluginEntrypointBuildResult,
  _options: PluginRuntimeOptions = {},
): Promise<PluginRuntimeInstance> {
  if (buildResult.language !== "python") {
    throw new PluginPythonRuntimeError(
      "Python runtime can only start Python plugin entrypoints.",
    );
  }
  if (buildResult.pythonSource === undefined) {
    throw new PluginPythonRuntimeError(
      "Python build result is missing original Python source.",
    );
  }

  const state: PythonStartupRegistrationState = {
    activeCallbackContext: null,
    activeCallbackDeadlineMs: null,
    callbackHandles: new Map(),
    crons: [],
    modelProviders: [],
    nextCallbackHandle: 1,
    notificationProviders: [],
    oauthProviders: [],
    permissions: new Set(_options.pluginApi?.permissions ?? []),
    phase: "startup",
    injections: [],
    tools: [],
  };
  const host = await createPluginPythonExecutionHost({
    metidos: createPythonMetidosBridge(state, _options),
  });
  const startupTimeoutMs =
    _options.startupTimeoutMs ?? DEFAULT_PLUGIN_QUICKJS_STARTUP_TIMEOUT_MS;
  await withPythonRuntimeTimeout(
    host.runPythonAsync(buildResult.pythonSource, {
      filename: buildResult.entrypointPath,
    }),
    {
      deadlineMs: Date.now() + startupTimeoutMs,
      message: `Plugin Python setup timed out after ${startupTimeoutMs} ms.`,
    },
  );
  state.phase = "callback";

  return {
    dispose() {
      state.callbackHandles.clear();
    },
    async invokeCallback(input: PluginRuntimeCallbackInput) {
      const callback = state.callbackHandles.get(input.handle);
      if (!callback) {
        throw new PluginPythonRuntimeError(
          `Plugin callback handle ${input.handle} is not registered.`,
        );
      }
      const pyArgs = input.args.map((arg) => host.pyodide.toPy(arg));
      const previousContext = state.activeCallbackContext;
      const previousDeadlineMs = state.activeCallbackDeadlineMs;
      const callbackContext = input.args[0] ?? null;
      state.activeCallbackContext = callbackContext;
      state.activeCallbackDeadlineMs = input.deadlineMs;
      try {
        return pyProxyToJs(
          await withPythonRuntimeTimeout(Promise.resolve(callback(...pyArgs)), {
            deadlineMs: input.deadlineMs,
            message: `${input.label} timed out.`,
          }),
        );
      } finally {
        state.activeCallbackContext = previousContext;
        state.activeCallbackDeadlineMs = previousDeadlineMs;
        for (const pyArg of pyArgs) {
          pyArg.destroy();
        }
      }
    },
    setupResult: Object.freeze({
      crons: state.crons.map((cron) => Object.freeze({ ...(cron as object) })),
      modelProviders: state.modelProviders.map((provider) =>
        Object.freeze({ ...(provider as object) }),
      ),
      notificationProviders: state.notificationProviders.map((provider) =>
        Object.freeze({ ...(provider as object) }),
      ),
      oauthProviders: state.oauthProviders.map((provider) =>
        Object.freeze({ ...(provider as object) }),
      ),
      injections: state.injections.map((injection) =>
        Object.freeze({ ...(injection as object) }),
      ),
      tools: state.tools.map((tool) => Object.freeze({ ...(tool as object) })),
    }),
  };
}

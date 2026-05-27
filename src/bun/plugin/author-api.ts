/**
 * @file src/bun/plugin/author-api.ts
 * @description Author-facing TypeScript contract for the Plugin System v1 API shim.
 */

export type MetidosPluginSettingValue =
  | boolean
  | number
  | string
  | Array<number | string>
  | null;

export type MetidosPluginSettingsApi = {
  all(): Readonly<Record<string, MetidosPluginSettingValue>>;
  get(key: string): MetidosPluginSettingValue;
  has(key: string): boolean;
};

export type MetidosPluginLogLevel = "debug" | "error" | "info" | "warn";

export type MetidosAgentToolContext = Readonly<Record<string, never>>;

export type MetidosPluginBytes = ArrayBuffer | Uint8Array;

export type MetidosFetchOptions = {
  body?: string | MetidosPluginBytes;
  headers?: Readonly<Record<string, string>>;
  method?: string;
};

export type MetidosFetchResponse = {
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: Readonly<Record<string, string>>;
  json(): Promise<unknown>;
  ok: boolean;
  redirected: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  url: string;
};

export type MetidosWebSocketConnectOptions = {
  headers?: Readonly<Record<string, string>>;
  protocols?: string | readonly string[];
  timeoutMs?: number;
};

export type MetidosWebSocketReceiveOptions = {
  timeoutMs?: number;
};

export type MetidosWebSocketReceiveEvent =
  | { readonly text: string; readonly type: "message" }
  | { readonly code: number; readonly reason: string; readonly type: "close" }
  | { readonly message: string; readonly type: "error" };

export type MetidosWebSocketClient = {
  readonly id: number;
  readonly url: string;
  close(code?: number, reason?: string): Promise<void>;
  events(
    options?: MetidosWebSocketReceiveOptions,
  ): AsyncIterable<MetidosWebSocketReceiveEvent>;
  receive(
    options?: MetidosWebSocketReceiveOptions,
  ): Promise<MetidosWebSocketReceiveEvent>;
  sendText(text: string): Promise<void>;
  state(): Promise<"closed" | "closing" | "connecting" | "open">;
};

export type MetidosWebSocketApi = {
  connect(
    url: string,
    options?: MetidosWebSocketConnectOptions,
  ): Promise<MetidosWebSocketClient>;
};

export type MetidosAgentToolTextResult = {
  text: string;
  type: "text";
};

export type MetidosAgentToolMarkdownResult = {
  markdown: string;
  type: "markdown";
};

export type MetidosAgentToolImageUrlResult = {
  alt?: string;
  type: "image:url";
  url: string;
};

export type MetidosAgentToolImageFileResult = {
  alt?: string;
  mimeType: `image/${string}`;
  path: string;
  type: "image:file";
};

export type MetidosAgentToolResult =
  | MetidosAgentToolImageFileResult
  | MetidosAgentToolImageUrlResult
  | MetidosAgentToolMarkdownResult
  | MetidosAgentToolTextResult;

export type MetidosAgentToolRegistration<
  Props = Record<string, unknown>,
  Result = MetidosAgentToolResult,
> = {
  action(
    context: MetidosAgentToolContext,
    props: Props,
  ): Promise<Result> | Result;
  description: string;
  name: string;
  timeoutMs: number;
  /** Plugin-local snake_case tool id; must not contain ':'. */
  tool: string;
  validateProps(input: unknown): Props;
};

export type MetidosInjectionContext = Readonly<{
  contextKind: "promptInjection";
  inject: string;
  ownerUserId?: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
}>;

export type MetidosInjectionRegistration = {
  /** Plugin-local snake_case injection id; must be declared in access[].injects[].name. */
  inject: string;
  name: string;
  prompt(
    context: MetidosInjectionContext,
    prompt: string,
  ): Promise<string> | string;
  timeoutMs: number;
};

export type MetidosInjectionHandle = {
  inject: string;
  name: string;
  promptHandle: string;
  timeoutMs: number;
};

export type MetidosAgentToolHandle = {
  actionHandle: string;
  description: string;
  name: string;
  timeoutMs: number;
  /** Plugin-local snake_case tool id; must not contain ':'. */
  tool: string;
  validatePropsHandle: string;
};

export type MetidosCronContext = Readonly<{
  contextKind: "cron";
  ownerUserId?: number;
  scheduledAt?: string;
  settings?: {
    values: Readonly<Record<string, MetidosPluginSettingValue>>;
  };
}>;

export type MetidosCronRegistration = {
  action(context: MetidosCronContext): Promise<unknown> | unknown;
  key: string;
  schedule: string;
  timeoutMs: number;
};

export type MetidosCronHandle = {
  actionHandle: string;
  key: string;
  schedule: string;
  timeoutMs: number;
};

export type MetidosGcContext = Readonly<{
  contextKind: "gc";
  reason?: "admin_action" | "quota_preflight";
  virtualRoot: "~/";
}>;

export type MetidosGcRegistration = {
  action(context: MetidosGcContext): Promise<unknown> | unknown;
  timeoutMs: number;
};

export type MetidosGcHandle = {
  actionHandle: string;
  timeoutMs: number;
};

export type MetidosProviderConfiguration = Readonly<
  Record<string, unknown> & {
    id?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    baseUrl?: string;
    label?: string;
    models?: readonly Record<string, unknown>[];
  }
>;

export type MetidosModelProviderExecutionContext = Readonly<{
  contextKind: "providerExecution";
  ownerUserId?: number | null;
  projectId?: number;
  threadId?: number;
  worktreePath?: string;
}>;

export type MetidosModelProviderExecutionRequest = Readonly<{
  configuration: MetidosProviderConfiguration;
  configurationId: string;
  model: Readonly<Record<string, unknown>>;
  modelContext: Readonly<Record<string, unknown>>;
  options?: Readonly<Record<string, unknown>>;
}>;

export type MetidosModelProviderEmbeddingRequest = Readonly<{
  configuration: MetidosProviderConfiguration;
  configurationId: string;
  input: MetidosEmbeddingInput;
  model: Readonly<Record<string, unknown>>;
  options?: unknown;
}>;

export type MetidosModelProviderEmbeddingResult =
  | readonly number[]
  | Readonly<{ embedding: readonly number[] }>;

export type MetidosModelProviderExecutionResult =
  | string
  | Readonly<{
      stopReason?: "stop" | "length" | "toolUse";
      text: string;
    }>;

export type MetidosModelProviderRegistration = {
  /**
   * Optional static configurations available immediately at startup. Dynamic
   * discovery belongs in getProviderConfigurations() and is invoked by the host
   * after startup, not during sidecar readiness.
   */
  configurations?: readonly MetidosProviderConfiguration[];
  embed?(
    context: MetidosModelProviderExecutionContext,
    request: MetidosModelProviderEmbeddingRequest,
  ):
    | Promise<MetidosModelProviderEmbeddingResult>
    | MetidosModelProviderEmbeddingResult;
  execute?(
    context: MetidosModelProviderExecutionContext,
    request: MetidosModelProviderExecutionRequest,
  ):
    | Promise<MetidosModelProviderExecutionResult>
    | MetidosModelProviderExecutionResult;
  getProviderConfigurations():
    | Promise<readonly MetidosProviderConfiguration[]>
    | readonly MetidosProviderConfiguration[];
  id: string;
  refreshIntervalMs?: number;
  timeoutMs: number;
};

export type MetidosModelProviderHandle = {
  id: string;
  refreshIntervalMs?: number;
  timeoutMs: number;
};

export type MetidosNotificationPriority =
  | "default"
  | "high"
  | "low"
  | "min"
  | "urgent";

export type MetidosNotificationSendInput = Readonly<
  Record<string, unknown> & {
    body?: unknown;
    clickUrl?: unknown;
    message?: string;
    priority?: MetidosNotificationPriority | string;
    tags?: readonly string[];
    title: string;
  }
>;

export type MetidosNotificationReceipt = Readonly<
  Record<string, unknown> & {
    code?: string;
    externalId?: string;
    externalUrl?: string;
    message: string;
    retryAfter?: number | string | null;
    status: "delivered" | "failed";
  }
>;

export type MetidosNotificationSendResult = Readonly<{
  receipts: readonly MetidosNotificationReceipt[];
}>;

export type MetidosNotificationProviderRegistration = {
  id: string;
  send(
    request: MetidosNotificationSendInput,
  ): Promise<MetidosNotificationSendResult> | MetidosNotificationSendResult;
  timeoutMs: number;
};

export type MetidosNotificationProviderHandle = {
  id: string;
  sendHandle: string;
  timeoutMs: number;
};

export type MetidosIngressImageAttachment = Readonly<{
  type: "image";
  data: string;
  mimeType: string;
}>;

export type MetidosIngressMessage = Readonly<{
  /** Provider-local immutable message/update id. Never a Metidos id. */
  id: string;
  /** Provider-local external user id. Never a Metidos user id. */
  user_id: string;
  /** Optional provider-local chat/thread/conversation id. Never a Metidos id. */
  conversation_id?: string;
  /** Plain-text external request body or caption. */
  message: string;
  /** Optional bounded image attachments to include with the thread turn. */
  images?: readonly MetidosIngressImageAttachment[];
}>;

export type MetidosIngressPollResult = Readonly<{
  messages: readonly MetidosIngressMessage[];
  cursor?: string;
}>;

export type MetidosIngressPollContext = Readonly<{
  cursor?: string;
  maxMessages: number;
  signal: AbortSignal;
}>;

export type MetidosIngressPromptTemplateContext = Readonly<{
  sourceId: string;
  sourceName: string;
  external_message_id: string;
  external_user_id: string;
  external_conversation_id?: string;
}>;

export type MetidosIngressResponseContext = Readonly<{
  external_message_id: string;
  external_user_id: string;
  external_conversation_id?: string;
}>;

export type MetidosIngressResponsePayload = Readonly<{
  /** Explicit short message to send to the original external context only. */
  message: string;
}>;

export type MetidosIngressSourceRegistration = {
  description?: string;
  id: string;
  name: string;
  poll(
    context: MetidosIngressPollContext,
  ): Promise<MetidosIngressPollResult> | MetidosIngressPollResult;
  /** Synchronous, bounded, untrusted source guidance rendered in a host envelope. */
  promptTemplate(context: MetidosIngressPromptTemplateContext): string;
  respond?(
    context: MetidosIngressResponseContext,
    payload: MetidosIngressResponsePayload,
  ): Promise<void> | void;
  supportsReplyToSource?: boolean;
  pollIntervalMs?: number;
  timeoutMs: number;
};

export type MetidosIngressSourceHandle = {
  id: string;
  pollHandle: string;
  promptTemplateHandle: string;
  respondHandle?: string;
  supportsReplyToSource: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
};

export type MetidosOAuthCredential = Readonly<
  Record<string, unknown> & {
    access: string;
    expires: number;
    refresh?: string;
    type?: "oauth";
  }
>;

export type MetidosOAuthProviderContext = Readonly<{
  contextKind: "oauthProvider";
  ownerUserId?: number | null;
  settings?: {
    values: Readonly<Record<string, MetidosPluginSettingValue>>;
  };
}>;

export type MetidosOAuthProviderRegistration = {
  id: string;
  importCredentials?(
    context: MetidosOAuthProviderContext,
  ): Promise<MetidosOAuthCredential | null> | MetidosOAuthCredential | null;
  label?: string;
  provider: string;
  refresh?(
    credentials: MetidosOAuthCredential,
  ): Promise<MetidosOAuthCredential> | MetidosOAuthCredential;
  timeoutMs: number;
};

export type MetidosOAuthProviderHandle = {
  id: string;
  importCredentialsHandle?: string;
  provider: string;
  refreshHandle?: string;
  timeoutMs: number;
};

export type MetidosCalendarListParams = {
  includeExternal?: boolean | null;
};

export type MetidosCalendar = Readonly<Record<string, unknown>>;
export type MetidosCalendarEvent = Readonly<Record<string, unknown>>;
export type MetidosCalendarOccurrence = Readonly<Record<string, unknown>>;

export type MetidosCalendarCreateParams = Readonly<Record<string, unknown>>;
export type MetidosCalendarModifyParams = Readonly<
  Record<string, unknown> & { calendarId?: number; id?: number }
>;
export type MetidosCalendarDeleteParams = Readonly<{
  calendarId?: number;
  confirmation?: boolean;
  confirmed?: boolean;
  id?: number;
}>;

export type MetidosEventListParams = Readonly<{
  end: string;
  start: string;
  timezone?: string | null;
}>;
export type MetidosEventGetParams = Readonly<{ eventId?: number; id?: number }>;
export type MetidosEventCreateParams = Readonly<Record<string, unknown>>;
export type MetidosEventModifyParams = Readonly<
  Record<string, unknown> & { eventId?: number; id?: number }
>;
export type MetidosEventDeleteParams = Readonly<
  Record<string, unknown> & {
    confirmation?: boolean;
    confirmed?: boolean;
    eventId?: number;
    id?: number;
  }
>;

export type MetidosTerminalCreateParams = Readonly<{
  command?: string | null;
  dir?: string | null;
  title?: string | null;
}>;

export type MetidosTerminalReadParams = Readonly<{
  lineCount?: number;
  lineOffset?: number;
  terminalIndex: number;
}>;

export type MetidosTerminalGrepParams = Readonly<{
  ignoreCase?: boolean;
  maxMatches?: number;
  pattern: string;
  terminalIndex: number;
}>;

export type MetidosTerminalKillParams = Readonly<{
  terminalIndex: number;
}>;

export type MetidosTerminal = Readonly<Record<string, unknown>>;

export type MetidosSqliteBindingValue = boolean | null | number | string;

export type MetidosSqliteBindings =
  | readonly MetidosSqliteBindingValue[]
  | Readonly<Record<string, MetidosSqliteBindingValue>>;

export type MetidosSqliteRow = Readonly<Record<string, unknown>>;

export type MetidosSqliteRunResult = Readonly<{
  changes: number;
  lastInsertRowid: number | string;
}>;

export type MetidosSqliteConnection = Readonly<{
  all(
    statement: string,
    bindings?: MetidosSqliteBindings,
  ): Promise<readonly MetidosSqliteRow[]>;
  close(): Promise<{ success: true }>;
  get(
    statement: string,
    bindings?: MetidosSqliteBindings,
  ): Promise<MetidosSqliteRow | null>;
  path: string;
  query(
    statement: string,
    bindings?: MetidosSqliteBindings,
  ): Promise<readonly MetidosSqliteRow[]>;
  run(
    statement: string,
    bindings?: MetidosSqliteBindings,
  ): Promise<MetidosSqliteRunResult>;
}>;

export type MetidosPluginFileStat = Readonly<
  Record<string, unknown> & {
    isDirectory?: boolean;
    isFile?: boolean;
    path?: string;
    size?: number;
  }
>;

export type MetidosEmbeddingInput =
  | string
  | number[]
  | Uint8Array
  | ArrayBuffer;

export type MetidosPluginEmbeddingsApi = {
  embed(
    input: MetidosEmbeddingInput,
    payload?: unknown,
  ): Promise<readonly number[]>;
};

export type MetidosLanceDbRecord = Readonly<
  Record<string, unknown> & {
    id?: number | string;
    vector: readonly number[];
  }
>;

export type MetidosLanceDbQueryResult = Readonly<{
  id: number | string;
  props: Readonly<Record<string, unknown>>;
  score: number;
}>;

export type MetidosXmlElement = Readonly<{
  attributes: Readonly<Record<string, string>>;
  children: readonly MetidosXmlElement[];
  name: string;
  text: string;
  type: "element";
}>;

export type MetidosXmlParseOptions = Readonly<{
  loose?: boolean;
  lowercaseNames?: boolean;
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxTextChars?: number;
  trimText?: boolean;
}>;

export type MetidosLanceDbConnection = Readonly<{
  path: string;
  query(
    vector: readonly number[],
    options?: { limit?: number },
  ): Promise<readonly MetidosLanceDbQueryResult[]>;
  remove(
    id: number | string,
  ): Promise<{ deleted: boolean; id: number | string }>;
  upsert(
    rows: MetidosLanceDbRecord | readonly MetidosLanceDbRecord[],
  ): Promise<{ count: number; ids: readonly (number | string)[] }>;
}>;

export type MetidosPluginLanceDbApi = {
  open(path: string): Promise<MetidosLanceDbConnection>;
};

export type MetidosPluginFsApi = {
  copy(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  glob(pattern: string): Promise<readonly string[]>;
  ls(path: string): Promise<readonly string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  move(from: string, to: string): Promise<void>;
  read(path: string): Promise<MetidosPluginBytes>;
  readText(path: string): Promise<string>;
  rm(
    path: string,
    options?: { force?: boolean; recursive?: boolean },
  ): Promise<void>;
  stat(path: string): Promise<MetidosPluginFileStat>;
  write(path: string, bytes: MetidosPluginBytes): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
};

export type MetidosPluginApi = {
  calendar: {
    create(params: MetidosCalendarCreateParams): Promise<MetidosCalendar>;
    delete(
      params: MetidosCalendarDeleteParams,
    ): Promise<{ calendarId: number; success: boolean }>;
    list(
      params?: MetidosCalendarListParams,
    ): Promise<readonly MetidosCalendar[]>;
    modify(params: MetidosCalendarModifyParams): Promise<MetidosCalendar>;
  };
  events: {
    create(params: MetidosEventCreateParams): Promise<MetidosCalendarEvent>;
    delete(
      params: MetidosEventDeleteParams,
    ): Promise<{ eventId: number; success: boolean }>;
    get(params: MetidosEventGetParams): Promise<MetidosCalendarEvent | null>;
    list(
      params: MetidosEventListParams,
    ): Promise<readonly MetidosCalendarOccurrence[]>;
    modify(params: MetidosEventModifyParams): Promise<MetidosCalendarEvent>;
  };
  terminal: {
    create(params?: MetidosTerminalCreateParams): Promise<MetidosTerminal>;
    grep(params: MetidosTerminalGrepParams): Promise<string>;
    kill(
      params: MetidosTerminalKillParams,
    ): Promise<{ success: boolean; terminalIndex: number }>;
    read(params: MetidosTerminalReadParams): Promise<string>;
  };
  fetch(
    url: string,
    options?: MetidosFetchOptions,
  ): Promise<MetidosFetchResponse>;
  embeddings: MetidosPluginEmbeddingsApi;
  lancedb: MetidosPluginLanceDbApi;
  websocket: MetidosWebSocketApi;
  fs: MetidosPluginFsApi;
  log(level: MetidosPluginLogLevel, message: string): Promise<void>;
  sqlite(path: string): MetidosSqliteConnection;
  addAgentTool<Props = Record<string, unknown>, Result = unknown>(
    registration: MetidosAgentToolRegistration<Props, Result>,
  ): MetidosAgentToolHandle;
  addInjection(
    registration: MetidosInjectionRegistration,
  ): MetidosInjectionHandle;
  cron(registration: MetidosCronRegistration): MetidosCronHandle;
  gc(registration: MetidosGcRegistration): MetidosGcHandle;
  env: {
    get(key: string): string | null;
  };
  settings: MetidosPluginSettingsApi;
  registerOAuth(
    registration: MetidosOAuthProviderRegistration,
  ): MetidosOAuthProviderHandle;
  providers: {
    addProvider(
      registration: MetidosModelProviderRegistration,
    ): MetidosModelProviderHandle;
    registerProvider(
      registration: MetidosModelProviderRegistration,
    ): MetidosModelProviderHandle;
  };
  oauth: {
    registerProvider(
      registration: MetidosOAuthProviderRegistration,
    ): MetidosOAuthProviderHandle;
  };
  notifications: {
    addProvider(
      registration: MetidosNotificationProviderRegistration,
    ): MetidosNotificationProviderHandle;
    registerProvider(
      registration: MetidosNotificationProviderRegistration,
    ): MetidosNotificationProviderHandle;
    send(
      input: MetidosNotificationSendInput,
    ): Promise<MetidosNotificationSendResult>;
  };
  ingress: {
    addSource(
      registration: MetidosIngressSourceRegistration,
    ): MetidosIngressSourceHandle;
    registerSource(
      registration: MetidosIngressSourceRegistration,
    ): MetidosIngressSourceHandle;
  };
  toml: {
    parse(content: string): unknown;
    stringify(value: unknown): string;
  };
  html: {
    fromMarkdown(mdText: string): string;
    toMarkdown(htmlText: string): string;
  };
  util: {
    atob(value: string): string;
    btoa(value: string): string;
    decodeJwtExp(token: string): number | null;
  };
  yaml: {
    parse(content: string): unknown;
    stringify(value: unknown): string;
  };
  xml: {
    encode(value: unknown): string;
    parse(content: string, options?: MetidosXmlParseOptions): MetidosXmlElement;
  };
};

export type MetidosPluginSetup = (
  metidos: MetidosPluginApi,
) =>
  | Promise<MetidosPluginSetupResult | undefined>
  | MetidosPluginSetupResult
  | undefined;

export type MetidosPluginSetupResult = {
  crons?: MetidosCronHandle[];
  gc?: MetidosGcHandle;
  modelProviders?: Array<
    MetidosModelProviderHandle & {
      configurations: readonly MetidosProviderConfiguration[];
    }
  >;
  ingressSources?: MetidosIngressSourceHandle[];
  oauthProviders?: MetidosOAuthProviderHandle[];
  tools: MetidosAgentToolHandle[];
};

export const metidos = (globalThis as { metidos?: MetidosPluginApi })
  .metidos as MetidosPluginApi;

export function atob(value: string): string {
  return globalThis.atob(value);
}

export function btoa(value: string): string {
  return globalThis.btoa(value);
}

export function definePlugin(
  setup: MetidosPluginSetup,
): MetidosPluginSetupResult | Promise<MetidosPluginSetupResult>;

export function definePlugin<TApi>(
  setup: (
    metidos: TApi,
  ) =>
    | Promise<MetidosPluginSetupResult | undefined>
    | MetidosPluginSetupResult
    | undefined,
): MetidosPluginSetupResult | Promise<MetidosPluginSetupResult>;

export function definePlugin<TDefinition extends Record<string, unknown>>(
  definition: TDefinition,
): TDefinition;

export function definePlugin(definition: unknown): unknown {
  const runtimeApi = (globalThis as { metidos?: MetidosPluginApi }).metidos;
  if (typeof definition === "function" && runtimeApi) {
    return (definition as (api: MetidosPluginApi) => unknown)(runtimeApi);
  }
  return definition;
}

const pluginApiModule: {
  atob: typeof atob;
  btoa: typeof btoa;
  definePlugin: typeof definePlugin;
  metidos: MetidosPluginApi;
} = {
  atob,
  btoa,
  definePlugin,
  metidos,
};
export default pluginApiModule;

/**
 * @file src/bun/pi-runtime-probe.ts
 *
 * Runtime probe for evaluating Pi integration paths from Jolt's Bun backend.
 * It exercises:
 * - direct Bun SDK embedding
 * - persistent session resume
 * - streaming + abort behavior
 * - provider auth resolution
 * - a Node subprocess fallback using Pi RPC mode
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import {
  type AgentSession,
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSession,
  createExtensionRuntime,
  type ExtensionRuntime,
  ModelRegistry,
  type ProviderConfig,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

export const PI_RUNTIME_PROBE_PROVIDER = "jolt-pi-probe";
export const PI_RUNTIME_PROBE_MODEL_ID = "probe-1";
export const PI_RUNTIME_PROBE_API_KEY_ENV = "JOLT_PI_PROBE_API_KEY";
export const PI_RUNTIME_PROBE_RUNTIME_API_KEY = "sdk-probe-key";
export const PI_RUNTIME_PROBE_RPC_API_KEY = "rpc-probe-key";

const PI_RUNTIME_PROBE_API = "anthropic-messages";
const PI_RUNTIME_PROBE_THINKING_LEVEL = "off";
const PI_RUNTIME_PROBE_REPLY_PREFIX = "pi-runtime-probe";
const DEFAULT_CHUNK_DELAY_MS = 25;
const DEFAULT_ABORT_TIMEOUT_MS = 4_000;
const DEFAULT_RPC_TIMEOUT_MS = 8_000;

interface ProbeProviderOptions {
  chunkDelayMs?: number;
}

interface BaseProbeResult {
  streamedText: string;
  apiKeySeen: string | undefined;
  authorizationHeaderSeen: string | undefined;
}

export interface BunSdkProbeResult extends BaseProbeResult {
  runtime: "bun-sdk";
  sessionId: string;
  sessionFile: string | undefined;
  resumedSessionId: string;
  resumedMessageCount: number;
  abortStopReason: string | undefined;
}

export interface RpcProbeResult extends BaseProbeResult {
  runtime: "node-rpc";
  initialSessionId: string | undefined;
  initialSessionFile: string | undefined;
  abortStopReason: string | undefined;
}

interface ProbeMessageUpdateEvent {
  type: "message_update";
  assistantMessageEvent?: {
    type: string;
    delta?: string;
  };
}

interface ProbeMessageEndEvent {
  type: "message_end";
  message?: {
    role?: string;
    stopReason?: string;
  };
}

interface ProbeResponse {
  type: "response";
  id?: string;
  command?: string;
  success?: boolean;
  error?: string;
  data?: {
    sessionId?: string;
    sessionFile?: string;
    model?: {
      provider?: string;
      id?: string;
    } | null;
  };
}

type ProbeRpcEvent =
  | ProbeMessageUpdateEvent
  | ProbeMessageEndEvent
  | ProbeResponse
  | { type: string; [key: string]: unknown };

function createMinimalExtensionRuntime(): ExtensionRuntime {
  return createExtensionRuntime();
}

function createProbeResourceLoader() {
  const runtime = createMinimalExtensionRuntime();
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "You are a minimal probe assistant. Reply plainly.",
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(new Error("aborted"));
      return;
    }
    const timeout = setTimeout(() => {
      cleanup();
      resolvePromise();
    }, ms);
    const onAbort = () => {
      cleanup();
      rejectPromise(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function cloneMessage(message: AssistantMessage): AssistantMessage {
  return structuredClone(message);
}

function chunkText(text: string): string[] {
  if (text.length === 0) {
    return [""];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += 8) {
    chunks.push(text.slice(index, index + 8));
  }
  return chunks;
}

function buildAssistantMessage(model: Model<string>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function extractLastUserText(context: Context): string {
  const lastUserMessage = [...context.messages]
    .reverse()
    .find((message) => message.role === "user");
  if (!lastUserMessage || typeof lastUserMessage.content === "string") {
    return typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : "no-user-message";
  }

  const textParts = lastUserMessage.content
    .filter((content) => content.type === "text")
    .map((content) => content.text.trim())
    .filter(Boolean);

  return textParts.join(" ") || "empty-user-message";
}

function createProbeReply(
  model: Model<string>,
  context: Context,
  options?: SimpleStreamOptions,
): string {
  const apiKey = options?.apiKey ?? "missing";
  const authorization = options?.headers?.Authorization ?? "missing";
  const lastUserText = extractLastUserText(context);
  return `${PI_RUNTIME_PROBE_REPLY_PREFIX} provider=${model.provider} model=${model.id} apiKey=${apiKey} auth=${authorization} prompt=${lastUserText}`;
}

export function createPiRuntimeProbeProviderConfig(
  options: ProbeProviderOptions = {},
): ProviderConfig {
  const chunkDelayMs = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;

  return {
    baseUrl: "https://pi-runtime-probe.invalid",
    apiKey: PI_RUNTIME_PROBE_API_KEY_ENV,
    authHeader: true,
    api: PI_RUNTIME_PROBE_API,
    models: [
      {
        id: PI_RUNTIME_PROBE_MODEL_ID,
        name: "Jolt Pi Runtime Probe",
        api: PI_RUNTIME_PROBE_API,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 1_024,
      },
    ],
    streamSimple(model, context, streamOptions) {
      const stream = createAssistantMessageEventStream();
      const output = buildAssistantMessage(model);
      const reply = createProbeReply(model, context, streamOptions);

      void (async () => {
        output.content.push({ type: "text", text: "" });
        stream.push({ type: "start", partial: cloneMessage(output) });
        stream.push({
          type: "text_start",
          contentIndex: 0,
          partial: cloneMessage(output),
        });

        for (const chunk of chunkText(reply)) {
          await sleep(chunkDelayMs, streamOptions?.signal);
          const firstContent = output.content[0];
          if (firstContent?.type !== "text") {
            throw new Error("probe stream lost text content block");
          }
          firstContent.text += chunk;
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: chunk,
            partial: cloneMessage(output),
          });
        }

        stream.push({
          type: "text_end",
          contentIndex: 0,
          content: reply,
          partial: cloneMessage(output),
        });
        stream.push({
          type: "done",
          reason: "stop",
          message: cloneMessage(output),
        });
        stream.end();
      })().catch((error) => {
        output.stopReason = streamOptions?.signal?.aborted
          ? "aborted"
          : "error";
        output.errorMessage = streamOptions?.signal?.aborted
          ? "Request was aborted."
          : error instanceof Error
            ? error.message
            : String(error);
        stream.push({
          type: "error",
          reason: output.stopReason === "aborted" ? "aborted" : "error",
          error: cloneMessage(output),
        });
        stream.end();
      });

      return stream as AssistantMessageEventStream;
    },
  };
}

function createProbeModelRegistry(chunkDelayMs?: number) {
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(
    PI_RUNTIME_PROBE_PROVIDER,
    createPiRuntimeProbeProviderConfig(
      chunkDelayMs === undefined ? {} : { chunkDelayMs },
    ),
  );
  const model = modelRegistry.find(
    PI_RUNTIME_PROBE_PROVIDER,
    PI_RUNTIME_PROBE_MODEL_ID,
  );
  if (!model) {
    throw new Error("Pi runtime probe model registration failed.");
  }
  return { authStorage, modelRegistry, model };
}

function createProbeSettingsManager() {
  return SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false, maxRetries: 0 },
  });
}

interface ProbeSessionInput {
  cwd: string;
  sessionManager: SessionManager;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<string>;
}

function createSessionOptions(
  input: ProbeSessionInput,
): CreateAgentSessionOptions {
  return {
    cwd: input.cwd,
    agentDir: join(input.cwd, ".pi-runtime-probe-agent"),
    model: input.model,
    thinkingLevel: PI_RUNTIME_PROBE_THINKING_LEVEL,
    authStorage: input.authStorage,
    modelRegistry: input.modelRegistry,
    resourceLoader: createProbeResourceLoader(),
    tools: [],
    sessionManager: input.sessionManager,
    settingsManager: createProbeSettingsManager(),
  };
}

function collectTextDeltas(session: AgentSession, onFirstDelta?: () => void) {
  let streamedText = "";
  let firstDeltaSeen = false;
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type !== "message_update" ||
      event.assistantMessageEvent.type !== "text_delta"
    ) {
      return;
    }
    streamedText += event.assistantMessageEvent.delta;
    if (!firstDeltaSeen) {
      firstDeltaSeen = true;
      onFirstDelta?.();
    }
  });
  return {
    getText: () => streamedText,
    unsubscribe,
  };
}

function extractAssistantStopReason(session: AgentSession): string | undefined {
  const lastAssistantMessage = [...session.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  return lastAssistantMessage?.stopReason;
}

async function runAbortPrompt(
  session: AgentSession,
  prompt: string,
): Promise<string | undefined> {
  const deltas = collectTextDeltas(session, () => {
    void session.abort();
  });

  try {
    await session.prompt(prompt);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.toLowerCase().includes("abort")
    ) {
      throw error;
    }
  } finally {
    deltas.unsubscribe();
  }

  return extractAssistantStopReason(session);
}

export async function runPiBunSdkProbe(
  workspaceDir: string,
): Promise<BunSdkProbeResult> {
  mkdirSync(workspaceDir, { recursive: true });
  const sessionDir = join(workspaceDir, ".pi-runtime-probe-sessions");

  const { authStorage, modelRegistry, model } = createProbeModelRegistry();
  authStorage.setRuntimeApiKey(
    PI_RUNTIME_PROBE_PROVIDER,
    PI_RUNTIME_PROBE_RUNTIME_API_KEY,
  );

  const sessionManager = SessionManager.create(workspaceDir, sessionDir);
  const { session } = await createAgentSession(
    createSessionOptions({
      cwd: workspaceDir,
      sessionManager,
      authStorage,
      modelRegistry,
      model,
    }),
  );

  const initialDeltas = collectTextDeltas(session);
  await session.prompt("stream and persist");
  initialDeltas.unsubscribe();

  const streamedText = initialDeltas.getText();
  const apiKeySeen = await modelRegistry.getApiKeyForProvider(
    PI_RUNTIME_PROBE_PROVIDER,
  );
  const authResult = await modelRegistry.getApiKeyAndHeaders(model);
  if (!authResult.ok) {
    throw new Error(
      `Pi runtime probe auth resolution failed: ${authResult.error}`,
    );
  }

  const sessionFile = session.sessionFile;
  const sessionId = session.sessionId;
  session.dispose();

  if (!sessionFile) {
    throw new Error("Pi runtime probe expected a persistent session file.");
  }

  const reopened = await createAgentSession(
    createSessionOptions({
      cwd: workspaceDir,
      sessionManager: SessionManager.open(sessionFile, sessionDir),
      authStorage,
      modelRegistry,
      model,
    }),
  );
  const resumedSessionId = reopened.session.sessionId;
  const resumedMessageCount = reopened.session.messages.length;
  reopened.session.dispose();

  const abortRun = await createAgentSession(
    createSessionOptions({
      cwd: workspaceDir,
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      model,
    }),
  );
  const abortStopReason = await runAbortPrompt(
    abortRun.session,
    "abort mid-stream",
  );
  abortRun.session.dispose();

  return {
    runtime: "bun-sdk",
    streamedText,
    apiKeySeen,
    authorizationHeaderSeen: authResult.headers?.Authorization,
    sessionId,
    sessionFile,
    resumedSessionId,
    resumedMessageCount,
    abortStopReason,
  };
}

function resolvePiCliPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const rootDir = resolve(dirname(currentFile), "../..");
  return join(
    rootDir,
    "node_modules",
    "@mariozechner",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
}

function resolveRpcProbeExtensionPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), "pi-rpc-probe-extension.ts");
}

class RpcProbeClient {
  private readonly pendingResponses = new Map<
    string,
    (event: ProbeResponse) => void
  >();
  private readonly eventListeners = new Set<(event: ProbeRpcEvent) => void>();
  private readonly stderrChunks: string[] = [];
  private stdoutBuffer = "";
  private nextId = 0;

  constructor(private readonly child: ReturnType<typeof spawn>) {
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onStdoutChunk(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
    });
  }

  private onStdoutChunk(chunk: string) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const rawLine = this.stdoutBuffer
        .slice(0, newlineIndex)
        .replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!rawLine.trim()) {
        continue;
      }
      const parsed = JSON.parse(rawLine) as ProbeRpcEvent;
      if (isProbeResponse(parsed) && typeof parsed.id === "string") {
        const resolver = this.pendingResponses.get(parsed.id);
        if (resolver) {
          this.pendingResponses.delete(parsed.id);
          resolver(parsed);
          continue;
        }
      }
      for (const listener of this.eventListeners) {
        listener(parsed);
      }
    }
  }

  sendCommand(command: Record<string, unknown>): Promise<ProbeResponse> {
    const id = `probe-${++this.nextId}`;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pendingResponses.set(id, (response) => {
        if (response.success === false) {
          rejectPromise(
            new Error(
              response.error ??
                `RPC command failed: ${response.command ?? "unknown"}`,
            ),
          );
          return;
        }
        resolvePromise(response);
      });

      this.child.stdin?.write(
        `${JSON.stringify({ ...command, id })}\n`,
        (error) => {
          if (error) {
            this.pendingResponses.delete(id);
            rejectPromise(error);
          }
        },
      );
    });
  }

  waitForEvent<TEvent extends ProbeRpcEvent>(
    predicate: (event: ProbeRpcEvent) => event is TEvent,
    timeoutMs: number,
  ): Promise<TEvent> {
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        cleanup();
        rejectPromise(
          new Error(
            `Timed out waiting for RPC event. stderr=${this.stderrChunks.join("")}`,
          ),
        );
      }, timeoutMs);

      const listener = (event: ProbeRpcEvent) => {
        if (!predicate(event)) {
          return;
        }
        cleanup();
        resolvePromise(event);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.eventListeners.delete(listener);
      };

      this.eventListeners.add(listener);
    });
  }

  subscribe(listener: (event: ProbeRpcEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    this.child.stdin?.end();
    if (this.child.exitCode !== null) {
      return;
    }
    this.child.kill("SIGTERM");
    await new Promise<void>((resolvePromise) => {
      this.child.once("exit", () => resolvePromise());
      setTimeout(() => {
        if (this.child.exitCode === null) {
          this.child.kill("SIGKILL");
        }
        resolvePromise();
      }, 1_000);
    });
  }
}

function isProbeResponse(event: ProbeRpcEvent): event is ProbeResponse {
  return event.type === "response";
}

function isMessageUpdateEvent(
  event: ProbeRpcEvent,
): event is ProbeMessageUpdateEvent {
  return event.type === "message_update";
}

function isMessageEndEvent(
  event: ProbeRpcEvent,
): event is ProbeMessageEndEvent {
  return event.type === "message_end";
}

export async function runPiRpcProbe(
  workspaceDir: string,
): Promise<RpcProbeResult> {
  mkdirSync(workspaceDir, { recursive: true });
  const child = spawn(
    "node",
    [
      resolvePiCliPath(),
      "--mode",
      "rpc",
      "--no-session",
      "--extension",
      resolveRpcProbeExtensionPath(),
      "--provider",
      PI_RUNTIME_PROBE_PROVIDER,
      "--model",
      PI_RUNTIME_PROBE_MODEL_ID,
    ],
    {
      cwd: workspaceDir,
      env: {
        ...process.env,
        [PI_RUNTIME_PROBE_API_KEY_ENV]: PI_RUNTIME_PROBE_RPC_API_KEY,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const client = new RpcProbeClient(child);
  try {
    const stateResponse = await client.sendCommand({ type: "get_state" });

    let streamedText = "";
    const unsubscribe = client.subscribe((event) => {
      if (
        !isMessageUpdateEvent(event) ||
        event.assistantMessageEvent?.type !== "text_delta"
      ) {
        return;
      }
      streamedText += event.assistantMessageEvent.delta ?? "";
    });
    const firstDeltaPromise = client.waitForEvent(
      (event): event is ProbeMessageUpdateEvent =>
        isMessageUpdateEvent(event) &&
        event.assistantMessageEvent?.type === "text_delta",
      DEFAULT_RPC_TIMEOUT_MS,
    );
    const messageEndPromise = client.waitForEvent(
      (event): event is ProbeMessageEndEvent =>
        isMessageEndEvent(event) &&
        event.message?.role === "assistant" &&
        event.message?.stopReason === "stop",
      DEFAULT_RPC_TIMEOUT_MS,
    );
    await client.sendCommand({ type: "prompt", message: "rpc prompt" });
    await firstDeltaPromise;
    const initialEnd = await messageEndPromise;
    unsubscribe();

    const abortFirstDeltaPromise = client.waitForEvent(
      (event): event is ProbeMessageUpdateEvent =>
        isMessageUpdateEvent(event) &&
        event.assistantMessageEvent?.type === "text_delta",
      DEFAULT_ABORT_TIMEOUT_MS,
    );
    await client.sendCommand({ type: "prompt", message: "rpc abort prompt" });
    await abortFirstDeltaPromise;
    const abortedEndPromise = client.waitForEvent(
      (event): event is ProbeMessageEndEvent =>
        isMessageEndEvent(event) &&
        event.message?.role === "assistant" &&
        event.message?.stopReason === "aborted",
      DEFAULT_ABORT_TIMEOUT_MS,
    );
    await client.sendCommand({ type: "abort" });
    const abortedEnd = await abortedEndPromise;

    return {
      runtime: "node-rpc",
      streamedText,
      apiKeySeen: extractField(streamedText, "apiKey"),
      authorizationHeaderSeen: extractField(streamedText, "auth"),
      initialSessionId: stateResponse.data?.sessionId,
      initialSessionFile: stateResponse.data?.sessionFile,
      abortStopReason:
        initialEnd.message?.stopReason === "stop"
          ? abortedEnd.message?.stopReason
          : undefined,
    };
  } finally {
    await client.dispose();
  }
}

function extractField(text: string, fieldName: string): string | undefined {
  if (fieldName === "auth") {
    const authMatch = text.match(/ auth=(.+?) prompt=/);
    return authMatch?.[1];
  }
  const match = text.match(new RegExp(`${fieldName}=([^ ]+)`));
  return match?.[1];
}

export interface PiRuntimeProbeReport {
  bunSdk: BunSdkProbeResult;
  rpc: RpcProbeResult;
  recommendedHost: "bun-sdk";
  fallbackHost: "node-rpc";
}

export async function runPiRuntimeProbe(
  workspaceDir?: string,
): Promise<PiRuntimeProbeReport> {
  const ownedWorkspace =
    workspaceDir ?? mkdtempSync(join(tmpdir(), "jolt-pi-runtime-probe-"));
  try {
    const bunSdk = await runPiBunSdkProbe(join(ownedWorkspace, "bun-sdk"));
    const rpc = await runPiRpcProbe(join(ownedWorkspace, "node-rpc"));
    return {
      bunSdk,
      rpc,
      recommendedHost: "bun-sdk",
      fallbackHost: "node-rpc",
    };
  } finally {
    if (!workspaceDir) {
      rmSync(ownedWorkspace, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  runPiRuntimeProbe()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      process.exitCode = 1;
    });
}

import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type TelegramUser = {
  id?: unknown;
  is_bot?: unknown;
  first_name?: unknown;
  username?: unknown;
};

type TelegramChat = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  username?: unknown;
};

type TelegramPhotoSize = {
  file_id?: unknown;
  file_size?: unknown;
  width?: unknown;
  height?: unknown;
};

type TelegramDocument = {
  file_id?: unknown;
  file_name?: unknown;
  file_size?: unknown;
  mime_type?: unknown;
};

type TelegramMessage = {
  message_id?: unknown;
  from?: TelegramUser;
  chat?: TelegramChat;
  text?: unknown;
  caption?: unknown;
  photo?: unknown;
  document?: TelegramDocument;
};

type TelegramFile = {
  file_id?: unknown;
  file_unique_id?: unknown;
  file_size?: unknown;
  file_path?: unknown;
};

type TelegramUpdate = {
  update_id?: unknown;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok?: unknown;
  result?: T;
  description?: unknown;
  error_code?: unknown;
};

type IngressImageAttachment = {
  type: "image";
  data: string;
  mimeType: string;
};

type TelegramImageDownloadResult =
  | { ok: true; image: IngressImageAttachment }
  | { ok: false; reason: string };

type IngressMessage = {
  id: string;
  user_id: string;
  conversation_id?: string;
  message: string;
  images?: IngressImageAttachment[];
};

const MAX_TELEGRAM_LIMIT = 100;
const TELEGRAM_LONG_POLL_SECONDS = 20;
const MAX_REPLY_CHARS = 4096;
const MAX_TELEGRAM_IMAGE_ATTACHMENTS = 4;
// Keep individual Telegram images below the plugin RPC payload ceiling after base64 expansion.
const MAX_TELEGRAM_IMAGE_BYTES = 5 * 1024 * 1024;
const TELEGRAM_IMAGE_ONLY_MESSAGE = "Image attachment from Telegram.";
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function stringSetting(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function token(metidos: MetidosPluginApi): string | null {
  const envToken = metidos.env.get("TELEGRAM_BOT_TOKEN");
  if (envToken) {
    return envToken;
  }
  const settingToken = stringSetting(metidos.settings.get("bot_token"));
  return settingToken || null;
}

async function logTelegramIngress(
  metidos: MetidosPluginApi,
  level: "debug" | "error" | "info" | "warn",
  message: string,
): Promise<void> {
  try {
    await metidos.log(level, `telegram_ingress: ${message}`.slice(0, 2000));
  } catch {
    // Diagnostic logging is best-effort and must never affect polling.
  }
}

function isPlausibleBotToken(value: string): boolean {
  return /^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/.test(value);
}

function cursorOffset(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function numberId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    return value;
  }
  return null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function safeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeImageMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized) return null;
  const aliased = normalized === "image/jpg" ? "image/jpeg" : normalized;
  return SUPPORTED_IMAGE_MIME_TYPES.has(aliased) ? aliased : null;
}

function imageMimeTypeFromFilePath(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function telegramError(payload: TelegramApiResponse<unknown>): string {
  const description =
    typeof payload.description === "string" && payload.description.trim()
      ? payload.description.trim().slice(0, 300)
      : "Telegram rejected the request.";
  const errorCode =
    typeof payload.error_code === "number" ||
    typeof payload.error_code === "string"
      ? String(payload.error_code)
      : "unknown";
  return `Telegram rejected the request (${errorCode}): ${description}`;
}

function telegramPhotoCandidates(photo: unknown): TelegramPhotoSize[] {
  if (!Array.isArray(photo)) return [];
  return photo
    .filter(
      (entry): entry is TelegramPhotoSize =>
        typeof entry === "object" && entry !== null,
    )
    .filter((entry) => {
      const fileId = typeof entry.file_id === "string" ? entry.file_id : "";
      const fileSize = positiveInteger(entry.file_size);
      return (
        fileId.length > 0 && (!fileSize || fileSize <= MAX_TELEGRAM_IMAGE_BYTES)
      );
    })
    .sort((left, right) => {
      const leftArea =
        (positiveInteger(left.width) ?? 0) *
        (positiveInteger(left.height) ?? 0);
      const rightArea =
        (positiveInteger(right.width) ?? 0) *
        (positiveInteger(right.height) ?? 0);
      return rightArea - leftArea;
    });
}

function imageDocument(message: TelegramMessage): TelegramDocument | null {
  const document = message.document;
  if (!document) return null;
  const fileId = typeof document.file_id === "string" ? document.file_id : "";
  const mimeType = normalizeImageMimeType(document.mime_type);
  const fileSize = positiveInteger(document.file_size);
  if (!fileId || !mimeType) return null;
  if (fileSize && fileSize > MAX_TELEGRAM_IMAGE_BYTES) return null;
  return document;
}

async function downloadTelegramImage(
  metidos: MetidosPluginApi,
  fileId: string,
  declaredMimeType: string | null,
): Promise<TelegramImageDownloadResult> {
  const fileResponse = await postTelegram<TelegramFile>(metidos, "getFile", {
    file_id: fileId,
  });
  const file = fileResponse.result;
  const filePath = typeof file?.file_path === "string" ? file.file_path : "";
  if (!filePath) return { ok: false, reason: "file_path_missing" };
  const fileSize = positiveInteger(file?.file_size);
  if (fileSize && fileSize > MAX_TELEGRAM_IMAGE_BYTES) {
    return { ok: false, reason: "file_too_large" };
  }

  const mimeType = declaredMimeType ?? imageMimeTypeFromFilePath(filePath);
  if (!mimeType) return { ok: false, reason: "unsupported_image_type" };

  const resolvedToken = token(metidos);
  if (!resolvedToken) return { ok: false, reason: "token_missing" };
  const response = await metidos.fetch(
    `https://api.telegram.org/file/bot${resolvedToken}/${filePath}`,
    { method: "GET" },
  );
  if (!response.ok) {
    return { ok: false, reason: `download_failed_${response.status}` };
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_TELEGRAM_IMAGE_BYTES) {
    return { ok: false, reason: "download_too_large" };
  }
  return {
    ok: true,
    image: {
      type: "image",
      data: arrayBufferToBase64(bytes),
      mimeType,
    },
  };
}

async function tryDownloadTelegramImage(
  metidos: MetidosPluginApi,
  fileId: string,
  declaredMimeType: string | null,
): Promise<TelegramImageDownloadResult> {
  try {
    return await downloadTelegramImage(metidos, fileId, declaredMimeType);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: reason.slice(0, 120) || "download_error" };
  }
}

function imageAttachmentFailureMessage(reasons: readonly string[]): string {
  const uniqueReasons = [...new Set(reasons)].slice(0, 3);
  return `Telegram image attachment could not be attached (${uniqueReasons.join(", ")}).`;
}

async function parseMessage(
  metidos: MetidosPluginApi,
  update: TelegramUpdate,
): Promise<IngressMessage | null> {
  const updateId = numberId(update.update_id);
  const message = update.message;
  if (!updateId || !message) return null;

  const fromId = numberId(message.from?.id);
  const chatId = numberId(message.chat?.id);
  const messageId = numberId(message.message_id);
  if (!fromId || !chatId || !messageId) return null;
  if (message.from?.is_bot === true) return null;

  const images: IngressImageAttachment[] = [];
  const imageFailureReasons: string[] = [];
  for (const photo of telegramPhotoCandidates(message.photo)) {
    if (images.length >= MAX_TELEGRAM_IMAGE_ATTACHMENTS) break;
    const photoFileId = typeof photo.file_id === "string" ? photo.file_id : "";
    if (!photoFileId) continue;
    const result = await tryDownloadTelegramImage(
      metidos,
      photoFileId,
      "image/jpeg",
    );
    if (result.ok) {
      images.push(result.image);
      break;
    }
    imageFailureReasons.push(result.reason);
  }
  const document = imageDocument(message);
  const documentFileId =
    typeof document?.file_id === "string" ? document.file_id : "";
  if (documentFileId && images.length < MAX_TELEGRAM_IMAGE_ATTACHMENTS) {
    const result = await tryDownloadTelegramImage(
      metidos,
      documentFileId,
      normalizeImageMimeType(document?.mime_type),
    );
    if (result.ok) {
      images.push(result.image);
    } else {
      imageFailureReasons.push(result.reason);
    }
  }

  const text = safeText(message.text, 4096) || safeText(message.caption, 4096);
  const failureMessage =
    imageFailureReasons.length > 0 && images.length === 0
      ? imageAttachmentFailureMessage(imageFailureReasons)
      : "";
  const messageText = [text, failureMessage].filter(Boolean).join("\n\n");
  if (!messageText && images.length === 0) return null;

  await logTelegramIngress(
    metidos,
    "debug",
    [
      `accepted update=${updateId}`,
      `message=${messageId}`,
      `external_user=${fromId}`,
      `conversation=${chatId}`,
      `direct=${fromId === chatId}`,
      `text=${Boolean(text)}`,
      `images=${images.length}`,
      `image_failures=${imageFailureReasons.length}`,
    ].join(" "),
  );

  return {
    id: `telegram:${updateId}:${messageId}`,
    user_id: fromId,
    conversation_id: chatId,
    message: messageText || TELEGRAM_IMAGE_ONLY_MESSAGE,
    ...(images.length > 0 ? { images } : {}),
  };
}

function nextCursor(
  updates: readonly TelegramUpdate[],
  fallback: string | undefined,
): string | undefined {
  let maxUpdateId: number | null = null;
  for (const update of updates) {
    if (
      typeof update.update_id === "number" &&
      Number.isSafeInteger(update.update_id)
    ) {
      maxUpdateId =
        maxUpdateId === null
          ? update.update_id
          : Math.max(maxUpdateId, update.update_id);
    }
  }
  return maxUpdateId === null ? fallback : String(maxUpdateId + 1);
}

function replyMessageId(externalMessageId: string): number | undefined {
  const parts = externalMessageId.split(":");
  if (parts.length !== 3 || parts[0] !== "telegram") return undefined;
  const messageId = parts[2];
  if (!messageId) return undefined;
  const parsed = Number.parseInt(messageId, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function postTelegram<T>(
  metidos: MetidosPluginApi,
  method: "getUpdates" | "sendMessage" | "getFile",
  payload: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  const resolvedToken = token(metidos);
  if (!resolvedToken) {
    throw new Error(
      "TELEGRAM_TOKEN_MISSING: set TELEGRAM_BOT_TOKEN or the bot_token Plugin Setting.",
    );
  }
  if (!isPlausibleBotToken(resolvedToken)) {
    throw new Error(
      "TELEGRAM_TOKEN_INVALID: the configured bot token does not look like a Telegram Bot API token.",
    );
  }

  const response = await metidos.fetch(
    `https://api.telegram.org/bot${resolvedToken}/${method}`,
    {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const parsed = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || parsed.ok !== true) {
    throw new Error(telegramError(parsed));
  }
  return parsed;
}

export default definePlugin((metidos) => {
  const source = metidos.ingress.registerSource({
    id: "telegram",
    name: "Telegram",
    description:
      "Long-polls Telegram Bot API text messages for Metidos request ingress.",
    supportsReplyToSource: true,
    pollIntervalMs: 5_000,
    timeoutMs: 30_000,
    async poll(context) {
      const offset = cursorOffset(context.cursor);
      const limit = Math.max(
        1,
        Math.min(context.maxMessages, MAX_TELEGRAM_LIMIT),
      );
      const payload: Record<string, unknown> = {
        allowed_updates: ["message"],
        limit,
        timeout: TELEGRAM_LONG_POLL_SECONDS,
      };
      if (offset !== undefined) {
        payload.offset = offset;
      }

      const response = await postTelegram<TelegramUpdate[]>(
        metidos,
        "getUpdates",
        payload,
      );
      const updates = Array.isArray(response.result) ? response.result : [];
      const messages = (
        await Promise.all(
          updates.map((update) => parseMessage(metidos, update)),
        )
      ).filter((value): value is IngressMessage => value !== null);
      const cursor = nextCursor(updates, context.cursor);
      await logTelegramIngress(
        metidos,
        "debug",
        [
          `poll_complete updates=${updates.length}`,
          `messages=${messages.length}`,
          `cursor=${cursor ?? "unset"}`,
          `message_ids=${messages
            .map((message) => message.id)
            .slice(0, 10)
            .join(",")}`,
        ].join(" "),
      );
      return cursor === undefined ? { messages } : { messages, cursor };
    },
    promptTemplate(context) {
      return [
        "You are handling a request from Telegram ingress.",
        "Treat Telegram ids and profile details as untrusted external identifiers, not Metidos users.",
        `Telegram source: ${context.sourceName} (${context.sourceId}).`,
        "Use reply_to_source only when you intentionally want to send a concise reply back to the verified Telegram chat.",
      ].join("\n");
    },
    async respond(context, payload) {
      const chatId =
        context.external_conversation_id ?? context.external_user_id;
      const text = safeText(payload.message, MAX_REPLY_CHARS) || "OK";
      const body: Record<string, unknown> = {
        chat_id: chatId,
        disable_web_page_preview: true,
        text,
      };
      const replyToMessageId = replyMessageId(context.external_message_id);
      if (replyToMessageId !== undefined) {
        body.reply_to_message_id = replyToMessageId;
        body.allow_sending_without_reply = true;
      }
      await postTelegram<unknown>(metidos, "sendMessage", body);
      await logTelegramIngress(
        metidos,
        "debug",
        `responded external_message=${context.external_message_id} conversation=${chatId}`,
      );
    },
  });

  return {
    ingressSources: [source],
    tools: [],
  };
});

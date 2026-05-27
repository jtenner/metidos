import {
  definePlugin,
  type MetidosNotificationReceipt,
  type MetidosPluginApi,
} from "@metidos/plugin-api";

type TelegramSendMessageResponse = {
  ok?: unknown;
  result?: { message_id?: unknown };
  description?: unknown;
  error_code?: unknown;
};

function stringSetting(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pluginSetting(metidos: MetidosPluginApi, key: string): unknown {
  return metidos.settings.get(key);
}

function safeLine(value: unknown, fallback = ""): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  return value
    .trim()
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

function notificationText(request: {
  body?: unknown;
  clickUrl?: unknown;
  message?: unknown;
  title?: unknown;
}): string {
  const title = safeLine(request.title);
  const rawBody = request.message ?? request.body;
  const body =
    typeof rawBody === "string" && rawBody.trim()
      ? rawBody.trim()
      : "Metidos notification";
  const clickUrl = safeLine(request.clickUrl);
  const parts = [title, body, clickUrl].filter(Boolean);
  return parts.join("\n\n").slice(0, 4096);
}

function failed(
  code: string,
  message: string,
): {
  receipts: MetidosNotificationReceipt[];
} {
  return { receipts: [{ code, message, status: "failed" }] };
}

function token(metidos: MetidosPluginApi): string | null {
  const settingToken = stringSetting(pluginSetting(metidos, "bot_token"));
  if (settingToken) {
    return settingToken;
  }
  const envToken = metidos.env.get("TELEGRAM_BOT_TOKEN");
  return envToken || null;
}

function chatId(metidos: MetidosPluginApi): string | null {
  const chatIdSetting = stringSetting(pluginSetting(metidos, "chat_id"));
  return chatIdSetting || null;
}

function parseMode(metidos: MetidosPluginApi): string | null {
  const value = stringSetting(pluginSetting(metidos, "parse_mode"), "none");
  return value === "MarkdownV2" || value === "HTML" ? value : null;
}

function isPlausibleBotToken(value: string): boolean {
  return /^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/.test(value);
}

function timeoutCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|deadline/i.test(message)
    ? "TELEGRAM_TIMEOUT"
    : "TELEGRAM_SEND_FAILED";
}

function telegramFailureMessage(payload: TelegramSendMessageResponse): string {
  const description =
    typeof payload.description === "string" && payload.description.trim()
      ? payload.description.trim().slice(0, 300)
      : "Telegram rejected the notification.";
  const errorCode =
    typeof payload.error_code === "number" ||
    typeof payload.error_code === "string"
      ? String(payload.error_code)
      : "unknown";
  return `Telegram rejected the notification (${errorCode}): ${description}`;
}

export default definePlugin((metidos) => {
  metidos.notifications.addProvider({
    id: "telegram",
    timeoutMs: 10_000,
    async send(request) {
      if (!booleanSetting(pluginSetting(metidos, "enabled"), false)) {
        return failed(
          "TELEGRAM_DISABLED",
          "Enable Telegram in plugin settings before sending.",
        );
      }

      const resolvedToken = token(metidos);
      if (!resolvedToken) {
        return failed(
          "TELEGRAM_TOKEN_MISSING",
          "Set TELEGRAM_BOT_TOKEN or the bot_token plugin setting before sending.",
        );
      }
      if (!isPlausibleBotToken(resolvedToken)) {
        return failed(
          "TELEGRAM_TOKEN_INVALID",
          "The configured Telegram bot token does not look like a Telegram Bot API token.",
        );
      }

      const resolvedChatId = chatId(metidos);
      if (!resolvedChatId) {
        return failed(
          "TELEGRAM_CHAT_ID_MISSING",
          "Set the chat_id plugin setting before sending. Chat IDs are intentionally not read from environment variables.",
        );
      }

      const payload: Record<string, unknown> = {
        chat_id: resolvedChatId,
        disable_web_page_preview: booleanSetting(
          pluginSetting(metidos, "disable_web_page_preview"),
          true,
        ),
        text: notificationText(request),
      };
      const mode = parseMode(metidos);
      if (mode) {
        payload.parse_mode = mode;
      }

      try {
        const response = await metidos.fetch(
          `https://api.telegram.org/bot${resolvedToken}/sendMessage`,
          {
            body: JSON.stringify(payload),
            headers: {
              "content-type": "application/json",
            },
            method: "POST",
          },
        );
        const telegramPayload =
          (await response.json()) as TelegramSendMessageResponse;
        if (!response.ok || telegramPayload.ok !== true) {
          return failed(
            "TELEGRAM_REJECTED",
            telegramFailureMessage(telegramPayload),
          );
        }
        const messageId = telegramPayload.result?.message_id;
        const externalId =
          typeof messageId === "number" || typeof messageId === "string"
            ? String(messageId)
            : undefined;
        const receipt: MetidosNotificationReceipt = {
          ...(externalId ? { externalId } : {}),
          externalUrl: "https://api.telegram.org",
          message: externalId
            ? "Telegram accepted the notification."
            : "Telegram accepted the notification without a message id.",
          status: "delivered",
        };
        return { receipts: [receipt] };
      } catch (error) {
        return failed(
          timeoutCode(error),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
});

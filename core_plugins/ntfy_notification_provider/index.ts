import {
  definePlugin,
  type MetidosNotificationReceipt,
  type MetidosPluginApi,
} from "@metidos/plugin-api";

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function pluginSetting(metidos: MetidosPluginApi, key: string): unknown {
  return metidos.settings.get(key);
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeServerUrl(value: unknown): string {
  const raw = stringSetting(value, "https://ntfy.sh").replace(/\/+$/g, "");
  if (raw !== "https://ntfy.sh") {
    throw new Error(
      "This plugin manifest allows only https://ntfy.sh/**. Update network.allow before using a different ntfy server.",
    );
  }
  return raw;
}

function notificationText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 4096)
    : fallback;
}

function headerText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value
    .trim()
    .replace(/[\r\n]+/g, " ")
    .slice(0, 200);
}

function tagsHeader(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const tags = value
    .filter(
      (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
    )
    .map((tag) =>
      tag
        .trim()
        .replace(/[,\r\n]+/g, "")
        .slice(0, 40),
    )
    .filter(Boolean)
    .slice(0, 5);
  return tags.length > 0 ? tags.join(",") : null;
}

function topic(metidos: MetidosPluginApi): string | null {
  const settingTopic = stringSetting(pluginSetting(metidos, "topic"), "");
  if (settingTopic) {
    return settingTopic;
  }
  const envTopic = metidos.env.get("NTFY_TOPIC");
  if (envTopic) {
    return envTopic;
  }
  const defaultTopic = stringSetting(
    pluginSetting(metidos, "default_topic"),
    "",
  );
  return defaultTopic || null;
}

function authHeader(metidos: MetidosPluginApi): string | null {
  const userAuthType = stringSetting(pluginSetting(metidos, "auth_type"), "");
  const authType =
    userAuthType || (metidos.env.get("NTFY_TOKEN") ? "bearer" : "none");
  if (authType === "bearer") {
    const token =
      stringSetting(pluginSetting(metidos, "token"), "") ||
      metidos.env.get("NTFY_TOKEN");
    return token ? `Bearer ${token}` : null;
  }
  if (authType === "basic") {
    const username = stringSetting(pluginSetting(metidos, "username"), "");
    const password = stringSetting(pluginSetting(metidos, "password"), "");
    if (!username || !password) {
      return null;
    }
    return `Basic ${base64Encode(`${username}:${password}`)}`;
  }
  return null;
}

function base64Encode(value: string): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes =
    typeof TextEncoder === "function"
      ? Array.from(new TextEncoder().encode(value))
      : Array.from(value, (char) => char.charCodeAt(0) & 0xff);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    output += alphabet[(combined >> 18) & 63];
    output += alphabet[(combined >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[combined & 63] : "=";
  }
  return output;
}

function failed(
  code: string,
  message: string,
): {
  receipts: MetidosNotificationReceipt[];
} {
  return { receipts: [{ code, message, status: "failed" }] };
}

type NtfyResponsePayload = {
  code?: unknown;
  error?: unknown;
  id?: unknown;
  message?: unknown;
};

function timeoutCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|deadline/i.test(message)
    ? "NTFY_TIMEOUT"
    : "NTFY_SEND_FAILED";
}

function ntfyFailureMessage(
  status: number,
  payload: NtfyResponsePayload,
): string {
  const detail =
    typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim().slice(0, 300)
      : typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim().slice(0, 300)
        : "ntfy rejected the notification.";
  const code =
    typeof payload.code === "number" || typeof payload.code === "string"
      ? ` (${payload.code})`
      : "";
  return `ntfy rejected the notification with HTTP ${status}${code}: ${detail}`;
}

export default definePlugin((metidos) => {
  metidos.notifications.addProvider({
    id: "ntfy",
    timeoutMs: 10_000,
    async send(request) {
      if (!booleanSetting(pluginSetting(metidos, "enabled"), false)) {
        return failed(
          "NTFY_DISABLED",
          "Enable ntfy in plugin settings before sending.",
        );
      }
      const resolvedTopic = topic(metidos);
      if (!resolvedTopic) {
        return failed(
          "NTFY_TOPIC_MISSING",
          "Set the ntfy topic setting, NTFY_TOPIC, or default_topic before sending.",
        );
      }

      let serverUrl: string;
      try {
        serverUrl = normalizeServerUrl(pluginSetting(metidos, "server_url"));
      } catch (error) {
        return failed(
          "NTFY_SERVER_DENIED",
          error instanceof Error ? error.message : String(error),
        );
      }

      const headers: Record<string, string> = {};
      const title = headerText(request.title);
      const priority = headerText(
        request.priority ?? pluginSetting(metidos, "priority"),
      );
      const tags = tagsHeader(request.tags);
      const clickUrl = headerText(request.clickUrl);
      const authorization = authHeader(metidos);
      if (title) headers.title = title;
      if (priority) headers.priority = priority;
      if (tags) headers.tags = tags;
      if (clickUrl) headers.click = clickUrl;
      if (authorization) headers.authorization = authorization;

      const endpoint = `${serverUrl}/${encodeURIComponent(resolvedTopic)}`;
      try {
        const response = await metidos.fetch(endpoint, {
          body: notificationText(
            request.message ?? request.body,
            "Metidos notification",
          ),
          headers,
          method: "POST",
        });
        const payload = (await response.json()) as NtfyResponsePayload;
        if (!response.ok) {
          return failed(
            "NTFY_REJECTED",
            ntfyFailureMessage(response.status, payload),
          );
        }
        const externalId =
          typeof payload.id === "string" ? payload.id : undefined;
        const receipt: MetidosNotificationReceipt = {
          ...(externalId ? { externalId } : {}),
          externalUrl: serverUrl,
          message: externalId
            ? "ntfy accepted the notification."
            : "ntfy accepted the notification without an id.",
          status: "delivered",
        };
        return {
          receipts: [receipt],
        };
      } catch (error) {
        return failed(
          timeoutCode(error),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
});

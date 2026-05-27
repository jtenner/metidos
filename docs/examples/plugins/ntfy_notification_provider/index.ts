import {
  definePlugin,
  type MetidosNotificationReceipt,
  type MetidosPluginApi,
} from "@metidos/plugin-api";

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeServerUrl(value: unknown): string {
  const raw = stringSetting(value, "https://ntfy.sh").replace(/\/+$/g, "");
  if (raw !== "https://ntfy.sh") {
    throw new Error(
      "This example manifest allows only https://ntfy.sh/**. Update network.allow before using a different ntfy server.",
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
  const envTopic = metidos.env.get("NTFY_TOPIC");
  if (envTopic) {
    return envTopic;
  }
  try {
    const settingTopic = stringSetting(
      metidos.settings.get("default_topic"),
      "",
    );
    return settingTopic || null;
  } catch {
    return null;
  }
}

function failed(
  code: string,
  message: string,
): {
  receipts: MetidosNotificationReceipt[];
} {
  return { receipts: [{ code, message, status: "failed" }] };
}

function timeoutCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|deadline/i.test(message)
    ? "NTFY_TIMEOUT"
    : "NTFY_SEND_FAILED";
}

export default definePlugin((rawMetidos) => {
  const metidos = rawMetidos;
  metidos.notifications.addProvider({
    id: "ntfy",
    timeoutMs: 10_000,
    async send(request) {
      const resolvedTopic = topic(metidos);
      if (!resolvedTopic) {
        return failed(
          "NTFY_TOPIC_MISSING",
          "Set NTFY_TOPIC or the plugin default_topic setting before sending.",
        );
      }

      let serverUrl: string;
      try {
        serverUrl = normalizeServerUrl(metidos.settings.get("server_url"));
      } catch (error) {
        return failed(
          "NTFY_SERVER_DENIED",
          error instanceof Error ? error.message : String(error),
        );
      }

      const headers: Record<string, string> = {};
      const title = headerText(request.title);
      const priority = headerText(request.priority);
      const tags = tagsHeader(request.tags);
      const clickUrl = headerText(request.clickUrl);
      const token = metidos.env.get("NTFY_TOKEN");
      if (title) headers.title = title;
      if (priority) headers.priority = priority;
      if (tags) headers.tags = tags;
      if (clickUrl) headers.click = clickUrl;
      if (token) headers.authorization = `Bearer ${token}`;

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
        const payload = (await response.json()) as { id?: unknown };
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

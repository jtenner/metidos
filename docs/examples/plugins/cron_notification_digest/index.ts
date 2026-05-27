import {
  definePlugin,
  type MetidosNotificationReceipt,
  type MetidosPluginApi,
} from "@metidos/plugin-api";

type CronNotificationResult = {
  receipts?: readonly MetidosNotificationReceipt[];
  reason?: string;
  status: "delivered" | "failed" | "skipped";
};

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function receiptCodes(receipts: readonly MetidosNotificationReceipt[]): string {
  const codes = receipts
    .map((receipt) => receipt.code ?? receipt.status)
    .filter(Boolean);
  return codes.length > 0 ? codes.join(", ") : "none";
}

async function safeLog(
  metidos: MetidosPluginApi,
  level: "debug" | "error" | "info" | "warn",
  message: string,
): Promise<void> {
  try {
    await metidos.log(level, message.slice(0, 2000));
  } catch {
    // Logging is diagnostic only. A logging failure must not turn a notification
    // receipt failure into a sidecar crash.
  }
}

export default definePlugin((rawMetidos) => {
  const metidos = rawMetidos;

  metidos.cron({
    key: "send_digest",
    schedule: "*/15 * * * *",
    timeoutMs: 2_000,
    async action(context): Promise<CronNotificationResult> {
      const enabled = booleanSetting(metidos.settings.get("enabled"), true);
      if (!enabled) {
        await safeLog(
          metidos,
          "info",
          "Cron notification digest skipped because the plugin setting is disabled.",
        );
        return { reason: "disabled_by_setting", status: "skipped" };
      }

      const prefix = stringSetting(
        metidos.settings.get("title_prefix"),
        "Metidos",
      ).slice(0, 40);
      const scheduledAt = context.scheduledAt ?? new Date().toISOString();

      try {
        const result = await metidos.notifications.send({
          message: `The cron_notification_digest example ran at ${scheduledAt}. Failed receipts are returned instead of thrown so Metidos can show no-outlet and rate-limit diagnostics.`,
          priority: "default",
          tags: ["plugin", "cron", "example"],
          title: `${prefix} cron digest`,
        });
        const receipts = result.receipts ?? [];
        const failed = receipts.filter(
          (receipt) => receipt.status === "failed",
        );
        if (failed.length > 0) {
          await safeLog(
            metidos,
            "warn",
            `Cron notification digest finished with failed receipts: ${receiptCodes(failed)}.`,
          );
          return { receipts, status: "failed" };
        }
        await safeLog(
          metidos,
          "info",
          `Cron notification digest delivered ${receipts.length} receipt(s).`,
        );
        return { receipts, status: "delivered" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await safeLog(
          metidos,
          "error",
          `Cron notification digest crashed before receipts were returned: ${message}`,
        );
        return {
          receipts: [
            {
              code: /timeout|timed out|deadline/i.test(message)
                ? "CRON_NOTIFICATION_TIMEOUT"
                : "CRON_NOTIFICATION_SEND_ERROR",
              message,
              status: "failed",
            },
          ],
          status: "failed",
        };
      }
    },
  });
});

export type RpcUserNotificationDelivery = {
  id: number;
  userId: number;
  pluginId: string | null;
  title: string;
  body: string;
  clickUrl: string | null;
  priority: string | null;
  tagsJson: string;
  status: "sent" | "delivered" | "queued_for_retry" | "failed";
  sentAt: string;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RpcUserNotificationProviderReceipt = {
  channel: "ntfy" | "plugin";
  code?: string;
  deliveryId: number | null;
  externalId?: string | null;
  externalUrl?: string | null;
  message: string;
  outlet: "ntfy" | "plugin";
  provider?: string;
  retryAfter?: number | string | null;
  retryable?: boolean;
  status: "delivered" | "failed";
};

export type RpcUserNotificationDeliveryResult = {
  deliveryId: number;
  lastError?: string | null;
  message: string;
  receipts?: RpcUserNotificationProviderReceipt[];
  status: "delivered" | "queued_for_retry" | "failed";
};

export type RpcTimezoneSettings = {
  effectiveTimezone: string;
  timezone: string;
  userId: number;
  updatedAt: string;
};

export type RpcUserRuntimeSettings = {
  commandTimeoutSeconds: number;
  embeddingModel: string;
  userId: number;
  updatedAt: string;
};

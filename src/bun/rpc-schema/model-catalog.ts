export type RpcReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type RpcReasoningEffortOption = {
  id: RpcReasoningEffort;
  label: string;
};

export type RpcModelCatalog = {
  defaultModel: string;
  defaultReasoningEffort: RpcReasoningEffort;
  models: RpcModelOption[];
  reasoningEfforts: RpcReasoningEffortOption[];
};

export type RpcModelOption = {
  id: string;
  providerId: string;
  providerLabel: string;
  providerAvailable?: boolean;
  providerAvailabilityNote?: string | null;
  isPlaceholder?: boolean;
  modelId: string;
  label: string;
  group: string;
  summary: string;
  deprecated: boolean;
  contextWindowTokens: number;
  supportsEmbeddings?: boolean;
  supportsImageInput?: boolean;
  supportsReasoningEffort: boolean;
  supportedReasoningEfforts?: RpcReasoningEffort[];
};

import type { ModelReasoningEffort } from "@openai/codex-sdk";

import { DEFAULT_THREAD_MODEL, DEFAULT_THREAD_REASONING_EFFORT } from "../db";
import type {
	RpcCodexModelCatalog,
	RpcCodexModelOption,
	RpcCodexReasoningEffort,
	RpcCodexReasoningEffortOption,
} from "../rpc-schema";

const DEFAULT_COMPACTION_ESTIMATE_RATIO = 0.8;

// Sourced from OpenAI's official models docs on March 29, 2026. The SDK accepts
// raw model IDs, but it does not expose a discovery API for enumerating them.
const CODEX_MODEL_OPTIONS: RpcCodexModelOption[] = [
	{
		id: "gpt-5.4",
		label: "GPT-5.4",
		group: "Frontier",
		summary: "Latest flagship model for complex reasoning and coding.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.4-pro",
		label: "GPT-5.4 Pro",
		group: "Frontier",
		summary: "Higher-precision GPT-5.4 variant for harder tasks.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.4-mini",
		label: "GPT-5.4 Mini",
		group: "Frontier",
		summary: "Faster lower-cost GPT-5.4 model for coding and subagents.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.4-nano",
		label: "GPT-5.4 Nano",
		group: "Frontier",
		summary: "Cheapest GPT-5.4-class model for simple tasks.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5-mini",
		label: "GPT-5 Mini",
		group: "Frontier",
		summary: "Near-frontier intelligence for cost-sensitive workloads.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5-nano",
		label: "GPT-5 Nano",
		group: "Frontier",
		summary: "Fastest and most cost-efficient GPT-5 model.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5",
		label: "GPT-5",
		group: "Frontier",
		summary: "Previous GPT-5 frontier model for coding and agentic work.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-4.1",
		label: "GPT-4.1",
		group: "Frontier",
		summary: "Highest-capability non-reasoning general model.",
		deprecated: false,
		contextWindowTokens: 1_047_576,
	},
	{
		id: "gpt-5-codex",
		label: "GPT-5-Codex",
		group: "Coding",
		summary: "GPT-5 variant optimized for agentic coding in Codex.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.3-codex",
		label: "GPT-5.3-Codex",
		group: "Coding",
		summary: "Previous high-capability agentic coding model.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.2-codex",
		label: "GPT-5.2-Codex",
		group: "Coding",
		summary: "Long-horizon coding model for complex repo work.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.1-codex",
		label: "GPT-5.1-Codex",
		group: "Coding",
		summary: "GPT-5.1 variant optimized for agentic coding in Codex.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.1-codex-max",
		label: "GPT-5.1-Codex-Max",
		group: "Coding",
		summary: "GPT-5.1 Codex variant tuned for longer-running tasks.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.1-codex-mini",
		label: "GPT-5.1-Codex-Mini",
		group: "Coding",
		summary: "Smaller cheaper GPT-5.1 Codex model.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "codex-mini-latest",
		label: "Codex Mini Latest",
		group: "Coding",
		summary: "Deprecated fast reasoning model for older Codex workflows.",
		deprecated: true,
		contextWindowTokens: 200_000,
	},
];

const codexModelOptionMap = new Map(
	CODEX_MODEL_OPTIONS.map((model) => [model.id, model]),
);

const CODEX_REASONING_EFFORT_OPTIONS: RpcCodexReasoningEffortOption[] = [
	{
		id: "minimal",
		label: "Minimal",
	},
	{
		id: "low",
		label: "Low",
	},
	{
		id: "medium",
		label: "Medium",
	},
	{
		id: "high",
		label: "High",
	},
	{
		id: "xhigh",
		label: "Extra High",
	},
];

const codexReasoningEffortOptionMap = new Map(
	CODEX_REASONING_EFFORT_OPTIONS.map((option) => [option.id, option]),
);

export function buildCodexModelCatalog(): RpcCodexModelCatalog {
	return {
		defaultModel: DEFAULT_THREAD_MODEL,
		defaultReasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
		models: CODEX_MODEL_OPTIONS,
		reasoningEfforts: CODEX_REASONING_EFFORT_OPTIONS,
	};
}

export function contextWindowTokensForModel(
	model: string | null | undefined,
): number {
	const normalized = normalizeStoredCodexModel(model);
	return codexModelOptionMap.get(normalized)?.contextWindowTokens ?? 400_000;
}

export function heuristicCompactionTriggerTokens(
	model: string | null | undefined,
): number {
	return Math.round(
		contextWindowTokensForModel(model) * DEFAULT_COMPACTION_ESTIMATE_RATIO,
	);
}

export function resolveCodexModel(model: string | null | undefined): string {
	const normalized = model?.trim();
	if (!normalized) {
		return DEFAULT_THREAD_MODEL;
	}
	if (!codexModelOptionMap.has(normalized)) {
		throw new Error(`Unsupported Codex model: ${normalized}`);
	}
	return normalized;
}

export function normalizeStoredCodexModel(
	model: string | null | undefined,
): string {
	const normalized = model?.trim();
	if (!normalized || !codexModelOptionMap.has(normalized)) {
		return DEFAULT_THREAD_MODEL;
	}
	return normalized;
}

export function resolveCodexReasoningEffort(
	reasoningEffort: string | null | undefined,
): RpcCodexReasoningEffort {
	const normalized = reasoningEffort?.trim() as
		| ModelReasoningEffort
		| undefined;
	if (!normalized) {
		return DEFAULT_THREAD_REASONING_EFFORT as RpcCodexReasoningEffort;
	}
	if (!codexReasoningEffortOptionMap.has(normalized)) {
		throw new Error(`Unsupported reasoning effort: ${normalized}`);
	}
	return normalized;
}

export function normalizeStoredCodexReasoningEffort(
	reasoningEffort: string | null | undefined,
): RpcCodexReasoningEffort {
	const normalized = reasoningEffort?.trim() as
		| ModelReasoningEffort
		| undefined;
	if (!normalized || !codexReasoningEffortOptionMap.has(normalized)) {
		return DEFAULT_THREAD_REASONING_EFFORT as RpcCodexReasoningEffort;
	}
	return normalized;
}

import type {
	RpcCodexModelOption,
	RpcCodexReasoningEffort,
	RpcCodexReasoningEffortOption,
} from "../../bun/rpc-schema";

export function groupCodexModels(
	models: RpcCodexModelOption[],
): Array<{ group: string; models: RpcCodexModelOption[] }> {
	const grouped = new Map<string, RpcCodexModelOption[]>();
	for (const model of models) {
		const entries = grouped.get(model.group) ?? [];
		entries.push(model);
		grouped.set(model.group, entries);
	}
	return [...grouped.entries()].map(([group, entries]) => ({
		group,
		models: entries,
	}));
}

export function codexModelLabel(model: RpcCodexModelOption): string {
	return model.deprecated ? `${model.label} (Deprecated)` : model.label;
}

export function findCodexModel(
	models: RpcCodexModelOption[],
	modelId: string,
): RpcCodexModelOption | null {
	return models.find((model) => model.id === modelId) ?? null;
}

export function findReasoningEffortOption(
	options: RpcCodexReasoningEffortOption[],
	reasoningEffort: RpcCodexReasoningEffort,
): RpcCodexReasoningEffortOption | null {
	return options.find((option) => option.id === reasoningEffort) ?? null;
}

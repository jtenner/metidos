import type { JSX } from "react";
import type {
	RpcCodexReasoningEffort,
	RpcCodexReasoningEffortOption,
} from "../../bun/rpc-schema";
import { findReasoningEffortOption } from "./codex-utils";
import { DropdownControl } from "./dropdown";
import { materialSymbol } from "./icons";

type ReasoningEffortSelectorProps = {
	disabled: boolean;
	onChange: (value: RpcCodexReasoningEffort) => void;
	options: RpcCodexReasoningEffortOption[];
	value: RpcCodexReasoningEffort;
	variant: "desktop" | "mobile";
};

export function ReasoningEffortSelector({
	disabled,
	onChange,
	options,
	value,
	variant,
}: ReasoningEffortSelectorProps): JSX.Element {
	const activeOption = findReasoningEffortOption(options, value);
	const buttonLabel = activeOption
		? activeOption.label
		: options.length === 0
			? "Loading"
			: "Effort";

	return (
		<DropdownControl
			canOpen={!disabled}
			disabled={disabled}
			title={
				activeOption
					? `Reasoning effort: ${activeOption.label}`
					: "Reasoning effort"
			}
			renderButton={({ open, toggle }) => (
				<button
					type="button"
					className={`flex w-full items-center gap-2 overflow-hidden border text-left transition-colors ${
						variant === "desktop"
							? "h-7 rounded-sm border-[#3a3a44] bg-[#131313] px-2.5 hover:bg-[#191c1f]"
							: "h-10 rounded-xl border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#262b2f]"
					} ${disabled ? "cursor-not-allowed opacity-60" : ""} ${
						open
							? "border-[#9fc1da] shadow-[0_0_0_1px_rgba(159,193,218,0.18)]"
							: ""
					}`}
					onClick={toggle}
					disabled={disabled}
					aria-expanded={open}
					aria-haspopup="menu"
				>
					{materialSymbol(
						"bolt",
						variant === "desktop"
							? "text-[15px] text-[#bdd5e6]"
							: "text-[16px] text-[#bdd5e6]",
						{
							filled: true,
						},
					)}
					<span
						className={`min-w-0 flex-1 truncate font-label font-bold uppercase text-[#f2f0ef] ${
							variant === "desktop"
								? "text-[10px] leading-none tracking-wider"
								: "text-[10px] leading-none tracking-widest"
						}`}
					>
						{buttonLabel}
					</span>
					<span
						className={`shrink-0 text-[#8f8d8b] ${
							variant === "desktop"
								? "leading-none"
								: "flex h-4 items-center leading-none"
						}`}
					>
						{materialSymbol(
							open ? "expand_less" : "expand_more",
							variant === "desktop" ? "text-[13px]" : "text-[16px]",
						)}
					</span>
				</button>
			)}
			renderPanel={({ close }) => (
				<div
					className={`absolute bottom-[calc(100%+0.5rem)] z-40 overflow-hidden border shadow-[0_18px_38px_rgba(0,0,0,0.42)] ${
						variant === "desktop"
							? "left-0 min-w-[10rem] rounded-md border-[#3c4c58] bg-[#15191b]"
							: "right-0 w-[12rem] rounded-2xl border-[#445058] bg-[#171b1d]"
					}`}
				>
					<div className="border-b border-[#3c4c58] px-3 py-2 font-label text-[9px] uppercase tracking-[0.18em] text-[#92a7b6]">
						Reasoning Effort
					</div>
					<div className="py-2">
						{options.map((option) => {
							const selected = option.id === value;
							return (
								<button
									key={option.id}
									type="button"
									className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
										selected
											? "bg-[#28353e] text-[#f8fafc]"
											: "text-[#ebf3f8] hover:bg-[#1e2428]"
									}`}
									onClick={() => {
										close();
										if (option.id !== value) {
											onChange(option.id);
										}
									}}
								>
									<span
										className={`shrink-0 ${
											selected ? "text-[#bdd5e6]" : "text-[#5e676e]"
										}`}
									>
										{materialSymbol(
											selected ? "check_circle" : "radio_button_unchecked",
											"text-[16px]",
										)}
									</span>
									<span className="min-w-0 flex-1 font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
										{option.label}
									</span>
								</button>
							);
						})}
					</div>
				</div>
			)}
		/>
	);
}

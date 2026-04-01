import type { JSX, ReactNode } from "react";
import { materialSymbol } from "./icons";

type SidebarSectionHeaderProps = {
	action?: JSX.Element | null;
	onToggle: () => void;
	open: boolean;
	title: ReactNode;
};

export function SidebarSectionHeader({
	action,
	onToggle,
	open,
	title,
}: SidebarSectionHeaderProps): JSX.Element {
	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				className="group flex min-w-0 flex-1 items-center gap-2 px-0.5 py-0.5 text-left transition-colors"
				onClick={onToggle}
				aria-expanded={open}
			>
				<span className="min-w-0 font-label text-[11px] font-bold uppercase tracking-[0.24em] text-[#8ca6b9]">
					{title}
				</span>
				<span className="ml-auto shrink-0 text-[#62737e] transition-colors group-hover:text-[#bdd5e6]">
					{materialSymbol(
						open ? "expand_more" : "chevron_right",
						"text-[16px]",
					)}
				</span>
			</button>
			{action ?? null}
		</div>
	);
}

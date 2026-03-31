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
		<div className="flex items-center gap-3">
			<button
				type="button"
				className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-[#1b1f22]"
				onClick={onToggle}
				aria-expanded={open}
			>
				<span className="shrink-0 text-[#c7dbea]">
					{materialSymbol(
						open ? "expand_more" : "chevron_right",
						"text-[18px]",
					)}
				</span>
				<span className="font-label text-[13px] font-bold uppercase tracking-[0.18em] text-[#f5f9fb]">
					{title}
				</span>
			</button>
			{action ?? null}
		</div>
	);
}

import type { ChangeEvent, JSX } from "react";
import { materialSymbol } from "./icons";

type SidebarSearchControlProps = {
	onChange: (event: ChangeEvent<HTMLInputElement>) => void;
	onClear: () => void;
	value: string;
};

export function SidebarSearchControl({
	onChange,
	onClear,
	value,
}: SidebarSearchControlProps): JSX.Element {
	return (
		<div className="px-1 pb-1 pt-2">
			<label className="block">
				<span className="sr-only">
					Search projects, threads, and git history
				</span>
				<div className="flex items-center gap-2 rounded-sm border border-[#323a3f] bg-[#111213] px-3 py-2">
					{materialSymbol("search", "text-[16px] text-[#98b9d0]")}
					<input
						className="min-w-0 flex-1 bg-transparent text-sm text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
						placeholder="Search projects, threads, and git..."
						value={value}
						onChange={onChange}
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
					/>
					{value ? (
						<button
							type="button"
							className="flex h-5 w-5 items-center justify-center rounded-sm text-[#8f8d8b] transition-colors hover:bg-[#1d2226] hover:text-[#f2f0ef]"
							onClick={onClear}
							aria-label="Clear sidebar search"
						>
							×
						</button>
					) : null}
				</div>
			</label>
		</div>
	);
}

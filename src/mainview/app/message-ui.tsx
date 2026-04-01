import { type CSSProperties, type JSX, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { BeatLoader } from "react-spinners";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { brandBoltIcon, materialSymbol } from "../controls/icons";
import type {
	GitHistoryModalState,
	MessageGroup,
	VisibleMessage,
} from "./state";
import {
	APP_TITLE,
	formatGitHistoryTimestamp,
	formatPathForDisplay,
} from "./state";

const CODE_FONT_STACK =
	'"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const codeBlockStyle = {
	margin: 0,
	border: "1px solid rgba(153, 190, 217, 0.18)",
	borderRadius: "0.5rem",
	background: "#111213",
	padding: "0.875rem 1rem",
	fontSize: "0.8125rem",
	lineHeight: "1.6",
} satisfies CSSProperties;

const codeTagStyle = {
	fontFamily: CODE_FONT_STACK,
} satisfies CSSProperties;

type DiffLine = {
	kind: "meta" | "file" | "hunk" | "context" | "add" | "remove";
	key: string;
	text: string;
};

const markdownComponents: Components = {
	a({ href, children, ...props }) {
		return (
			<a
				{...props}
				href={href}
				target="_blank"
				rel="noreferrer"
				className="text-[#c6dae9] underline decoration-[#7aa5c4] underline-offset-2 transition-colors hover:text-[#e3edf5]"
			>
				{children}
			</a>
		);
	},
	code({ children, className, node: _node, ...props }) {
		const code = String(children).replace(/\n$/, "");
		const languageMatch = /language-([\w-]+)/.exec(className ?? "");
		const isBlockCode = Boolean(languageMatch) || code.includes("\n");
		if (isBlockCode) {
			return (
				<SyntaxHighlighter
					PreTag="div"
					language={languageMatch?.[1] ?? "text"}
					style={vscDarkPlus}
					customStyle={codeBlockStyle}
					codeTagProps={{ style: codeTagStyle }}
					wrapLongLines
				>
					{code}
				</SyntaxHighlighter>
			);
		}

		return (
			<code
				{...props}
				className={`bg-[#1d2022] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[#e1ecf3] ${className ?? ""}`.trim()}
			>
				{children}
			</code>
		);
	},
	pre({ children }) {
		return <div className="my-3 overflow-x-auto">{children}</div>;
	},
	table({ children }) {
		return (
			<div className="my-3 overflow-x-auto">
				<table className="message-markdown-table">{children}</table>
			</div>
		);
	},
};

export function MarkdownMessage({ text }: { text: string }): JSX.Element {
	return (
		<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
			{text}
		</ReactMarkdown>
	);
}

export function ContextUsageMeter({
	inputTokens,
	contextWindowTokens,
}: {
	inputTokens: number;
	contextWindowTokens: number;
}): JSX.Element {
	const safeContextWindowTokens = Math.max(1, contextWindowTokens);
	const clampedInputTokens = Math.min(
		Math.max(inputTokens, 0),
		safeContextWindowTokens,
	);
	const progress = clampedInputTokens / safeContextWindowTokens;

	return (
		<div className="shrink-0">
			<div
				role="meter"
				aria-label="Context usage"
				aria-valuemin={0}
				aria-valuemax={safeContextWindowTokens}
				aria-valuenow={clampedInputTokens}
				aria-valuetext={`${inputTokens.toLocaleString()} of ${contextWindowTokens.toLocaleString()} context tokens used`}
				className="relative h-6 w-6 rounded-full border border-[#31404a]"
			>
				<div
					className="absolute inset-[1px] rounded-full"
					style={{
						background: `conic-gradient(from -90deg, #bdd5e6 0deg ${
							progress * 360
						}deg, #24313a ${progress * 360}deg 360deg)`,
					}}
				/>
				<div className="absolute inset-[4px] rounded-full bg-[#131313]" />
			</div>
		</div>
	);
}

export function isAssistantVisibleMessage(message: VisibleMessage): boolean {
	return message.kind !== "chat" || message.speaker === "assistant";
}

export function isPlainAssistantTextMessage(message: VisibleMessage): boolean {
	return (
		message.kind === "chat" &&
		message.speaker === "assistant" &&
		message.tone !== "working" &&
		message.tone !== "error" &&
		message.tone !== "notice"
	);
}

export function ProcessingMessage(): JSX.Element {
	return (
		<div className="inline-flex items-center gap-3 border border-[#31404a] bg-[#182025] px-3 py-2 text-sm text-[#dfebf3]">
			<BeatLoader color="#bdd5e6" margin={1} size={5} speedMultiplier={0.85} />
			<span>Processing</span>
		</div>
	);
}

export function ChatErrorMessage({ text }: { text: string }): JSX.Element {
	return (
		<div className="border border-[#5c2030] bg-[#2c1117] px-3 py-3 text-sm text-[#ff9db0]">
			{text}
		</div>
	);
}

export function ChatNoticeMessage({ text }: { text: string }): JSX.Element {
	return (
		<div className="border border-[#6d5930] bg-[#261f12] px-3 py-3 text-sm text-[#f2d79b]">
			{text}
		</div>
	);
}

function parseUnifiedDiff(diffText: string): DiffLine[] {
	if (!diffText.trim()) {
		return [];
	}

	return diffText.split(/\r?\n/).map((line, index) => {
		let kind: DiffLine["kind"] = "context";
		if (line.startsWith("diff --git")) {
			kind = "meta";
		} else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
			kind = "file";
		} else if (line.startsWith("@@")) {
			kind = "hunk";
		} else if (line.startsWith("+")) {
			kind = "add";
		} else if (line.startsWith("-")) {
			kind = "remove";
		}
		return {
			kind,
			key: `${index}:${line}`,
			text: line,
		};
	});
}

function commandStateLabel(
	state: "in_progress" | "completed" | "failed" | "stopped",
	exitCode: number | null,
): string {
	if (state === "in_progress") {
		return "Running";
	}
	if (state === "stopped") {
		return "Stopped";
	}
	if (state === "failed") {
		return exitCode === null ? "Failed" : `Failed (${exitCode})`;
	}
	return exitCode === null ? "Completed" : `Completed (${exitCode})`;
}

function toolCallStateLabel(
	state: "in_progress" | "completed" | "failed" | "stopped",
): string {
	if (state === "in_progress") {
		return "Running";
	}
	if (state === "stopped") {
		return "Stopped";
	}
	if (state === "failed") {
		return "Failed";
	}
	return "Completed";
}

function DiffViewer({ diffText }: { diffText: string }): JSX.Element {
	const lines = parseUnifiedDiff(diffText);
	if (lines.length === 0) {
		return (
			<div className="border border-[#252f36] bg-[#111518] px-3 py-3 text-xs text-[#7f8c95]">
				No diff available.
			</div>
		);
	}

	return (
		<div className="overflow-hidden border border-[#252f36] bg-[#111518]">
			<div
				aria-label="Diff content"
				className="app-scrollbar max-h-[28rem] overflow-auto text-[11px] leading-5"
				tabIndex={0}
			>
				{lines.map((line) => (
					<div
						key={line.key}
						className={`font-mono px-3 py-0.5 whitespace-pre-wrap ${
							line.kind === "meta"
								? "bg-[#0f1418] text-[#8aa6ba]"
								: line.kind === "file"
									? "bg-[#12191e] text-[#b7d0e1]"
									: line.kind === "hunk"
										? "bg-[#182229] text-[#f0d79a]"
										: line.kind === "add"
											? "bg-[#112118] text-[#9fe2b1]"
											: line.kind === "remove"
												? "bg-[#27141a] text-[#ffb1bf]"
												: "text-[#c9d2d8]"
						}`}
					>
						{line.text || " "}
					</div>
				))}
			</div>
		</div>
	);
}

export function ToolCallMessage({
	server,
	tool,
	argumentsText,
	output,
	state,
}: {
	server: string;
	tool: string;
	argumentsText: string;
	output: string;
	state: "in_progress" | "completed" | "failed" | "stopped";
}): JSX.Element {
	return (
		<div className="space-y-3 border border-[#2c353c] bg-[#13181b] p-4">
			<div className="flex items-center justify-between gap-4">
				<div className="min-w-0">
					<div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
						Tool Call
					</div>
					<div className="mt-1 truncate font-mono text-sm text-[#f2f0ef]">
						{tool}
					</div>
					<div className="mt-1 text-[11px] text-[#8f9aa2]">{server}</div>
				</div>
				<div className="shrink-0 border border-[#31404a] bg-[#182025] px-2 py-1 text-[10px] uppercase tracking-widest text-[#cfe0eb]">
					{toolCallStateLabel(state)}
				</div>
			</div>
			{argumentsText.trim() ? (
				<div className="space-y-2">
					<div className="font-label text-[10px] uppercase tracking-widest text-[#8ca6b9]">
						Arguments
					</div>
					<pre className="app-scrollbar max-h-[12rem] overflow-auto border border-[#252f36] bg-[#0f1316] px-3 py-3 text-[11px] leading-5 text-[#d4dde4] whitespace-pre-wrap">
						{argumentsText}
					</pre>
				</div>
			) : null}
			{output.trim() ? (
				<div className="space-y-2">
					<div className="font-label text-[10px] uppercase tracking-widest text-[#8ca6b9]">
						{state === "failed" ? "Error" : "Output"}
					</div>
					<pre className="app-scrollbar max-h-[16rem] overflow-auto border border-[#252f36] bg-[#0f1316] px-3 py-3 text-[11px] leading-5 text-[#d4dde4] whitespace-pre-wrap">
						{output}
					</pre>
				</div>
			) : null}
		</div>
	);
}

export function CommandExecutionMessage({
	command,
	output,
	state,
	exitCode,
}: {
	command: string;
	output: string;
	state: "in_progress" | "completed" | "failed" | "stopped";
	exitCode: number | null;
}): JSX.Element {
	const hasOutput = output.trim().length > 0;
	const [isExpanded, setIsExpanded] = useState(false);
	const stateLabel = commandStateLabel(state, exitCode);
	const headerContent = (
		<>
			<div className="min-w-0 text-left">
				<div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
					Command
				</div>
				<div className="mt-1 truncate font-mono text-sm text-[#f2f0ef]">
					{command}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<div className="border border-[#31404a] bg-[#182025] px-2 py-1 text-[10px] uppercase tracking-widest text-[#cfe0eb]">
					{stateLabel}
				</div>
				{hasOutput ? (
					<span className="text-[#8ca6b9]">
						{materialSymbol(
							isExpanded ? "expand_less" : "expand_more",
							"text-base",
						)}
					</span>
				) : null}
			</div>
		</>
	);

	return (
		<div className="overflow-hidden border border-[#2c353c] bg-[#13181b]">
			{hasOutput ? (
				<button
					type="button"
					className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-[#161d21] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-inset"
					onClick={() => {
						setIsExpanded((current) => !current);
					}}
					aria-expanded={isExpanded}
					aria-label={`Toggle command output for ${command}`}
				>
					{headerContent}
				</button>
			) : (
				<div className="flex items-center justify-between gap-4 px-4 py-4">
					{headerContent}
				</div>
			)}
			{hasOutput && isExpanded ? (
				<div className="px-4 pb-4">
					<pre className="app-scrollbar max-h-[16rem] overflow-auto border border-[#252f36] bg-[#0f1316] px-3 py-3 text-[11px] leading-5 text-[#d4dde4]">
						{output}
					</pre>
				</div>
			) : null}
		</div>
	);
}

export function ReasoningMessage({
	state,
	text,
}: {
	state: "in_progress" | "completed" | "stopped";
	text: string;
}): JSX.Element {
	return (
		<div className="border border-[#2a3339] bg-[#11171a] px-4 py-3">
			<div className="flex items-center justify-between gap-4">
				<div className="font-label text-[10px] uppercase tracking-widest text-[#8fb5cd]">
					Reasoning
				</div>
				<div className="text-[10px] uppercase tracking-widest text-[#70808c]">
					{state === "completed"
						? "Complete"
						: state === "stopped"
							? "Stopped"
							: "Working"}
				</div>
			</div>
			<div className="mt-2 text-sm leading-6 text-[#d6e7f2]">{text}</div>
		</div>
	);
}

function isAbsoluteLocalPath(value: string): boolean {
	return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function joinLocalPath(basePath: string, nextPath: string): string {
	if (!basePath) {
		return nextPath;
	}
	return `${basePath.replace(/[\\/]+$/, "")}/${nextPath.replace(/^[\\/]+/, "")}`;
}

function toFileHref(path: string): string {
	return path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function buildLocalFileHref(path: string, worktreePath?: string): string {
	const absolutePath =
		isAbsoluteLocalPath(path) || !worktreePath
			? path
			: joinLocalPath(worktreePath, path);
	return `/${toFileHref(absolutePath)}`;
}

export function FileChangeMessage({
	path,
	diffText,
	changeKind,
	state,
	worktreePath,
}: {
	path: string;
	diffText: string;
	changeKind: "add" | "delete" | "update";
	state: "in_progress" | "completed" | "failed" | "stopped";
	worktreePath?: string | undefined;
}): JSX.Element {
	const changeLabel =
		changeKind === "add"
			? "Added"
			: changeKind === "delete"
				? "Deleted"
				: "Updated";
	const stateLabel =
		state === "failed"
			? "Failed"
			: state === "stopped"
				? "Stopped"
				: state === "in_progress"
					? "Working"
					: changeLabel;
	const hasDiff = diffText.trim().length > 0;
	const [isExpanded, setIsExpanded] = useState(false);
	const diffRegionId = `file-change-diff-${
		path.replaceAll(/[^a-zA-Z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "") ||
		"content"
	}`;
	const toggleExpanded = (): void => {
		if (!hasDiff) {
			return;
		}
		setIsExpanded((current) => !current);
	};

	const headerContent = (
		<>
			<div className="min-w-0">
				<div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
					File Change -{" "}
					<span className="truncate font-mono text-[9px] text-[#f2f0ef]">
						{path}
					</span>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<div className="border border-[#31404a] bg-[#182025] px-2 py-1 text-[10px] uppercase tracking-widest text-[#cfe0eb]">
					{stateLabel}
				</div>
				{hasDiff ? (
					<span className="text-[#8ca6b9]">
						{materialSymbol(
							isExpanded ? "expand_less" : "expand_more",
							"text-base",
						)}
					</span>
				) : null}
			</div>
		</>
	);

	return (
		<div className="overflow-hidden border border-[#2c353c] bg-[#13181b]">
			<div className="flex items-center gap-3 px-4 py-4">
				{hasDiff ? (
					<button
						type="button"
						className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left transition-colors hover:bg-[#161d21] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-inset"
						onClick={toggleExpanded}
						aria-controls={diffRegionId}
						aria-expanded={isExpanded}
						aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${path}`}
					>
						{headerContent}
					</button>
				) : (
					<div className="flex min-w-0 flex-1 items-center justify-between gap-4">
						{headerContent}
					</div>
				)}
			</div>
			{hasDiff && isExpanded ? (
				<div className="px-4 pb-4" id={diffRegionId}>
					<DiffViewer diffText={diffText} />
				</div>
			) : null}
		</div>
	);
}

export function GitHistoryDiffModal({
	state,
	onClose,
}: {
	state: GitHistoryModalState;
	onClose: () => void;
}): JSX.Element {
	const dialogTitleId = `git-history-modal-title-${state.entry.hash}`;
	const dialogDescriptionId = `git-history-modal-description-${state.entry.hash}`;
	const dialogBodyId = `git-history-modal-body-${state.entry.hash}`;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4">
			<div
				aria-describedby={dialogDescriptionId}
				aria-labelledby={dialogTitleId}
				aria-modal="true"
				className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden border border-[#35414a] bg-[#101518] shadow-[0_24px_60px_rgba(0,0,0,0.65)]"
				role="dialog"
			>
				<div className="flex items-start justify-between gap-4 border-b border-[#2b343b] bg-[#141b1f] px-4 py-4">
					<div className="min-w-0">
						<div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
							Commit Diff
						</div>
						<div
							className="mt-1 truncate text-sm font-semibold text-[#f2f0ef]"
							id={dialogTitleId}
						>
							{state.entry.subject}
						</div>
						<div
							className="mt-1 text-[11px] text-[#8f9aa2]"
							id={dialogDescriptionId}
						>
							{state.entry.shortHash} · {state.entry.authorName} ·{" "}
							{formatGitHistoryTimestamp(state.entry.committedAt)}
						</div>
					</div>
					<button
						type="button"
						aria-label="Close commit diff"
						className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#303940] bg-[#1a2025] text-[#acb8c1] transition-colors hover:bg-[#242d33] hover:text-[#f2f0ef]"
						onClick={onClose}
					>
						×
					</button>
				</div>
				<div
					className="app-scrollbar flex-1 overflow-auto px-4 py-4"
					id={dialogBodyId}
					tabIndex={0}
				>
					{state.loading ? (
						<div className="border border-[#283239] bg-[#151b20] px-3 py-3 text-sm text-[#d4e4ef]">
							Loading diff...
						</div>
					) : state.error ? (
						<div className="border border-[#5c2030] bg-[#2c1117] px-3 py-3 text-sm text-[#ff9db0]">
							{state.error}
						</div>
					) : (
						<DiffViewer diffText={state.diffText} />
					)}
				</div>
			</div>
		</div>
	);
}

export function DesktopMessageGroups({
	groups,
	localUserLabel,
	renderAssistantMessageContent,
}: {
	groups: MessageGroup[];
	localUserLabel: string;
	renderAssistantMessageContent: (message: VisibleMessage) => JSX.Element;
}): JSX.Element {
	return (
		<>
			{groups.map((group) => {
				if (group.kind === "assistant") {
					return (
						<div
							className="group flex w-full min-w-0 items-start gap-6"
							key={group.key}
						>
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-[#adcbe0]">
								{brandBoltIcon("text-sm text-[#224259]")}
							</div>
							<div className="min-w-0 flex-1 space-y-4">
								<div className="font-label text-[10px] font-bold uppercase tracking-widest text-[#bdd5e6]">
									{APP_TITLE}
								</div>
								<div className="space-y-3">
									{group.messages.map(({ message, index }) => (
										<div
											className={`min-w-0 ${
												isPlainAssistantTextMessage(message) ? "py-3" : ""
											}`}
											key={`${message.kind}-${index}`}
										>
											<div className="min-w-0 max-w-full text-sm leading-relaxed text-[#ffffff]">
												{renderAssistantMessageContent(message)}
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					);
				}

				return (
					<div
						className="flex w-full min-w-0 justify-end gap-6"
						key={group.key}
					>
						<div className="min-w-0 w-full max-w-2xl space-y-3 text-right">
							<div className="font-body text-[13px] font-semibold tracking-[0.01em] text-[#b7b3b1]">
								{localUserLabel}
							</div>
							<div className="ml-auto max-w-full overflow-hidden bg-[#262626] p-4 text-left text-sm text-[#ffffff]">
								<MarkdownMessage text={group.text} />
							</div>
						</div>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#262626]">
							<span className="material-symbols-outlined text-[18px] text-[#b7b3b1]">
								person
							</span>
						</div>
					</div>
				);
			})}
		</>
	);
}

export function MobileMessageGroups({
	groups,
	localUserLabel,
	renderAssistantMessageContent,
}: {
	groups: MessageGroup[];
	localUserLabel: string;
	renderAssistantMessageContent: (message: VisibleMessage) => JSX.Element;
}): JSX.Element {
	return (
		<>
			{groups.map((group) => {
				if (group.kind === "assistant") {
					return (
						<div
							className="flex max-w-full flex-col items-start gap-3"
							key={group.key}
						>
							<div className="flex items-center gap-2 px-1 text-[#bdd5e6]">
								{brandBoltIcon("text-sm")}
								<span className="text-[10px] font-label font-bold uppercase tracking-wider">
									{APP_TITLE}
								</span>
							</div>
							<div className="flex w-full flex-col gap-3">
								{group.messages.map(({ message, index }) => (
									<div
										className={`w-full ${
											isPlainAssistantTextMessage(message) ? "py-3" : ""
										}`}
										key={`${message.kind}-${index}`}
									>
										<div className="glass-panel flex w-full flex-col gap-4 border border-[#bdd5e6]/10 p-5">
											<div className="text-sm leading-relaxed text-[#ffffff]">
												{renderAssistantMessageContent(message)}
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					);
				}

				return (
					<div
						className="flex max-w-[90%] self-end flex-col items-end gap-2"
						key={group.key}
					>
						<div className="flex items-center gap-2 px-1 text-[#b7b3b1]">
							<span className="font-body text-[13px] font-semibold tracking-[0.01em]">
								{localUserLabel}
							</span>
							<span className="material-symbols-outlined text-sm text-[#9f9b99]">
								account_circle
							</span>
						</div>
						<div className="rounded-tr-none bg-[#1f2020] p-4 text-sm leading-relaxed text-[#ffffff] shadow-sm">
							<MarkdownMessage text={group.text} />
						</div>
					</div>
				);
			})}
		</>
	);
}

export function ErrorPreviewPopover({
	text,
	x,
	y,
}: {
	text: string;
	x: number;
	y: number;
}): JSX.Element {
	return (
		<div
			className="pointer-events-none fixed z-[110] max-w-[22rem] rounded-md border border-[#7a2030] bg-[#341019]/96 px-3 py-2 text-xs leading-5 text-[#ffb1bf] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm"
			style={{
				left: x,
				top: y,
			}}
		>
			<div className="mb-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#ff8698]">
				Error Preview
			</div>
			<div className="whitespace-pre-wrap break-words">{text}</div>
		</div>
	);
}

export function ThreadSummaryPopover({
	title,
	summary,
	x,
	y,
}: {
	title: string;
	summary: string;
	x: number;
	y: number;
}): JSX.Element {
	return (
		<div
			className="pointer-events-none fixed z-[108] hidden max-w-[22rem] rounded-md border border-[#31404a] bg-[#13191d]/96 px-3 py-3 text-xs leading-5 text-[#d6e7f2] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm md:block"
			style={{
				left: x,
				top: y,
			}}
		>
			<div className="mb-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#8fb5cd]">
				Thread Summary
			</div>
			<div className="mb-2 text-sm font-semibold text-[#f2f0ef]">{title}</div>
			<div className="whitespace-pre-wrap break-words text-[#bfd1dc]">
				{summary}
			</div>
		</div>
	);
}

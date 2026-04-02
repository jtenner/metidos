import {
  type CSSProperties,
  type FormEvent,
  type JSX,
  type RefObject,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
  RpcProjectTask,
} from "../../bun/rpc-schema";
import { ChatComposerControl } from "../controls/chat-composer-control";
import { CodexModelSelector } from "../controls/codex-model-selector";
import { brandBoltIcon, materialSymbol } from "../controls/icons";
import { ProjectTaskSelector } from "../controls/project-task-selector";
import { ReasoningEffortSelector } from "../controls/reasoning-effort-selector";
import {
  ChatErrorMessage,
  ChatNoticeMessage,
  CommandExecutionMessage,
  ContextUsageMeter,
  FileChangeMessage,
  MarkdownMessage,
  ProcessingMessage,
  ReasoningMessage,
  ToolCallMessage,
  isAssistantVisibleMessage,
  isPlainAssistantTextMessage,
} from "./message-ui";
import { APP_TITLE, type MessageGroup, type VisibleMessage } from "./state";

type SharedChatControlsProps = {
  activeCodexModel: string;
  activeReasoningEffort: RpcCodexReasoningEffort;
  activeUnsafeMode: boolean;
  composerActionDisabled: boolean;
  composerActionLabel: string;
  composerDisabled: boolean;
  hasSelectedThread: boolean;
  initialChatInput: string;
  isLoadingProjectTasks: boolean;
  isWorking: boolean;
  modelControlError: string;
  modelSelectorDisabled: boolean;
  onChangeModel: (value: string) => void;
  onChangeReasoningEffort: (value: RpcCodexReasoningEffort) => void;
  onChangeUnsafeMode: (value: boolean) => void;
  onSelectTask: (task: RpcProjectTask) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitMessage: () => void;
  projectTasks: RpcProjectTask[];
  reasoningEffortControlError: string;
  reasoningEffortSelectorDisabled: boolean;
  reasoningEfforts: RpcCodexReasoningEffortOption[];
  taskControlError: string;
  taskSelectorDisabled: boolean;
  unsafeModeControlError: string;
  unsafeModeToggleDisabled: boolean;
  codexModels: RpcCodexModelOption[];
};

type TranscriptProps = {
  localUserLabel: string;
  messages: VisibleMessage[];
  selectedWorktreePath: string | null;
  variant: "desktop" | "mobile";
};

type UnsafeModeToggleProps = {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  variant: "desktop" | "mobile";
};

function UnsafeModeToggle({
  checked,
  disabled,
  onChange,
  variant,
}: UnsafeModeToggleProps): JSX.Element {
  const compact = variant === "mobile";
  return (
    <label
      className={[
        "inline-flex items-center gap-2 rounded-full border transition-colors",
        compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
        checked
          ? "border-[#d89256] bg-[#2d1d12] text-[#ffd3a6]"
          : "border-[#3d3d3d] bg-[#171717] text-[#b3afad]",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
      title="Uses the danger-full-access sandbox for this thread. This app applies it per thread, not per message."
    >
      <input
        checked={checked}
        className="h-3.5 w-3.5 accent-[#d89256]"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span className="font-body text-[0.68rem] font-semibold uppercase tracking-[0.18em]">
        Unsafe
      </span>
    </label>
  );
}

function ChatTranscript({
  localUserLabel,
  messages,
  selectedWorktreePath,
  variant,
}: TranscriptProps): JSX.Element {
  const groupedMessages = useMemo<MessageGroup[]>(() => {
    const groups: MessageGroup[] = [];

    messages.forEach((message, index) => {
      if (isAssistantVisibleMessage(message)) {
        const lastGroup = groups.at(-1);
        const nextMessage = { index, message };
        if (lastGroup?.kind === "assistant") {
          lastGroup.messages.push(nextMessage);
          return;
        }
        groups.push({
          kind: "assistant",
          key: `assistant-${index}`,
          messages: [nextMessage],
        });
        return;
      }

      groups.push({
        kind: "user",
        key: `user-${index}`,
        text: message.kind === "chat" ? message.text : "",
      });
    });

    return groups;
  }, [messages]);

  const renderAssistantMessageContent = (
    message: VisibleMessage,
  ): JSX.Element => {
    if (message.kind === "chat") {
      if (message.tone === "working") {
        return <ProcessingMessage />;
      }
      if (message.tone === "error") {
        return <ChatErrorMessage text={message.text} />;
      }
      if (message.tone === "notice") {
        return <ChatNoticeMessage text={message.text} />;
      }
      return <MarkdownMessage text={message.text} />;
    }
    if (message.kind === "reasoning") {
      return <ReasoningMessage state={message.state} text={message.text} />;
    }
    if (message.kind === "command") {
      return (
        <CommandExecutionMessage
          command={message.command}
          exitCode={message.exitCode}
          output={message.output}
          state={message.state}
        />
      );
    }
    if (message.kind === "tool_call") {
      return (
        <ToolCallMessage
          argumentsText={message.argumentsText}
          output={message.output}
          server={message.server}
          state={message.state}
          tool={message.tool}
        />
      );
    }
    return (
      <FileChangeMessage
        changeKind={message.changeKind}
        diffText={message.diffText}
        path={message.path}
        state={message.state}
        worktreePath={selectedWorktreePath ?? undefined}
      />
    );
  };

  if (variant === "desktop") {
    return (
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-10">
        {groupedMessages.map((group) => {
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
                <div className="ml-auto max-w-full overflow-hidden rounded-sm bg-[#262626] p-4 text-left text-sm text-[#ffffff]">
                  <MarkdownMessage text={group.text} />
                </div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#262626]">
                {materialSymbol("person")}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {groupedMessages.map((group) => {
        if (group.kind === "assistant") {
          return (
            <div
              className="flex w-full max-w-full flex-col items-start gap-1.5"
              key={group.key}
            >
              <div className="flex items-center gap-2 px-[2px] text-[#bdd5e6]">
                {brandBoltIcon("text-sm")}
                <span className="text-[10px] font-label font-bold uppercase tracking-wider">
                  {APP_TITLE}
                </span>
              </div>
              <div
                className="flex w-full flex-col"
                style={{ gap: `${MOBILE_CHAT_ITEM_GAP_PX}px` }}
              >
                {group.messages.map(({ message, index }) => {
                  if (isPlainAssistantTextMessage(message)) {
                    return (
                      <div
                        className="w-full bg-[#262a2d] px-[10px] py-[10px]"
                        key={`${message.kind}-${index}`}
                      >
                        <div className="text-sm leading-relaxed text-[#ffffff]">
                          {renderAssistantMessageContent(message)}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="w-full" key={`${message.kind}-${index}`}>
                      {renderAssistantMessageContent(message)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div
            className="flex max-w-[92%] self-end flex-col items-end gap-1.5"
            key={group.key}
          >
            <div className="flex items-center gap-2 px-[2px] text-[#b7b3b1]">
              <span className="font-body text-[13px] font-semibold tracking-[0.01em]">
                {localUserLabel}
              </span>
              {materialSymbol("account_circle", "text-sm text-[#9f9b99]")}
            </div>
            <div className="w-fit max-w-full bg-[#30353a] px-[10px] py-[10px] text-sm leading-relaxed text-[#ffffff] shadow-sm">
              <MarkdownMessage text={group.text} />
            </div>
          </div>
        );
      })}
    </>
  );
}

type DesktopChatViewProps = SharedChatControlsProps & {
  activeContextInputTokens: number;
  activeContextWindowTokens: number;
  activeScreenSubtitlePrimary: string;
  activeScreenSubtitleSecondary: string;
  activeScreenTitle: string;
  chatScrollRef: RefObject<HTMLDivElement | null>;
  localUserLabel: string;
  onChatScroll: (event: UIEvent<HTMLDivElement>) => void;
  selectedThreadIsWorking: boolean;
  selectedWorktreePath: string | null;
};

export function DesktopChatView({
  activeCodexModel,
  activeContextInputTokens,
  activeContextWindowTokens,
  activeReasoningEffort,
  activeUnsafeMode,
  activeScreenSubtitlePrimary,
  activeScreenSubtitleSecondary,
  activeScreenTitle,
  chatScrollRef,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  hasSelectedThread,
  initialChatInput,
  isLoadingProjectTasks,
  isWorking,
  localUserLabel,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeUnsafeMode,
  onChatScroll,
  onSelectTask,
  onSubmit,
  onSubmitMessage,
  projectTasks,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  selectedWorktreePath,
  taskControlError,
  taskSelectorDisabled,
  unsafeModeControlError,
  unsafeModeToggleDisabled,
  messages,
}: DesktopChatViewProps & { messages: VisibleMessage[] }): JSX.Element {
  return (
    <>
      <div
        ref={chatScrollRef}
        className="flex-1 space-y-8 overflow-y-auto px-6 py-8 hide-scrollbar"
        onScroll={onChatScroll}
      >
        <div className="mx-auto mb-12 max-w-4xl">
          <h1 className="mb-2 font-headline text-4xl font-extrabold tracking-tight text-[#ffffff]">
            {activeScreenTitle}
          </h1>
          <p className="max-w-2xl font-body text-sm text-[#b3afad]">
            <span className="text-[#ddd8d5]">
              {activeScreenSubtitlePrimary}
            </span>
            <span className="text-[#7f7c79]">
              {" "}
              | {activeScreenSubtitleSecondary}
            </span>
          </p>
        </div>
        <ChatTranscript
          localUserLabel={localUserLabel}
          messages={messages}
          selectedWorktreePath={selectedWorktreePath}
          variant="desktop"
        />
      </div>
      <form
        className="border-t border-[#262626] bg-[#131313] p-6"
        onSubmit={onSubmit}
      >
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center gap-2 border-b border-[#484848]/10 p-2">
            <div className="min-w-[15rem] max-w-[22rem]">
              <CodexModelSelector
                models={codexModels}
                value={activeCodexModel}
                disabled={modelSelectorDisabled}
                onChange={onChangeModel}
                variant="desktop"
              />
            </div>
            <div className="min-w-[7.5rem] max-w-[8.5rem]">
              <ReasoningEffortSelector
                options={reasoningEfforts}
                value={activeReasoningEffort}
                disabled={reasoningEffortSelectorDisabled}
                onChange={onChangeReasoningEffort}
                variant="desktop"
              />
            </div>
            <ProjectTaskSelector
              tasks={projectTasks}
              loading={isLoadingProjectTasks}
              disabled={taskSelectorDisabled}
              onSelect={onSelectTask}
              variant="desktop"
            />
            <UnsafeModeToggle
              checked={activeUnsafeMode}
              disabled={unsafeModeToggleDisabled}
              onChange={onChangeUnsafeMode}
              variant="desktop"
            />
            <div className="flex-1" />
            <ContextUsageMeter
              inputTokens={activeContextInputTokens}
              contextWindowTokens={activeContextWindowTokens}
            />
          </div>
          {modelControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {modelControlError}
            </div>
          ) : null}
          {reasoningEffortControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {reasoningEffortControlError}
            </div>
          ) : null}
          {taskControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {taskControlError}
            </div>
          ) : null}
          {unsafeModeControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {unsafeModeControlError}
            </div>
          ) : null}
          <ChatComposerControl
            actionDisabled={composerActionDisabled}
            actionLabel={composerActionLabel}
            disabled={composerDisabled}
            hasSelectedThread={hasSelectedThread}
            initialValue={initialChatInput}
            isWorking={selectedThreadIsWorking || isWorking}
            onSubmitMessage={onSubmitMessage}
            variant="desktop"
          />
        </div>
      </form>
    </>
  );
}

type MobileChatViewProps = SharedChatControlsProps & {
  activeScreenSubtitlePrimary: string;
  activeScreenSubtitleSecondary: string;
  activeScreenTitle: string;
  chatScrollRef: RefObject<HTMLDivElement | null>;
  localUserLabel: string;
  onChatScroll: (event: UIEvent<HTMLDivElement>) => void;
  selectedThreadIsWorking: boolean;
  selectedWorktreePath: string | null;
};

const MOBILE_CHAT_COMPOSER_GAP_PX = 34;
const MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX = 224;
const MOBILE_CHAT_ITEM_GAP_PX = 10;
const MOBILE_CHAT_SIDE_INSET_PX = 10;
const MOBILE_CHAT_PARENT_SIDE_PADDING_PX = 16;
const MOBILE_CHAT_SIDE_BLEED_PX =
  MOBILE_CHAT_PARENT_SIDE_PADDING_PX - MOBILE_CHAT_SIDE_INSET_PX;

export function MobileChatView({
  activeCodexModel,
  activeReasoningEffort,
  activeUnsafeMode,
  activeScreenSubtitlePrimary,
  activeScreenSubtitleSecondary,
  activeScreenTitle,
  chatScrollRef,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  hasSelectedThread,
  initialChatInput,
  isLoadingProjectTasks,
  isWorking,
  localUserLabel,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeUnsafeMode,
  onChatScroll,
  onSelectTask,
  onSubmit,
  onSubmitMessage,
  projectTasks,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  selectedWorktreePath,
  taskControlError,
  taskSelectorDisabled,
  unsafeModeControlError,
  unsafeModeToggleDisabled,
  messages,
}: MobileChatViewProps & { messages: VisibleMessage[] }): JSX.Element {
  const footerRef = useRef<HTMLElement | null>(null);
  const [composerInsetPx, setComposerInsetPx] = useState(
    MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX,
  );

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const updateComposerInset = (): void => {
      setComposerInsetPx(
        Math.max(
          MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX,
          Math.ceil(footer.getBoundingClientRect().height) +
            MOBILE_CHAT_COMPOSER_GAP_PX,
        ),
      );
    };

    updateComposerInset();

    const resizeObserver = new ResizeObserver(() => {
      updateComposerInset();
    });
    resizeObserver.observe(footer);
    window.addEventListener("resize", updateComposerInset);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateComposerInset);
    };
  }, []);

  const chatScrollStyle: CSSProperties = {
    marginLeft: `-${MOBILE_CHAT_SIDE_BLEED_PX}px`,
    marginRight: `-${MOBILE_CHAT_SIDE_BLEED_PX}px`,
    paddingLeft: `${MOBILE_CHAT_SIDE_INSET_PX}px`,
    paddingRight: `${MOBILE_CHAT_SIDE_INSET_PX}px`,
    paddingTop: `${MOBILE_CHAT_ITEM_GAP_PX}px`,
    paddingBottom: `${composerInsetPx}px`,
    scrollPaddingBottom: `${composerInsetPx}px`,
  };

  return (
    <>
      <div className="mt-6 shrink-0">
        <h2 className="font-headline text-[1.85rem] font-extrabold leading-tight tracking-tight text-[#ffffff]">
          {activeScreenTitle}
        </h2>
        <p className="mt-2 text-xs text-[#b3afad]">
          <span className="text-[#ddd8d5]">{activeScreenSubtitlePrimary}</span>
          <span className="text-[#7f7c79]">
            {" "}
            | {activeScreenSubtitleSecondary}
          </span>
        </p>
      </div>
      <div
        ref={chatScrollRef}
        className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto hide-scrollbar"
        onScroll={onChatScroll}
        style={chatScrollStyle}
      >
        <ChatTranscript
          localUserLabel={localUserLabel}
          messages={messages}
          selectedWorktreePath={selectedWorktreePath}
          variant="mobile"
        />
      </div>
      <footer
        aria-label="Chat composer"
        className="fixed bottom-16 left-0 right-0 z-40 px-[10px] pb-[10px]"
        ref={footerRef}
      >
        <form
          className="mx-auto flex max-w-2xl flex-col gap-3"
          onSubmit={onSubmit}
        >
          <div className="overflow-visible border border-[#384249] bg-[#181b1e] shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
            <div className="border-b border-[#313a40] px-2 py-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <CodexModelSelector
                      models={codexModels}
                      value={activeCodexModel}
                      disabled={modelSelectorDisabled}
                      onChange={onChangeModel}
                      variant="mobile"
                    />
                  </div>
                  <div className="w-[6.75rem] shrink-0">
                    <ReasoningEffortSelector
                      options={reasoningEfforts}
                      value={activeReasoningEffort}
                      disabled={reasoningEffortSelectorDisabled}
                      onChange={onChangeReasoningEffort}
                      variant="mobile"
                    />
                  </div>
                  <ProjectTaskSelector
                    tasks={projectTasks}
                    loading={isLoadingProjectTasks}
                    disabled={taskSelectorDisabled}
                    onSelect={onSelectTask}
                    variant="mobile"
                  />
                </div>
                <div className="flex items-center justify-end">
                  <UnsafeModeToggle
                    checked={activeUnsafeMode}
                    disabled={unsafeModeToggleDisabled}
                    onChange={onChangeUnsafeMode}
                    variant="mobile"
                  />
                </div>
              </div>
            </div>
            <ChatComposerControl
              actionDisabled={composerActionDisabled}
              actionLabel={composerActionLabel}
              disabled={composerDisabled}
              hasSelectedThread={hasSelectedThread}
              initialValue={initialChatInput}
              isWorking={selectedThreadIsWorking || isWorking}
              onSubmitMessage={onSubmitMessage}
              variant="mobile"
            />
          </div>
          {modelControlError ? (
            <div className="text-xs text-[#ff6e84]">{modelControlError}</div>
          ) : null}
          {reasoningEffortControlError ? (
            <div className="text-xs text-[#ff6e84]">
              {reasoningEffortControlError}
            </div>
          ) : null}
          {taskControlError ? (
            <div className="text-xs text-[#ff6e84]">{taskControlError}</div>
          ) : null}
          {unsafeModeControlError ? (
            <div className="text-xs text-[#ff6e84]">
              {unsafeModeControlError}
            </div>
          ) : null}
        </form>
      </footer>
    </>
  );
}

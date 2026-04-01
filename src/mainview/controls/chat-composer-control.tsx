import {
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  APP_TITLE,
  COMPOSER_MAX_HEIGHT_PX,
  DESKTOP_COMPOSER_MIN_HEIGHT_PX,
  MOBILE_COMPOSER_MIN_HEIGHT_PX,
  patchPersistedMainviewState,
  resizeComposerTextarea,
} from "../app/state";
import { materialSymbol } from "./icons";

type ChatComposerControlProps = {
  actionDisabled: boolean;
  actionLabel: string;
  disabled: boolean;
  hasSelectedThread: boolean;
  initialValue: string;
  isWorking: boolean;
  onSubmitMessage: () => void;
  variant: "desktop" | "mobile";
};

const draftListeners = new Set<() => void>();

let chatComposerDraft = "";
let chatComposerDraftInitialized = false;

function emitDraftChange(): void {
  for (const listener of draftListeners) {
    listener();
  }
}

function subscribeToChatComposerDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

function getChatComposerDraftSnapshot(): string {
  return chatComposerDraft;
}

function useChatComposerDraft(initialValue: string): string {
  const draft = useSyncExternalStore(
    subscribeToChatComposerDraft,
    getChatComposerDraftSnapshot,
    getChatComposerDraftSnapshot,
  );

  useEffect(() => {
    initializeChatComposerDraft(initialValue);
  }, [initialValue]);

  return chatComposerDraftInitialized ? draft : initialValue;
}

export function initializeChatComposerDraft(initialValue: string): void {
  if (chatComposerDraftInitialized) {
    return;
  }

  chatComposerDraft = initialValue;
  chatComposerDraftInitialized = true;
}

export function readChatComposerDraft(fallback = ""): string {
  return chatComposerDraftInitialized ? chatComposerDraft : fallback;
}

export function setChatComposerDraft(nextValue: string): void {
  if (chatComposerDraftInitialized && chatComposerDraft === nextValue) {
    return;
  }

  chatComposerDraft = nextValue;
  chatComposerDraftInitialized = true;
  patchPersistedMainviewState({
    chatInput: nextValue,
  });
  emitDraftChange();
}

export function ChatComposerControl({
  actionDisabled,
  actionLabel,
  disabled,
  hasSelectedThread,
  initialValue,
  isWorking,
  onSubmitMessage,
  variant,
}: ChatComposerControlProps): JSX.Element {
  const draft = useChatComposerDraft(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const minHeightPx =
    variant === "desktop"
      ? DESKTOP_COMPOSER_MIN_HEIGHT_PX
      : MOBILE_COMPOSER_MIN_HEIGHT_PX;
  const placeholder = hasSelectedThread
    ? variant === "desktop"
      ? `Ask ${APP_TITLE} to generate, refactor, or debug...`
      : `Ask ${APP_TITLE}...`
    : variant === "desktop"
      ? `Create a thread to start chatting with ${APP_TITLE}...`
      : `Create a thread to chat with ${APP_TITLE}...`;

  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== draft) {
      return;
    }
    resizeComposerTextarea(textareaRef.current, minHeightPx);
  }, [draft, minHeightPx]);

  const onChatInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setChatComposerDraft(event.currentTarget.value);
      resizeComposerTextarea(event.currentTarget, minHeightPx);
    },
    [minHeightPx],
  );

  const onEnter = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        if (!event.shiftKey && !event.altKey) {
          onSubmitMessage();
        }
      }
    },
    [onSubmitMessage],
  );

  if (variant === "desktop") {
    return (
      <div className="relative flex items-end gap-4 rounded-sm border border-[#2b2b2b] bg-[#262626] p-4">
        <textarea
          ref={textareaRef}
          className="flex-1 resize-none overflow-y-auto border-none bg-transparent px-2 font-body text-sm leading-6 placeholder:text-[#adabaa]/50 focus:ring-0"
          placeholder={placeholder}
          rows={3}
          style={{
            minHeight: `${DESKTOP_COMPOSER_MIN_HEIGHT_PX}px`,
            maxHeight: `${COMPOSER_MAX_HEIGHT_PX}px`,
          }}
          value={draft}
          onChange={onChatInputChange}
          onKeyDown={onEnter}
          disabled={disabled}
        />
        <button
          type="submit"
          className={`flex h-10 w-10 items-center justify-center transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
            isWorking
              ? "bg-[#4b2028] text-[#ffd4da]"
              : "bg-[#bdd5e6] text-[#2e526b]"
          }`}
          disabled={actionDisabled}
          aria-label={actionLabel}
          title={actionLabel}
        >
          {materialSymbol(isWorking ? "stop" : "arrow_forward")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-end gap-2 bg-[#181b1e] px-2 py-2">
      <textarea
        ref={textareaRef}
        className="min-h-0 flex-grow resize-none overflow-y-auto border border-[#333c43] bg-[#1e2123] px-3 py-2 text-sm leading-6 text-[#ffffff] placeholder:text-[#adabaa]/50 focus:border-[#9fc1da] focus:outline-none"
        placeholder={placeholder}
        rows={1}
        style={{
          minHeight: `${MOBILE_COMPOSER_MIN_HEIGHT_PX}px`,
          maxHeight: `${COMPOSER_MAX_HEIGHT_PX}px`,
        }}
        value={draft}
        onChange={onChatInputChange}
        onKeyDown={onEnter}
        disabled={disabled}
      />
      <button
        className={`flex items-center justify-center p-2 shadow-lg transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
          isWorking
            ? "bg-[#4b2028] text-[#ffd4da]"
            : "bg-gradient-to-tr from-[#bdd5e6] to-[#adcbe0] text-[#224259]"
        }`}
        type="submit"
        disabled={actionDisabled}
        aria-label={actionLabel}
        title={actionLabel}
      >
        {materialSymbol(isWorking ? "stop" : "arrow_upward")}
      </button>
    </div>
  );
}

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

/**
 * Global draft listeners for cross-component updates to the composer value.
 * A tiny external store is used here so the textarea can be kept in sync across
 * lifecycle resets and submission flows without lifting state higher.
 */
const draftListeners = new Set<() => void>();

let chatComposerDraft = "";
let chatComposerDraftInitialized = false;

/**
 * Notify every subscriber that the shared chat draft changed.
 */
function emitDraftChange(): void {
  for (const listener of draftListeners) {
    listener();
  }
}

/**
 * Subscribe to draft changes for `useSyncExternalStore` consumers.
 */
function subscribeToChatComposerDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

/**
 * Snapshot accessor for the external draft store.
 */
function getChatComposerDraftSnapshot(): string {
  return chatComposerDraft;
}

/**
 * Read the shared draft via `useSyncExternalStore`, initializing from `initialValue` on mount.
 */
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

/**
 * Initialize the draft value exactly once from bootstrap state.
 * This avoids replacing existing user input with fallback values on remounts.
 */
export function initializeChatComposerDraft(initialValue: string): void {
  if (chatComposerDraftInitialized) {
    return;
  }

  chatComposerDraft = initialValue;
  chatComposerDraftInitialized = true;
}

/**
 * Read the draft, with a fallback for callers before initialization.
 */
export function readChatComposerDraft(fallback = ""): string {
  return chatComposerDraftInitialized ? chatComposerDraft : fallback;
}

/**
 * Update the draft value and persist it to `mainview` state storage.
 * Duplicate assignments are ignored to avoid needless rerenders and storage writes.
 */
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

/**
 * Chat input control used in both desktop and mobile sidebars.
 * Applies variant-specific layout and submit keyboard behavior.
 */
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
  /**
   * Shared draft state for desktop and mobile variants.
   */
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
    // Only resize when the DOM value is already aligned with controlled draft state.
    // During transitional updates, skipping prevents cursor jumps and stale measurements.
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
      // Only treat Enter with modifier keys as explicit "send". Plain Enter preserves
      // line breaks; IME composition completion is ignored here.
      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        // Shift/Alt + Enter remains multiline; plain Cmd/Ctrl+Enter sends.
        if (!event.shiftKey && !event.altKey) {
          onSubmitMessage();
        }
      }
    },
    [onSubmitMessage],
  );

  // Separate rendering branches keep spacing, sizing, and submit affordances tuned
  // for mouse/keyboard desktop usage vs touch-optimized mobile UX.
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

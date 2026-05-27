/**
 * @file src/mainview/controls/chat-composer-autosize.ts
 * @description Textarea autosizing helpers for the chat composer.
 */

type TextareaCaretMirror = {
  marker: HTMLSpanElement;
  mirror: HTMLDivElement;
  textSpan: HTMLSpanElement;
};

type HotImportMeta = ImportMeta & {
  hot?: {
    dispose: (callback: () => void) => void;
  };
};

let cachedTextareaCaretMirror: TextareaCaretMirror | null = null;

export function disposeTextareaCaretMirror(): void {
  if (cachedTextareaCaretMirror === null) {
    return;
  }
  cachedTextareaCaretMirror.textSpan.textContent = "";
  cachedTextareaCaretMirror.marker.textContent = "";
  cachedTextareaCaretMirror.mirror.remove();
  cachedTextareaCaretMirror = null;
}

function installTextareaCaretMirrorLifecycle(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("pagehide", disposeTextareaCaretMirror);
  window.addEventListener("beforeunload", disposeTextareaCaretMirror);
  return () => {
    window.removeEventListener("pagehide", disposeTextareaCaretMirror);
    window.removeEventListener("beforeunload", disposeTextareaCaretMirror);
  };
}

const removeTextareaCaretMirrorLifecycle =
  installTextareaCaretMirrorLifecycle();

(import.meta as HotImportMeta).hot?.dispose(() => {
  removeTextareaCaretMirrorLifecycle();
  disposeTextareaCaretMirror();
});

function getTextareaCaretMirror(): TextareaCaretMirror {
  if (cachedTextareaCaretMirror !== null) {
    return cachedTextareaCaretMirror;
  }

  const mirror = document.createElement("div");
  const textSpan = document.createElement("span");
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(textSpan);
  mirror.appendChild(marker);

  cachedTextareaCaretMirror = {
    marker,
    mirror,
    textSpan,
  };
  return cachedTextareaCaretMirror;
}

/**
 * Resize textarea to fit content while respecting a minimum height floor and CSS max-height.
 */
export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement | null,
  minHeight: number,
): void {
  if (!textarea) {
    return;
  }
  textarea.style.height = "auto";

  const computedMaxHeight = window.getComputedStyle(textarea).maxHeight;
  const maxHeight = Number.parseFloat(computedMaxHeight);
  const desiredHeight = Math.max(textarea.scrollHeight, minHeight);
  const nextHeight = Number.isFinite(maxHeight)
    ? Math.min(desiredHeight, maxHeight)
    : desiredHeight;
  textarea.style.height = `${nextHeight}px`;
}

/**
 * Computes viewport coordinates for the caret in a textarea by mirroring the
 * text content up to the cursor in a hidden element with identical styling.
 */
export function getTextareaCaretViewportPosition(
  textarea: HTMLTextAreaElement,
): {
  x: number;
  y: number;
  height: number;
} {
  const textBeforeCursor = textarea.value.slice(0, textarea.selectionStart);
  const computed = window.getComputedStyle(textarea);
  const textareaRect = textarea.getBoundingClientRect();

  if (!document.body) {
    // The composer only calls this from mounted browser event handlers, but a
    // defensive fallback keeps tests/pre-DOM bootstraps from crashing if a
    // caller asks for caret geometry before <body> is available.
    return {
      height: parseFloat(computed.lineHeight) || textareaRect.height,
      x: textareaRect.left,
      y: textareaRect.top,
    };
  }

  const { marker, mirror, textSpan } = getTextareaCaretMirror();
  mirror.style.position = "fixed";
  mirror.style.left = `${textareaRect.left}px`;
  mirror.style.top = `${textareaRect.top}px`;
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflowWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.width = `${textareaRect.width}px`;
  mirror.style.height = `${textareaRect.height}px`;
  mirror.style.font = computed.font;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.textTransform = computed.textTransform;
  mirror.style.textIndent = computed.textIndent;
  mirror.style.textAlign = computed.textAlign;
  mirror.style.tabSize = computed.tabSize;
  mirror.style.padding = computed.padding;
  mirror.style.border = computed.border;
  mirror.style.boxSizing = computed.boxSizing;
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
  textSpan.textContent = textBeforeCursor;
  document.body.appendChild(mirror);

  try {
    const markerRect = marker.getBoundingClientRect();
    const height = parseFloat(computed.lineHeight) || markerRect.height;

    return { x: markerRect.left, y: markerRect.top, height };
  } finally {
    textSpan.textContent = "";
    mirror.remove();
  }
}

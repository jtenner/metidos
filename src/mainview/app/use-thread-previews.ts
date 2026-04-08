/**
 * @file src/mainview/app/use-thread-previews.ts
 * @description Module for use thread previews.
 */

import type {
  HTMLAttributes,
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampProjectMenuCoordinate,
  type ErrorPreviewPopoverState,
  type ThreadSummaryPopoverState,
} from "./state";

/**
 * Performs anchorStillActive operation.
 * @param anchorId - anchorId identifier.
 */

function anchorStillActive(anchorId: string): boolean {
  // Treat anchor as active when hovered or focus is on it/inside it; otherwise hide popovers.
  if (typeof document === "undefined") {
    return false;
  }

  const anchor = document.getElementById(anchorId);
  if (!(anchor instanceof HTMLElement)) {
    return false;
  }

  const activeElement = document.activeElement;
  return (
    anchor.matches(":hover") ||
    anchor === activeElement ||
    anchor.contains(activeElement)
  );
}

type UseThreadPreviewsOptions = {
  /** Set true to disable all preview popover behavior. */
  disabled?: boolean;
};

/**
 * Prevent a deferred hide from clearing a preview after another anchor already took ownership.
 */
export function shouldHideDeferredPreview(params: {
  activeAnchorId: string | null;
  anchorId: string;
  anchorIsActive: boolean;
}): boolean {
  return !params.anchorIsActive && params.activeAnchorId === params.anchorId;
}

/**
 * Provides thread popover handlers and computed visibility state for
 * error and summary previews.
 */
export function useThreadPreviews(options?: UseThreadPreviewsOptions) {
  const previewsDisabled = options?.disabled === true;
  const [errorPreviewPopover, setErrorPreviewPopover] =
    useState<ErrorPreviewPopoverState | null>(null);
  const [threadSummaryPopover, setThreadSummaryPopover] =
    useState<ThreadSummaryPopoverState | null>(null);
  const errorPreviewPopoverRef = useRef<ErrorPreviewPopoverState | null>(null);
  const threadSummaryPopoverRef = useRef<ThreadSummaryPopoverState | null>(
    null,
  );
  const errorHideFrameRef = useRef<number | null>(null);
  const threadSummaryHideFrameRef = useRef<number | null>(null);

  const cancelScheduledHide = useCallback(
    (frameRef: { current: number | null }): void => {
      if (typeof window === "undefined" || frameRef.current === null) {
        return;
      }

      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  const updateErrorPreviewPopover = useCallback(
    (next: ErrorPreviewPopoverState | null): void => {
      errorPreviewPopoverRef.current = next;
      setErrorPreviewPopover(next);
    },
    [],
  );

  const updateThreadSummaryPopover = useCallback(
    (next: ThreadSummaryPopoverState | null): void => {
      threadSummaryPopoverRef.current = next;
      setThreadSummaryPopover(next);
    },
    [],
  );

  useEffect(() => {
    if (!previewsDisabled) {
      return;
    }

    cancelScheduledHide(errorHideFrameRef);
    cancelScheduledHide(threadSummaryHideFrameRef);
    updateErrorPreviewPopover(null);
    updateThreadSummaryPopover(null);
  }, [
    cancelScheduledHide,
    previewsDisabled,
    updateErrorPreviewPopover,
    updateThreadSummaryPopover,
  ]);

  useEffect(
    () => () => {
      cancelScheduledHide(errorHideFrameRef);
      cancelScheduledHide(threadSummaryHideFrameRef);
    },
    [cancelScheduledHide],
  );

  const showErrorPreview = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
      anchorId: string,
      text: string,
    ): void => {
      // Early return when disabled or when no valid text is available.
      if (previewsDisabled) {
        updateErrorPreviewPopover(null);
        return;
      }
      const previewText = text.trim();
      if (!previewText) {
        updateErrorPreviewPopover(null);
        return;
      }
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      // Skip hover previews on compact layouts to avoid awkward positioning.
      if (viewportWidth < 768) {
        updateErrorPreviewPopover(null);
        return;
      }
      cancelScheduledHide(errorHideFrameRef);
      const viewportHeight =
        typeof window === "undefined" ? 720 : window.innerHeight;
      const rect = event.currentTarget.getBoundingClientRect();
      const clampedTop = clampProjectMenuCoordinate(
        rect.top + rect.height / 2 - 98,
        viewportHeight,
        196,
      );
      updateErrorPreviewPopover({
        anchorId,
        text: previewText,
        x: clampProjectMenuCoordinate(rect.right + 14, viewportWidth, 368),
        y: clampedTop + 98,
      });
    },
    [cancelScheduledHide, previewsDisabled, updateErrorPreviewPopover],
  );

  const hideErrorPreview = useCallback((): void => {
    cancelScheduledHide(errorHideFrameRef);
    updateErrorPreviewPopover(null);
  }, [cancelScheduledHide, updateErrorPreviewPopover]);

  const showThreadSummaryPreview = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
      anchorId: string,
      title: string,
      summary: string,
    ): void => {
      // Early return when disabled or summary text is empty.
      if (previewsDisabled) {
        updateThreadSummaryPopover(null);
        return;
      }
      const previewSummary = summary.trim();
      if (!previewSummary) {
        updateThreadSummaryPopover(null);
        return;
      }
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      // Skip summary preview on compact layouts to reduce modal churn.
      if (viewportWidth < 768) {
        updateThreadSummaryPopover(null);
        return;
      }
      cancelScheduledHide(threadSummaryHideFrameRef);
      const viewportHeight =
        typeof window === "undefined" ? 720 : window.innerHeight;
      const rect = event.currentTarget.getBoundingClientRect();
      updateThreadSummaryPopover({
        anchorId,
        title,
        summary: previewSummary,
        x: clampProjectMenuCoordinate(rect.right + 14, viewportWidth, 360),
        y: clampProjectMenuCoordinate(rect.top, viewportHeight, 240),
      });
    },
    [cancelScheduledHide, previewsDisabled, updateThreadSummaryPopover],
  );

  const hideThreadSummaryPreview = useCallback((): void => {
    cancelScheduledHide(threadSummaryHideFrameRef);
    updateThreadSummaryPopover(null);
  }, [cancelScheduledHide, updateThreadSummaryPopover]);

  const deferHidePreview = useCallback(
    (
      anchorId: string,
      getActiveAnchorId: () => string | null,
      hidePreview: () => void,
      hideFrameRef: { current: number | null },
    ): void => {
      // Defer 1 frame so click/keyboard transitions can resolve before hiding.
      cancelScheduledHide(hideFrameRef);

      if (typeof window === "undefined") {
        if (
          shouldHideDeferredPreview({
            activeAnchorId: getActiveAnchorId(),
            anchorId,
            anchorIsActive: anchorStillActive(anchorId),
          })
        ) {
          hidePreview();
        }
        return;
      }

      hideFrameRef.current = window.requestAnimationFrame(() => {
        hideFrameRef.current = null;
        if (
          !shouldHideDeferredPreview({
            activeAnchorId: getActiveAnchorId(),
            anchorId,
            anchorIsActive: anchorStillActive(anchorId),
          })
        ) {
          return;
        }
        hidePreview();
      });
    },
    [cancelScheduledHide],
  );

  const errorPreviewHandlers = useCallback(
    (
      anchorId: string,
      text: string | null | undefined,
    ): Pick<
      HTMLAttributes<HTMLElement>,
      "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur"
    > => {
      const previewText = text?.trim();
      if (!previewText || previewsDisabled) {
        return {};
      }
      return {
        onMouseEnter: (event) => {
          // Hover opens the error tooltip at the row anchor.
          showErrorPreview(
            event as ReactMouseEvent<HTMLElement>,
            anchorId,
            previewText,
          );
        },
        onFocus: (event) => {
          // Keyboard focus opens the same preview path for parity.
          showErrorPreview(
            event as ReactFocusEvent<HTMLElement>,
            anchorId,
            previewText,
          );
        },
        onMouseLeave: () => {
          // Hide after hover exits unless the anchor remains active.
          deferHidePreview(
            anchorId,
            () => errorPreviewPopoverRef.current?.anchorId ?? null,
            hideErrorPreview,
            errorHideFrameRef,
          );
        },
        onBlur: () => {
          // Hide after focus exits unless moving to related UI.
          deferHidePreview(
            anchorId,
            () => errorPreviewPopoverRef.current?.anchorId ?? null,
            hideErrorPreview,
            errorHideFrameRef,
          );
        },
      };
    },
    [deferHidePreview, hideErrorPreview, previewsDisabled, showErrorPreview],
  );

  const threadSummaryPreviewHandlers = useCallback(
    (
      anchorId: string,
      title: string,
      summary: string | null | undefined,
    ): Pick<
      HTMLAttributes<HTMLElement>,
      "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur"
    > => {
      const previewSummary = summary?.trim();
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      if (!previewSummary || previewsDisabled || viewportWidth < 768) {
        return {};
      }
      return {
        onMouseEnter: (event) => {
          // Open once on hover enter; the popover is row-anchored, not cursor-anchored.
          showThreadSummaryPreview(
            event as ReactMouseEvent<HTMLElement>,
            anchorId,
            title,
            previewSummary,
          );
        },
        onFocus: (event) => {
          // Keyboard focus opens summary preview too.
          showThreadSummaryPreview(
            event as ReactFocusEvent<HTMLElement>,
            anchorId,
            title,
            previewSummary,
          );
        },
        onMouseLeave: () => {
          // Defer hide so focus transitions don't close the popover instantly.
          deferHidePreview(
            anchorId,
            () => threadSummaryPopoverRef.current?.anchorId ?? null,
            hideThreadSummaryPreview,
            threadSummaryHideFrameRef,
          );
        },
        onBlur: () => {
          // Defer hide so anchor/related focus transitions resolve.
          deferHidePreview(
            anchorId,
            () => threadSummaryPopoverRef.current?.anchorId ?? null,
            hideThreadSummaryPreview,
            threadSummaryHideFrameRef,
          );
        },
      };
    },
    [
      deferHidePreview,
      hideThreadSummaryPreview,
      previewsDisabled,
      showThreadSummaryPreview,
    ],
  );

  return {
    errorPreviewHandlers,
    errorPreviewPopover,
    hideErrorPreview,
    hideThreadSummaryPreview,
    threadSummaryPopover,
    threadSummaryPreviewHandlers,
  };
}

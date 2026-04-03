import type {
  HTMLAttributes,
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useEffect, useState } from "react";
import {
  clampProjectMenuCoordinate,
  type ErrorPreviewPopoverState,
  type ThreadSummaryPopoverState,
} from "./state";

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
 * Provides thread popover handlers and computed visibility state for
 * error and summary previews.
 */
export function useThreadPreviews(options?: UseThreadPreviewsOptions) {
  const previewsDisabled = options?.disabled === true;
  const [errorPreviewPopover, setErrorPreviewPopover] =
    useState<ErrorPreviewPopoverState | null>(null);
  const [threadSummaryPopover, setThreadSummaryPopover] =
    useState<ThreadSummaryPopoverState | null>(null);

  useEffect(() => {
    if (!previewsDisabled) {
      return;
    }

    setErrorPreviewPopover(null);
    setThreadSummaryPopover(null);
  }, [previewsDisabled]);

  const showErrorPreview = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
      anchorId: string,
      text: string,
    ): void => {
      // Early return when disabled or when no valid text is available.
      if (previewsDisabled) {
        setErrorPreviewPopover(null);
        return;
      }
      const previewText = text.trim();
      if (!previewText) {
        setErrorPreviewPopover(null);
        return;
      }
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      // Skip hover previews on compact layouts to avoid awkward positioning.
      if (viewportWidth < 768) {
        setErrorPreviewPopover(null);
        return;
      }
      const viewportHeight =
        typeof window === "undefined" ? 720 : window.innerHeight;
      const rect = event.currentTarget.getBoundingClientRect();
      const clampedTop = clampProjectMenuCoordinate(
        rect.top + rect.height / 2 - 98,
        viewportHeight,
        196,
      );
      setErrorPreviewPopover({
        anchorId,
        text: previewText,
        x: clampProjectMenuCoordinate(rect.right + 14, viewportWidth, 368),
        y: clampedTop + 98,
      });
    },
    [previewsDisabled],
  );

  const hideErrorPreview = useCallback((): void => {
    setErrorPreviewPopover(null);
  }, []);

  const showThreadSummaryPreview = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
      anchorId: string,
      title: string,
      summary: string,
    ): void => {
      // Early return when disabled or summary text is empty.
      if (previewsDisabled) {
        setThreadSummaryPopover(null);
        return;
      }
      const previewSummary = summary.trim();
      if (!previewSummary) {
        setThreadSummaryPopover(null);
        return;
      }
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      // Skip summary preview on compact layouts to reduce modal churn.
      if (viewportWidth < 768) {
        setThreadSummaryPopover(null);
        return;
      }
      const viewportHeight =
        typeof window === "undefined" ? 720 : window.innerHeight;
      const rect = event.currentTarget.getBoundingClientRect();
      setThreadSummaryPopover({
        anchorId,
        title,
        summary: previewSummary,
        x: clampProjectMenuCoordinate(rect.right + 14, viewportWidth, 360),
        y: clampProjectMenuCoordinate(rect.top, viewportHeight, 240),
      });
    },
    [previewsDisabled],
  );

  const hideThreadSummaryPreview = useCallback((): void => {
    setThreadSummaryPopover(null);
  }, []);

  const deferHidePreview = useCallback(
    (anchorId: string, hidePreview: () => void): void => {
      // Defer 1 frame so click/keyboard transitions can resolve before hiding.
      if (typeof window === "undefined") {
        hidePreview();
        return;
      }

      window.requestAnimationFrame(() => {
        if (anchorStillActive(anchorId)) {
          return;
        }
        hidePreview();
      });
    },
    [],
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
          deferHidePreview(anchorId, hideErrorPreview);
        },
        onBlur: () => {
          // Hide after focus exits unless moving to related UI.
          deferHidePreview(anchorId, hideErrorPreview);
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
      "onMouseEnter" | "onMouseMove" | "onMouseLeave" | "onFocus" | "onBlur"
    > => {
      const previewSummary = summary?.trim();
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      if (!previewSummary || previewsDisabled || viewportWidth < 768) {
        return {};
      }
      return {
        onMouseEnter: (event) => {
          // Open on hover enter and keep live updates for mouse movement.
          showThreadSummaryPreview(
            event as ReactMouseEvent<HTMLElement>,
            anchorId,
            title,
            previewSummary,
          );
        },
        onMouseMove: (event) => {
          // Mouse move keeps the popover pinned when cursor drifts within the target.
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
          deferHidePreview(anchorId, hideThreadSummaryPreview);
        },
        onBlur: () => {
          // Defer hide so anchor/related focus transitions resolve.
          deferHidePreview(anchorId, hideThreadSummaryPreview);
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

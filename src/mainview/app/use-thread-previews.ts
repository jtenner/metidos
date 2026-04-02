import type {
  HTMLAttributes,
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useState } from "react";
import {
  type ErrorPreviewPopoverState,
  type ThreadSummaryPopoverState,
  clampProjectMenuCoordinate,
} from "./state";

export function useThreadPreviews() {
  const [errorPreviewPopover, setErrorPreviewPopover] =
    useState<ErrorPreviewPopoverState | null>(null);
  const [threadSummaryPopover, setThreadSummaryPopover] =
    useState<ThreadSummaryPopoverState | null>(null);

  const showErrorPreview = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
      anchorId: string,
      text: string,
    ): void => {
      const previewText = text.trim();
      if (!previewText) {
        setErrorPreviewPopover(null);
        return;
      }
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
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
    [],
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
      const previewSummary = summary.trim();
      if (!previewSummary) {
        setThreadSummaryPopover(null);
        return;
      }
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
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
    [],
  );

  const hideThreadSummaryPreview = useCallback((): void => {
    setThreadSummaryPopover(null);
  }, []);

  const errorPreviewHandlers = useCallback(
    (
      anchorId: string,
      text: string | null | undefined,
    ): Pick<
      HTMLAttributes<HTMLElement>,
      "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur"
    > => {
      const previewText = text?.trim();
      if (!previewText) {
        return {};
      }
      return {
        onMouseEnter: (event) => {
          showErrorPreview(
            event as ReactMouseEvent<HTMLElement>,
            anchorId,
            previewText,
          );
        },
        onFocus: (event) => {
          showErrorPreview(
            event as ReactFocusEvent<HTMLElement>,
            anchorId,
            previewText,
          );
        },
        onMouseLeave: () => {
          hideErrorPreview();
        },
        onBlur: () => {
          hideErrorPreview();
        },
      };
    },
    [hideErrorPreview, showErrorPreview],
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
      if (!previewSummary || viewportWidth < 768) {
        return {};
      }
      return {
        onMouseEnter: (event) => {
          showThreadSummaryPreview(
            event as ReactMouseEvent<HTMLElement>,
            anchorId,
            title,
            previewSummary,
          );
        },
        onMouseMove: (event) => {
          showThreadSummaryPreview(
            event as ReactMouseEvent<HTMLElement>,
            anchorId,
            title,
            previewSummary,
          );
        },
        onFocus: (event) => {
          showThreadSummaryPreview(
            event as ReactFocusEvent<HTMLElement>,
            anchorId,
            title,
            previewSummary,
          );
        },
        onMouseLeave: () => {
          hideThreadSummaryPreview();
        },
        onBlur: () => {
          hideThreadSummaryPreview();
        },
      };
    },
    [hideThreadSummaryPreview, showThreadSummaryPreview],
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

/**
 * @file src/mainview/controls/dropdown.tsx
 * @description Module for dropdown.
 */

import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Props passed to custom render callbacks while the dropdown is rendered.
 */
type DropdownControlRenderProps = {
  /** Close the dropdown immediately. */
  close: () => void;
  /** Whether the control is currently disabled. */
  disabled: boolean;
  /** Whether the dropdown panel is visible. */
  open: boolean;
  /** Toggle open state when user interaction is allowed. */
  toggle: () => void;
};

/**
 * Props for DropdownControl.
 */
type DropdownControlProps = {
  /** Set to false to prevent opening while keeping content mounted. */
  canOpen?: boolean;
  /** Disables toggle/rendered interactions without unmounting the control. */
  disabled?: boolean;
  /** Optional observer hook for externally tracking open/closed state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Render function for the toggle/button region. */
  renderButton: (props: DropdownControlRenderProps) => ReactNode;
  /** Render function for the dropdown panel/body. */
  renderPanel: (props: DropdownControlRenderProps) => ReactNode;
  /** Root wrapper className for positioning/context. */
  rootClassName?: string;
  /** Browser tooltip for the dropdown root. */
  title?: string;
};

/**
 * Controlled-by-state dropdown primitive with render-prop API.
 *
 * Consumers provide both the trigger and panel renderers so calling code owns
 * exact markup while this component owns open/close and outside-interaction behavior.
 */
export function DropdownControl({
  canOpen = true,
  disabled = false,
  onOpenChange,
  renderButton,
  renderPanel,
  rootClassName = "relative",
  title,
}: DropdownControlProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Base close action used by renderers and internal handlers.
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Toggle should be a no-op while opening is disallowed (disabled by parent state).
  const toggle = useCallback(() => {
    if (!canOpen) {
      return;
    }
    setOpen((current) => !current);
  }, [canOpen]);

  // Notify parent components of visibility changes for analytics/accessibility sync.
  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  // If parent disables opening while open, force close to avoid stale UI state.
  useEffect(() => {
    if (!canOpen && open) {
      setOpen(false);
    }
  }, [canOpen, open]);

  // Bind global listeners while open so outside clicks and Escape collapse the dropdown.
  useEffect(() => {
    if (!open) {
      return;
    }

    /**
     * Handles pointer down.
     * @param event - event argument for handlePointerDown.
     */
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    /**
     * Handles key down.
     * @param event - event argument for handleKeyDown.
     */
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    // Listen on document to support closing when interaction occurs outside this root.
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const renderProps = {
    close,
    disabled,
    open,
    toggle,
  };

  return (
    <div ref={rootRef} className={rootClassName} title={title}>
      {renderButton(renderProps)}
      {open ? renderPanel(renderProps) : null}
    </div>
  );
}

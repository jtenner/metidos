/**
 * @file src/mainview/controls/dropdown.tsx
 * @description Module for dropdown.
 */

import type { Placement } from "@floating-ui/react";
import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PopoverSurface, type PopoverSurfaceMode } from "./popover";

const DROPDOWN_INTERACTIVE_PORTAL_SELECTOR =
  "[data-dropdown-interactive-portal='true']";
export const CHOOSER_OPTION_SELECTOR = "[data-chooser-option='true']";
export const CHOOSER_SEARCH_FIELD_SELECTOR = "[data-chooser-search='true']";

type DropdownContainmentTarget = {
  closest?: (selector: string) => unknown;
  parentElement?: DropdownContainmentTarget | null;
};

type DropdownContainmentRoot = {
  contains: (target: Node | null) => boolean;
};

function resolveDropdownContainmentTarget(
  target: unknown,
): DropdownContainmentTarget | null {
  if (typeof target !== "object" || target === null) {
    return null;
  }

  return target as DropdownContainmentTarget;
}

/**
 * Treat clicks inside portal-backed interactive surfaces as in-bounds so
 * nested popovers can participate in one dropdown interaction flow.
 */
export function isDropdownPointerTargetInside({
  panelElement,
  rootElement,
  target,
}: {
  panelElement: DropdownContainmentRoot | null;
  rootElement: DropdownContainmentRoot | null;
  target: unknown;
}): boolean {
  const nodeTarget = target as Node | null;
  if (rootElement?.contains(nodeTarget) || panelElement?.contains(nodeTarget)) {
    return true;
  }

  let currentTarget = resolveDropdownContainmentTarget(target);
  while (currentTarget) {
    if (
      typeof currentTarget.closest === "function" &&
      currentTarget.closest(DROPDOWN_INTERACTIVE_PORTAL_SELECTOR)
    ) {
      return true;
    }
    currentTarget = currentTarget.parentElement ?? null;
  }

  return false;
}

function isChooserSearchFieldTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.matches(CHOOSER_SEARCH_FIELD_SELECTOR)
  );
}

function resolveChooserOptionTarget(
  target: EventTarget | null,
): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const option = target.closest(CHOOSER_OPTION_SELECTOR);
  return option instanceof HTMLElement ? option : null;
}

function isChooserOptionDisabled(option: HTMLElement): boolean {
  return (
    option.getAttribute("aria-disabled") === "true" ||
    option.hasAttribute("disabled")
  );
}

export function findChooserOptionElements(
  container: ParentNode | null,
): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(CHOOSER_OPTION_SELECTOR),
  ).filter((option) => !isChooserOptionDisabled(option));
}

export function chooserOptionIndexForKey({
  currentIndex,
  key,
  optionCount,
}: {
  currentIndex: number;
  key: string;
  optionCount: number;
}): number | null {
  if (optionCount <= 0) {
    return null;
  }

  switch (key) {
    case "ArrowDown":
      return currentIndex < 0 ? 0 : Math.min(optionCount - 1, currentIndex + 1);
    case "ArrowUp":
      return currentIndex < 0 ? optionCount - 1 : Math.max(0, currentIndex - 1);
    case "Home":
      return 0;
    case "End":
      return optionCount - 1;
    default:
      return null;
  }
}

function focusChooserOption(
  container: ParentNode | null,
  nextIndex: number,
): boolean {
  const options = findChooserOptionElements(container);
  const nextTarget = options[nextIndex];
  if (!nextTarget) {
    return false;
  }

  nextTarget.focus({ preventScroll: true });
  return true;
}

/**
 * Props passed to custom render callbacks while the dropdown is rendered.
 */
type DropdownControlRenderProps = {
  /** Ref attached to the trigger so focus can return on close. */
  buttonRef: RefObject<HTMLButtonElement | null>;
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
  /** Set to false to keep an open dropdown visible while disabled changes. */
  closeOnDisable?: boolean;
  /** Optional observer hook for externally tracking open/closed state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Extra classes applied to the shared popover surface wrapper. */
  panelClassName?: string;
  /** Description id forwarded to the shared popover surface wrapper. */
  panelDescribedBy?: string;
  /** Keep the panel visible even when the trigger is clipped by viewport changes. */
  panelHideWhenReferenceHidden?: boolean;
  /** Optional initial focus target inside the panel. */
  panelInitialFocusRef?: RefObject<HTMLElement | null>;
  /** DOM id forwarded to the shared popover surface wrapper. */
  panelId?: string;
  /** Label id forwarded to the shared popover surface wrapper. */
  panelLabelledBy?: string;
  /** Interaction mode used by the floating surface wrapper. */
  panelMode?: Extract<PopoverSurfaceMode, "chooser" | "nonmodal-dialog">;
  /** Popover placement relative to the trigger wrapper. */
  panelPlacement?: Placement;
  /** Gap between the trigger and floating panel. */
  panelOffsetPx?: number;
  /** Inline styles applied to the shared popover surface wrapper. */
  panelStyle?: CSSProperties;
  /** Match the popover surface width to the trigger width. */
  matchTriggerWidth?: boolean;
  /** Render function for the toggle/button region. */
  renderButton: (props: DropdownControlRenderProps) => ReactNode;
  /** Render function for the dropdown panel/body content. */
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
  closeOnDisable = true,
  disabled = false,
  matchTriggerWidth = false,
  onOpenChange,
  panelClassName,
  panelDescribedBy,
  panelHideWhenReferenceHidden = true,
  panelInitialFocusRef,
  panelId,
  panelLabelledBy,
  panelMode = "nonmodal-dialog",
  panelOffsetPx = 8,
  panelPlacement = "bottom-start",
  panelStyle,
  renderButton,
  renderPanel,
  rootClassName = "relative",
  title,
}: DropdownControlProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

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

  // Notify parent components when visibility changes so external state stays in sync.
  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  // If parent disables opening while open, force close to avoid an inconsistent open state
  // unless the caller explicitly wants the panel to remain visible during temporary disablement.
  useEffect(() => {
    if (closeOnDisable && !canOpen && open) {
      setOpen(false);
    }
  }, [canOpen, closeOnDisable, open]);

  const handlePanelKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (panelMode !== "chooser") {
        return;
      }

      const panelElement = panelRef.current;
      if (!panelElement) {
        return;
      }

      if (isChooserSearchFieldTarget(event.target)) {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
          return;
        }

        const nextIndex = chooserOptionIndexForKey({
          currentIndex: -1,
          key: event.key,
          optionCount: findChooserOptionElements(panelElement).length,
        });
        if (nextIndex === null) {
          return;
        }

        event.preventDefault();
        focusChooserOption(panelElement, nextIndex);
        return;
      }

      const optionTarget = resolveChooserOptionTarget(event.target);
      if (!optionTarget) {
        return;
      }

      const options = findChooserOptionElements(panelElement);
      const nextIndex = chooserOptionIndexForKey({
        currentIndex: options.indexOf(optionTarget),
        key: event.key,
        optionCount: options.length,
      });
      if (nextIndex === null) {
        return;
      }

      event.preventDefault();
      focusChooserOption(panelElement, nextIndex);
    },
    [panelMode],
  );

  const renderProps = {
    buttonRef,
    close,
    disabled,
    open,
    toggle,
  };

  return (
    <div ref={rootRef} className={rootClassName} title={title}>
      {renderButton(renderProps)}
      <PopoverSurface
        aria-describedby={panelDescribedBy}
        aria-labelledby={panelLabelledBy}
        className={panelClassName}
        hideWhenReferenceHidden={panelHideWhenReferenceHidden}
        id={panelId}
        initialFocusRef={panelInitialFocusRef}
        isTargetWithinSurface={(target, context) =>
          isDropdownPointerTargetInside({
            panelElement: context.floatingElement,
            rootElement: rootRef.current,
            target,
          })
        }
        matchReferenceWidth={matchTriggerWidth}
        offsetPx={panelOffsetPx}
        onKeyDownCapture={handlePanelKeyDownCapture}
        onRequestClose={() => {
          setOpen(false);
        }}
        open={open}
        placement={panelPlacement}
        ref={panelRef}
        reference={rootRef.current}
        restoreFocusReference={buttonRef.current}
        style={panelStyle}
        surfaceMode={panelMode}
      >
        {renderPanel(renderProps)}
      </PopoverSurface>
    </div>
  );
}

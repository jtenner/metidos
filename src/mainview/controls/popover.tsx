/**
 * @file src/mainview/controls/popover.tsx
 * @description Shared floating popover primitives and helpers.
 */

import {
  autoUpdate,
  type AutoUpdateOptions,
  FloatingPortal,
  flip,
  hide,
  type MiddlewareData,
  offset,
  type Placement,
  type ReferenceElement,
  shift,
  size,
  useFloating,
  type VirtualElement,
} from "@floating-ui/react";
import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { AppButton } from "./button";
import { mergeClassNames } from "../dynamic-styles";

const DEFAULT_POPOVER_VIEWPORT_PADDING_PX = 8;

export const POPOVER_AUTO_UPDATE_OPTIONS = Object.freeze({
  ancestorResize: false,
  elementResize: true,
  layoutShift: false,
} satisfies AutoUpdateOptions);
const FOCUSABLE_SURFACE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export type PopoverSurfaceMode =
  | "chooser"
  | "nonmodal-dialog"
  | "plain"
  | "tooltip";

type PointReferenceOptions = {
  contextElement?: Element | null;
  height?: number;
  width?: number;
  x: number;
  y: number;
};

export type PopoverSurfaceContainmentContext = {
  floatingElement: HTMLDivElement | null;
  reference: ReferenceElement | null;
};

type PopoverSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  closeOnEscape?: boolean;
  closeOnOutsidePress?: boolean;
  hideWhenEscaped?: boolean;
  hideWhenReferenceHidden?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  isTargetWithinSurface?: (
    target: unknown,
    context: PopoverSurfaceContainmentContext,
  ) => boolean;
  matchReferenceWidth?: boolean;
  offsetPx?: number;
  onRequestClose?: ((restoreFocus?: boolean) => void) | undefined;
  open: boolean;
  placement?: Placement;
  portalId?: string;
  reference: ReferenceElement | null;
  restoreFocus?: boolean;
  restoreFocusReference?: HTMLElement | null | undefined;
  surfaceMode?: PopoverSurfaceMode;
  viewportPaddingPx?: number;
};

type ModalDialogSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  backdropClassName?: string;
  backdropLabel?: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  open: boolean;
  overlayClassName?: string;
  onRequestClose?: ((restoreFocus?: boolean) => void) | undefined;
  portalId?: string;
  restoreFocus?: boolean;
  restoreFocusReference?: HTMLElement | null | undefined;
};

type PopoverVisibilityState = {
  escaped: boolean;
  referenceHidden: boolean;
  visible: boolean;
};

export type PopoverCloseInteraction = "escape" | "outside-press";

type SurfaceFocusManagementOptions = {
  closeOnEscape: boolean;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  onRequestClose?: ((restoreFocus?: boolean) => void) | undefined;
  open: boolean;
  reference: ReferenceElement | null;
  restoreFocus: boolean;
  restoreFocusReference?: HTMLElement | null | undefined;
  shouldCloseOnOutsidePress: boolean;
  shouldManageFocus: boolean;
  shouldTrapFocus: boolean;
  surfaceRef: RefObject<HTMLDivElement | null>;
  targetWithinSurface?:
    | ((target: unknown, context: PopoverSurfaceContainmentContext) => boolean)
    | undefined;
};

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

function createVirtualRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    toJSON() {
      return {
        bottom: y + height,
        height,
        left: x,
        right: x + width,
        top: y,
        width,
        x,
        y,
      };
    },
    top: y,
    width,
    x,
    y,
  } as DOMRect;
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function canFocusSurfaceElement(element: HTMLElement): boolean {
  if (element.hasAttribute("disabled")) {
    return false;
  }
  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }
  if (element.hasAttribute("hidden")) {
    return false;
  }
  return element.getClientRects().length > 0;
}

function findFocusableSurfaceElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SURFACE_SELECTOR),
  ).filter(canFocusSurfaceElement);
}

function focusSurface(
  container: HTMLElement,
  initialFocusRef?: RefObject<HTMLElement | null> | undefined,
): void {
  const explicitTarget = initialFocusRef?.current;
  if (explicitTarget && canFocusSurfaceElement(explicitTarget)) {
    explicitTarget.focus({ preventScroll: true });
    return;
  }

  const focusableElements = findFocusableSurfaceElements(container);
  const firstFocusableElement = focusableElements[0];
  if (firstFocusableElement) {
    firstFocusableElement.focus({ preventScroll: true });
    return;
  }

  if (container.tabIndex < 0) {
    container.tabIndex = -1;
  }
  container.focus({ preventScroll: true });
}

function restoreSurfaceFocus(target: HTMLElement | null): void {
  if (!target?.isConnected) {
    return;
  }

  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

function trapSurfaceFocus(event: KeyboardEvent, container: HTMLElement): void {
  const focusableElements = findFocusableSurfaceElements(container);
  if (focusableElements.length === 0) {
    event.preventDefault();
    if (container.tabIndex < 0) {
      container.tabIndex = -1;
    }
    container.focus({ preventScroll: true });
    return;
  }

  const firstFocusableElement = focusableElements[0];
  const lastFocusableElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey) {
    if (
      activeElement === firstFocusableElement ||
      activeElement === container ||
      !container.contains(activeElement)
    ) {
      event.preventDefault();
      lastFocusableElement?.focus({ preventScroll: true });
    }
    return;
  }

  if (activeElement === lastFocusableElement) {
    event.preventDefault();
    firstFocusableElement?.focus({ preventScroll: true });
  }
}

function referenceContainsTarget(
  reference: ReferenceElement | null,
  target: Node | null,
): boolean {
  if (!(reference instanceof Element)) {
    return false;
  }

  return reference.contains(target);
}

export function shouldRestoreFocusForPopoverClose(
  interaction: PopoverCloseInteraction,
): boolean {
  return interaction === "escape";
}

function useSurfaceFocusManagement({
  closeOnEscape,
  initialFocusRef,
  onRequestClose,
  open,
  reference,
  restoreFocus,
  restoreFocusReference,
  shouldCloseOnOutsidePress,
  shouldManageFocus,
  shouldTrapFocus,
  surfaceRef,
  targetWithinSurface,
}: SurfaceFocusManagementOptions): void {
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const restoreFocusOnCloseRef = useRef(true);
  const restoreFocusRafIdRef = useRef<number | null>(null);
  const onRequestCloseRef = useRef(onRequestClose);
  const targetWithinSurfaceRef = useRef(targetWithinSurface);

  onRequestCloseRef.current = onRequestClose;
  targetWithinSurfaceRef.current = targetWithinSurface;

  useEffect(() => {
    return () => {
      if (restoreFocusRafIdRef.current !== null) {
        window.cancelAnimationFrame(restoreFocusRafIdRef.current);
        restoreFocusRafIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    if (restoreFocusRafIdRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusRafIdRef.current);
      restoreFocusRafIdRef.current = null;
    }

    restoreFocusOnCloseRef.current = true;
    previousActiveElementRef.current =
      restoreFocusReference ??
      (isHTMLElement(document.activeElement) ? document.activeElement : null);

    const surfaceElement = surfaceRef.current;
    const focusRafId =
      shouldManageFocus && surfaceElement
        ? window.requestAnimationFrame(() => {
            const currentSurfaceElement = surfaceRef.current;
            if (!currentSurfaceElement) {
              return;
            }
            if (currentSurfaceElement.contains(document.activeElement)) {
              return;
            }
            focusSurface(currentSurfaceElement, initialFocusRef);
          })
        : null;

    const handleKeyDown = (event: KeyboardEvent): void => {
      const currentSurfaceElement = surfaceRef.current;
      if (!currentSurfaceElement) {
        return;
      }

      const requestClose = onRequestCloseRef.current;
      if (event.key === "Escape" && closeOnEscape && requestClose) {
        event.preventDefault();
        const restoreFocusOnClose = shouldRestoreFocusForPopoverClose("escape");
        restoreFocusOnCloseRef.current = restoreFocusOnClose;
        requestClose(restoreFocusOnClose);
        return;
      }

      if (event.key === "Tab" && shouldTrapFocus) {
        trapSurfaceFocus(event, currentSurfaceElement);
      }
    };

    const handlePointerDown = (event: PointerEvent): void => {
      const requestClose = onRequestCloseRef.current;
      if (!shouldCloseOnOutsidePress || !requestClose) {
        return;
      }

      const currentSurfaceElement = surfaceRef.current;
      const context = {
        floatingElement: currentSurfaceElement,
        reference,
      };
      if (targetWithinSurfaceRef.current?.(event.target, context)) {
        return;
      }

      const target = event.target as Node | null;
      if (currentSurfaceElement?.contains(target)) {
        return;
      }
      if (referenceContainsTarget(reference, target)) {
        return;
      }

      const restoreFocusOnClose =
        shouldRestoreFocusForPopoverClose("outside-press");
      restoreFocusOnCloseRef.current = restoreFocusOnClose;
      requestClose(restoreFocusOnClose);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    // Use pointerdown so outside-press close semantics stay ordered with
    // mouse, touch, and pen interactions before descendants synthesize clicks.
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      if (focusRafId !== null) {
        window.cancelAnimationFrame(focusRafId);
      }
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      const currentSurfaceElement = surfaceRef.current;
      const surfaceStillMounted = currentSurfaceElement?.isConnected === true;
      if (restoreFocusRafIdRef.current !== null) {
        window.cancelAnimationFrame(restoreFocusRafIdRef.current);
        restoreFocusRafIdRef.current = null;
      }
      if (
        restoreFocus &&
        restoreFocusOnCloseRef.current &&
        !surfaceStillMounted
      ) {
        const restoreTarget =
          restoreFocusReference ?? previousActiveElementRef.current;
        restoreFocusRafIdRef.current = window.requestAnimationFrame(() => {
          restoreFocusRafIdRef.current = null;
          restoreSurfaceFocus(restoreTarget);
        });
      }
    };
  }, [
    closeOnEscape,
    initialFocusRef,
    open,
    reference,
    restoreFocus,
    restoreFocusReference,
    shouldCloseOnOutsidePress,
    shouldManageFocus,
    shouldTrapFocus,
    surfaceRef,
  ]);
}

/**
 * Converts viewport coordinates into a virtual reference that Floating UI can
 * position against. This is used for context menus opened from pointer events.
 */
export function createPointReference({
  contextElement,
  height = 0,
  width = 0,
  x,
  y,
}: PointReferenceOptions): VirtualElement {
  return {
    ...(contextElement ? { contextElement } : {}),
    getBoundingClientRect() {
      return createVirtualRect(x, y, width, height);
    },
  };
}

/**
 * Reads hide-middleware state so callers can tell when a popover detached from
 * its anchor or when the anchor itself is clipped away.
 */
export function derivePopoverVisibilityState(
  middlewareData: MiddlewareData,
  options?: {
    hideWhenEscaped?: boolean;
    hideWhenReferenceHidden?: boolean;
  },
): PopoverVisibilityState {
  const hideWhenEscaped = options?.hideWhenEscaped === true;
  const hideWhenReferenceHidden = options?.hideWhenReferenceHidden !== false;
  const escaped = middlewareData.hide?.escaped === true;
  const referenceHidden = middlewareData.hide?.referenceHidden === true;
  return {
    escaped,
    referenceHidden,
    visible:
      (!hideWhenReferenceHidden || !referenceHidden) &&
      (!hideWhenEscaped || !escaped),
  };
}

export function surfaceRoleForMode(
  surfaceMode: PopoverSurfaceMode,
): HTMLAttributes<HTMLDivElement>["role"] | undefined {
  switch (surfaceMode) {
    case "tooltip":
      return "tooltip";
    case "chooser":
    case "nonmodal-dialog":
      return "dialog";
    case "plain":
      return undefined;
  }
}

/**
 * Shared viewport-aware floating surface that portals to `document.body` and
 * exposes visibility state through data attributes for optional styling.
 */
export const PopoverSurface = forwardRef<HTMLDivElement, PopoverSurfaceProps>(
  function PopoverSurface(
    {
      children,
      className,
      closeOnEscape,
      closeOnOutsidePress,
      hideWhenEscaped = true,
      hideWhenReferenceHidden = true,
      initialFocusRef,
      isTargetWithinSurface,
      matchReferenceWidth = false,
      offsetPx = DEFAULT_POPOVER_VIEWPORT_PADDING_PX,
      onRequestClose,
      open,
      placement = "bottom-start",
      portalId,
      reference,
      restoreFocus,
      restoreFocusReference,
      role: roleProp,
      style,
      surfaceMode = "plain",
      tabIndex,
      viewportPaddingPx = DEFAULT_POPOVER_VIEWPORT_PADDING_PX,
      ...rest
    },
    forwardedRef,
  ): JSX.Element | null {
    const floatingElementRef = useRef<HTMLDivElement | null>(null);
    const {
      floatingStyles,
      isPositioned,
      middlewareData,
      placement: resolvedPlacement,
      refs,
    } = useFloating({
      middleware: [
        offset(offsetPx),
        flip({
          padding: viewportPaddingPx,
        }),
        shift({
          crossAxis: true,
          padding: viewportPaddingPx,
        }),
        size({
          apply({ availableHeight, availableWidth, elements, rects }) {
            elements.floating.style.setProperty(
              "--popover-anchor-width",
              `${rects.reference.width}px`,
            );
            elements.floating.style.setProperty(
              "--popover-available-height",
              `${Math.max(0, availableHeight)}px`,
            );
            elements.floating.style.setProperty(
              "--popover-available-width",
              `${Math.max(0, availableWidth)}px`,
            );
            elements.floating.style.maxHeight = `${Math.max(
              0,
              availableHeight,
            )}px`;
            elements.floating.style.maxWidth = `${Math.max(
              0,
              availableWidth,
            )}px`;
            elements.floating.style.minWidth = matchReferenceWidth
              ? `${rects.reference.width}px`
              : "";
          },
          padding: viewportPaddingPx,
        }),
        ...(hideWhenReferenceHidden
          ? [
              hide({
                padding: viewportPaddingPx,
                strategy: "referenceHidden",
              }),
            ]
          : []),
        ...(hideWhenEscaped
          ? [
              hide({
                padding: viewportPaddingPx,
                strategy: "escaped",
              }),
            ]
          : []),
      ],
      open,
      placement,
      strategy: "fixed",
      whileElementsMounted: (referenceElement, floatingElement, update) =>
        autoUpdate(
          referenceElement,
          floatingElement,
          update,
          POPOVER_AUTO_UPDATE_OPTIONS,
        ),
    });

    useEffect(() => {
      refs.setPositionReference(reference);
    }, [reference, refs]);

    const visibility = derivePopoverVisibilityState(middlewareData, {
      hideWhenEscaped,
      hideWhenReferenceHidden,
    });
    const setFloatingRef = useCallback(
      (node: HTMLDivElement | null): void => {
        floatingElementRef.current = node;
        refs.setFloating(node);
        assignRef(forwardedRef, node);
      },
      [forwardedRef, refs],
    );
    const role = roleProp ?? surfaceRoleForMode(surfaceMode);
    const shouldManageFocus =
      surfaceMode === "chooser" || surfaceMode === "nonmodal-dialog";

    useSurfaceFocusManagement({
      closeOnEscape: closeOnEscape ?? shouldManageFocus,
      initialFocusRef,
      onRequestClose,
      open,
      reference,
      restoreFocus: restoreFocus ?? shouldManageFocus,
      restoreFocusReference,
      shouldCloseOnOutsidePress: closeOnOutsidePress ?? shouldManageFocus,
      shouldManageFocus,
      shouldTrapFocus: false,
      surfaceRef: floatingElementRef,
      targetWithinSurface: isTargetWithinSurface,
    });

    const surfaceVisible = isPositioned && visibility.visible;
    const popoverSurfaceClassName = useDynamicCssVariablesClassName(
      {
        "--popover-position": style?.position ?? floatingStyles.position,
        "--popover-left": style?.left ?? floatingStyles.left,
        "--popover-top": style?.top ?? floatingStyles.top,
        "--popover-right": style?.right ?? floatingStyles.right,
        "--popover-bottom": style?.bottom ?? floatingStyles.bottom,
        "--popover-transform": style?.transform ?? floatingStyles.transform,
        "--popover-width": style?.width ?? floatingStyles.width,
        "--popover-min-width": style?.minWidth ?? floatingStyles.minWidth,
        "--popover-max-width": style?.maxWidth ?? floatingStyles.maxWidth,
        "--popover-height": style?.height ?? floatingStyles.height,
        "--popover-min-height": style?.minHeight ?? floatingStyles.minHeight,
        "--popover-max-height": style?.maxHeight ?? floatingStyles.maxHeight,
        "--popover-pointer-events":
          surfaceVisible && style?.pointerEvents !== "none"
            ? (style?.pointerEvents ?? "auto")
            : "none",
        "--popover-visibility":
          surfaceVisible || style?.visibility === "visible"
            ? (style?.visibility ?? "visible")
            : "hidden",
      },
      {
        className: mergeClassNames(className, "popover-surface"),
        prefix: "popover-surface-vars",
      },
    );

    if (!open || !reference || typeof document === "undefined") {
      return null;
    }

    const [side, align = "center"] = resolvedPlacement.split("-");
    const portalProps = portalId ? { id: portalId } : {};

    const sharedSurfaceProps = {
      ...rest,
      // `id`/ARIA props from callers are applied to this same element that
      // receives the final `role`, so tooltip/dialog references resolve to the
      // semantic surface rather than an inert wrapper.
      className: popoverSurfaceClassName,
      "data-align": align,
      "data-escaped": visibility.escaped ? "true" : "false",
      "data-reference-hidden": visibility.referenceHidden ? "true" : "false",
      "data-side": side,
      "data-surface-mode": surfaceMode,
      "data-visible": surfaceVisible ? "true" : "false",
      ref: setFloatingRef,
    };

    return (
      <FloatingPortal {...portalProps}>
        {role === "dialog" ? (
          <div
            {...sharedSurfaceProps}
            aria-modal={rest["aria-modal"] ?? false}
            role="dialog"
            tabIndex={tabIndex ?? -1}
          >
            {children}
          </div>
        ) : (
          <div {...sharedSurfaceProps} role={role} tabIndex={tabIndex}>
            {children}
          </div>
        )}
      </FloatingPortal>
    );
  },
);

/**
 * Shared modal dialog surface with focus trapping, focus return, and a full
 * viewport backdrop that keeps background content non-interactive.
 */
export const ModalDialogSurface = forwardRef<
  HTMLDivElement,
  ModalDialogSurfaceProps
>(function ModalDialogSurface(
  {
    backdropClassName = "absolute inset-0 bg-bg-app/80",
    backdropLabel = "Dismiss dialog",
    children,
    className,
    initialFocusRef,
    onRequestClose,
    open,
    overlayClassName = "fixed inset-0 z-[100] flex items-center justify-center px-4 py-6",
    portalId,
    restoreFocus = true,
    restoreFocusReference,
    role: roleProp,
    tabIndex,
    ...rest
  },
  forwardedRef,
): JSX.Element | null {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const setSurfaceRef = useCallback(
    (node: HTMLDivElement | null): void => {
      surfaceRef.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef],
  );

  useSurfaceFocusManagement({
    closeOnEscape: true,
    initialFocusRef,
    onRequestClose,
    open,
    reference: null,
    restoreFocus,
    restoreFocusReference,
    shouldCloseOnOutsidePress: false,
    shouldManageFocus: true,
    shouldTrapFocus: true,
    surfaceRef,
  });

  if (!open || typeof document === "undefined") {
    return null;
  }

  const portalProps = portalId ? { id: portalId } : {};
  void roleProp;

  return (
    <FloatingPortal {...portalProps}>
      <div className={overlayClassName}>
        <AppButton
          unstyled
          aria-label={backdropLabel}
          className={backdropClassName}
          onClick={() => {
            onRequestClose?.(true);
          }}
          type="button"
        />
        <div
          {...rest}
          aria-modal={rest["aria-modal"] ?? true}
          className={["relative z-[1]", className].filter(Boolean).join(" ")}
          ref={setSurfaceRef}
          role="dialog"
          tabIndex={tabIndex ?? -1}
        >
          {children}
        </div>
      </div>
    </FloatingPortal>
  );
});

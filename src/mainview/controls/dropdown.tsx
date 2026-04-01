import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type DropdownControlRenderProps = {
  close: () => void;
  disabled: boolean;
  open: boolean;
  toggle: () => void;
};

type DropdownControlProps = {
  canOpen?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  renderButton: (props: DropdownControlRenderProps) => ReactNode;
  renderPanel: (props: DropdownControlRenderProps) => ReactNode;
  rootClassName?: string;
  title?: string;
};

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

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    if (!canOpen) {
      return;
    }
    setOpen((current) => !current);
  }, [canOpen]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!canOpen && open) {
      setOpen(false);
    }
  }, [canOpen, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

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

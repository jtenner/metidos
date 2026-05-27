/**
 * @file src/mainview/app/calendar-edit-dialog.tsx
 * @description Local calendar edit dialog for the calendar workspace.
 */

import {
  type FormEvent,
  type JSX,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import type { RpcCalendar } from "../../bun/calendar/types";
import { AppButton } from "../controls/button";
import { ConfirmDialog } from "../controls/confirm-dialog";
import { materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";

type CalendarUpdateInput = {
  calendarId: number;
  color: string;
  title: string;
};

export function CalendarEditDialog({
  calendar,
  onClose,
  onDelete,
  onSave,
}: {
  calendar: RpcCalendar;
  onClose: () => void;
  onDelete: () => Promise<void> | void;
  onSave: (input: CalendarUpdateInput) => Promise<void> | void;
}): JSX.Element {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(calendar.title);
  const [color, setColor] = useState(calendar.color);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletePromptOpen, setDeletePromptOpen] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const nextTitle = title.trim() || calendar.title;
    const nextColor = color.trim() || calendar.color;
    const changed =
      nextTitle !== calendar.title || nextColor !== calendar.color;
    if (!changed) {
      onClose();
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await onSave({
        calendarId: calendar.id,
        color: nextColor,
        title: nextTitle,
      });
      onClose();
    } catch (saveError) {
      setFormError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
      setBusy(false);
    }
  };

  const deleteCalendar = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setDeletePromptOpen(true);
  };

  const confirmDeleteCalendar = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setDeletePromptOpen(false);
    setBusy(true);
    setFormError("");
    try {
      await onDelete();
    } catch (deleteError) {
      setFormError(
        deleteError instanceof Error
          ? deleteError.message
          : String(deleteError),
      );
      setBusy(false);
    }
  };

  const handleRequestClose = useCallback((): void => {
    if (!busy) {
      onClose();
    }
  }, [busy, onClose]);

  return (
    <>
      <ModalDialogSurface
        aria-labelledby={titleId}
        backdropLabel="Close calendar editor"
        className="relative w-full max-w-lg border border-border-default bg-surface-1 text-text-primary shadow-overlay"
        initialFocusRef={titleInputRef}
        onRequestClose={handleRequestClose}
        open
        restoreFocus={true}
      >
        <form onSubmit={submit}>
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
            <div
              className="truncate pr-3 font-label text-[10px] uppercase tracking-[0.1em] text-accent"
              id={titleId}
            >
              Edit Calendar - {calendar.title}
            </div>
            <AppButton
              aria-label="Close calendar editor"
              buttonStyle="muted"
              disabled={busy}
              iconOnly
              onClick={onClose}
            >
              {materialSymbol("close", "text-[15px]")}
            </AppButton>
          </div>
          <div className="space-y-3 p-4 text-sm">
            {formError ? (
              <div className="border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
                {formError}
              </div>
            ) : null}
            <label className="block space-y-1">
              <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                Title
              </span>
              <input
                className="h-8 w-full border border-border-default bg-surface-2 px-2 text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                disabled={busy}
                name="calendar-title"
                onChange={(event) => setTitle(event.currentTarget.value)}
                ref={titleInputRef}
                value={title}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                Color
              </span>
              <input
                className="h-8 w-14 border border-border-default bg-surface-2 p-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                disabled={busy}
                name="calendar-color"
                onChange={(event) => setColor(event.currentTarget.value)}
                type="color"
                value={color}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
            {calendar.permission === "owner" ? (
              <AppButton
                buttonStyle="error"
                disabled={busy}
                onClick={() => {
                  void deleteCalendar();
                }}
              >
                Delete
              </AppButton>
            ) : null}
            <AppButton buttonStyle="muted" disabled={busy} onClick={onClose}>
              Cancel
            </AppButton>
            <AppButton buttonStyle="primary" disabled={busy} type="submit">
              Save
            </AppButton>
          </div>
        </form>
      </ModalDialogSurface>
      <ConfirmDialog
        confirmLabel="Delete"
        details={calendar.title}
        message="Delete calendar?"
        onCancel={() => setDeletePromptOpen(false)}
        onConfirm={() => {
          void confirmDeleteCalendar();
        }}
        open={deletePromptOpen}
        title="Delete Calendar"
      />
    </>
  );
}

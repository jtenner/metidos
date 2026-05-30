/**
 * @file src/mainview/app/calendar-ics-edit-dialog.tsx
 * @description External ICS subscription edit dialog for the calendar workspace.
 */

import {
  type FormEvent,
  type JSX,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import type { RpcExternalIcsCalendar } from "../../bun/calendar/types";
import { AppButton } from "../controls/button";
import { ConfirmDialog } from "../controls/confirm-dialog";
import { materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";

const REFRESH_INTERVAL_OPTIONS = [
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
  { label: "1 day", value: 1440 },
] as const;

type IcsUpdateInput = {
  color: string;
  externalCalendarId: number;
  notificationMode: "source" | "default";
  notificationsEnabled: boolean;
  refreshIntervalMinutes: number;
  title: string;
  url: string;
};

export function CalendarIcsEditDialog({
  calendar,
  onClose,
  onDelete,
  onSave,
}: {
  calendar: RpcExternalIcsCalendar;
  onClose: () => void;
  onDelete: () => Promise<void> | void;
  onSave: (
    input: IcsUpdateInput,
    options: { urlChanged: boolean },
  ) => Promise<void> | void;
}): JSX.Element {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(calendar.title);
  const [url, setUrl] = useState(calendar.url);
  const [color, setColor] = useState(calendar.color);
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(() =>
    REFRESH_INTERVAL_OPTIONS.some(
      (option) => option.value === calendar.refreshIntervalMinutes,
    )
      ? calendar.refreshIntervalMinutes
      : 240,
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    calendar.notificationsEnabled,
  );
  const [sourceNotificationsEnabled, setSourceNotificationsEnabled] = useState(
    calendar.notificationsEnabled && calendar.notificationMode === "source",
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletePromptOpen, setDeletePromptOpen] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const nextTitle = title.trim() || calendar.title;
    const nextUrl = url.trim();
    const nextColor = color.trim() || calendar.color;
    const nextSourceNotificationsEnabled = notificationsEnabled
      ? sourceNotificationsEnabled
      : false;
    const nextNotificationMode = nextSourceNotificationsEnabled
      ? "source"
      : "default";
    const urlChanged = nextUrl !== calendar.url;
    const changed =
      nextTitle !== calendar.title ||
      urlChanged ||
      nextColor !== calendar.color ||
      refreshIntervalMinutes !== calendar.refreshIntervalMinutes ||
      notificationsEnabled !== calendar.notificationsEnabled ||
      nextNotificationMode !== calendar.notificationMode;
    if (!changed) {
      onClose();
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await onSave(
        {
          color: nextColor,
          externalCalendarId: calendar.id,
          notificationMode: nextNotificationMode,
          notificationsEnabled,
          refreshIntervalMinutes,
          title: nextTitle,
          url: nextUrl,
        },
        { urlChanged },
      );
      onClose();
    } catch (saveError) {
      setFormError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
      setBusy(false);
    }
  };

  const deleteSubscription = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setDeletePromptOpen(true);
  };

  const confirmDeleteSubscription = async (): Promise<void> => {
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
        backdropLabel="Close ICS editor"
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
              Edit ICS - {calendar.title}
            </div>
            <AppButton
              aria-label="Close ICS editor"
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
                aria-label="Calendar title"
                className="h-8 w-full border border-border-default bg-surface-2 px-2 text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                disabled={busy}
                name="calendar-ics-title"
                onChange={(event) => setTitle(event.currentTarget.value)}
                ref={titleInputRef}
                value={title}
              />
            </label>
            <label className="block space-y-1">
              <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                URL
              </span>
              <input
                aria-label="Calendar URL"
                autoCapitalize="none"
                autoCorrect="off"
                className="h-8 w-full border border-border-default bg-surface-2 px-2 font-mono text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                disabled={busy}
                name="calendar-ics-url"
                onChange={(event) => setUrl(event.currentTarget.value)}
                spellCheck={false}
                value={url}
              />
            </label>
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                  Refresh
                </span>
                <select
                  className="h-8 w-full border border-border-default bg-surface-2 px-2 text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  disabled={busy}
                  name="calendar-ics-refresh-interval"
                  onChange={(event) =>
                    setRefreshIntervalMinutes(Number(event.currentTarget.value))
                  }
                  value={refreshIntervalMinutes}
                >
                  {REFRESH_INTERVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                  Color
                </span>
                <input
                  aria-label="Calendar color"
                  className="h-8 w-14 border border-border-default bg-surface-2 p-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  disabled={busy}
                  name="calendar-ics-color"
                  onChange={(event) => setColor(event.currentTarget.value)}
                  type="color"
                  value={color}
                />
              </label>
            </div>
            <div className="space-y-2 border-t border-border-subtle pt-3 text-xs text-text-secondary">
              <label className="flex items-center gap-2">
                <input
                  aria-label="Enable notifications"
                  checked={notificationsEnabled}
                  disabled={busy}
                  name="calendar-ics-notifications-enabled"
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setNotificationsEnabled(checked);
                    if (!checked) {
                      setSourceNotificationsEnabled(false);
                    }
                  }}
                  type="checkbox"
                />
                Enable Notifications
              </label>
              <label className="flex items-center gap-2">
                <input
                  aria-label="Notify source attendees"
                  checked={sourceNotificationsEnabled}
                  disabled={busy || !notificationsEnabled}
                  name="calendar-ics-source-notifications-enabled"
                  onChange={(event) =>
                    setSourceNotificationsEnabled(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span
                  className={
                    notificationsEnabled
                      ? "text-text-secondary"
                      : "text-text-faint"
                  }
                >
                  Enable Source Calendar Notifications
                </span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
            <AppButton
              buttonStyle="error"
              disabled={busy}
              onClick={() => {
                void deleteSubscription();
              }}
            >
              Delete
            </AppButton>
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
        message="Delete ICS subscription?"
        onCancel={() => setDeletePromptOpen(false)}
        onConfirm={() => {
          void confirmDeleteSubscription();
        }}
        open={deletePromptOpen}
        title="Delete ICS Subscription"
      />
    </>
  );
}

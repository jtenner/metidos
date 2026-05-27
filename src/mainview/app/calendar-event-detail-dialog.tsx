/**
 * @file src/mainview/app/calendar-event-detail-dialog.tsx
 * @description Read/action detail dialog for calendar occurrences.
 */

import type { JSX } from "react";
import type { RpcCalendarOccurrence } from "../../bun/calendar/types";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";
import { RichMarkdownMessage } from "./message-markdown";
import { safeExternalHttpUrl } from "./safe-external-url";

export const safeExternalCalendarUrl = safeExternalHttpUrl;

export function CalendarEventDetailDialog({
  occurrence,
  onClose,
  onDelete,
  onEdit,
}: {
  occurrence: RpcCalendarOccurrence;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const externalUrl = safeExternalCalendarUrl(occurrence.externalUrl);

  return (
    <ModalDialogSurface
      backdropLabel="Close event details"
      className="w-full max-w-xl border border-border-default bg-surface-1 text-text-primary shadow-overlay"
      onRequestClose={onClose}
      open
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="text-sm font-semibold">{occurrence.title}</div>
        <AppButton
          aria-label="Close event details"
          buttonStyle="muted"
          className="border-transparent bg-transparent"
          iconOnly
          onClick={onClose}
        >
          {materialSymbol("close", "text-[15px]")}
        </AppButton>
      </div>
      <div className="space-y-3 p-4 text-sm text-text-secondary">
        <div>
          <span className="text-text-faint">When:</span>{" "}
          {occurrence.allDay
            ? `${occurrence.startDate} – ${occurrence.endDate}`
            : `${new Date(occurrence.startAt ?? occurrence.originalStart).toLocaleString()} – ${occurrence.endAt ? new Date(occurrence.endAt).toLocaleString() : ""}`}
        </div>
        <div>
          <span className="text-text-faint">Calendar/source:</span>{" "}
          {occurrence.sourceType === "local"
            ? "Local calendar"
            : "External ICS"}
        </div>
        {occurrence.location ? (
          <div>
            <span className="text-text-faint">Location:</span>{" "}
            {occurrence.location}
          </div>
        ) : null}
        {occurrence.description ? (
          <div className="border-t border-border-subtle pt-3">
            <RichMarkdownMessage text={occurrence.description} />
          </div>
        ) : null}
        <div>
          <span className="text-text-faint">Recurrence:</span>{" "}
          {occurrence.recurrenceSummary}
        </div>
        {externalUrl ? (
          <a
            className="text-accent hover:text-accent-strong"
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open original event
          </a>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
        {occurrence.writable ? (
          <AppButton buttonStyle="error" onClick={onDelete}>
            Delete
          </AppButton>
        ) : null}
        {occurrence.writable ? (
          <AppButton buttonStyle="secondary" onClick={onEdit}>
            Edit
          </AppButton>
        ) : null}
        <AppButton buttonStyle="muted" onClick={onClose}>
          Close
        </AppButton>
      </div>
    </ModalDialogSurface>
  );
}

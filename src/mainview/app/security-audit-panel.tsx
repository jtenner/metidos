import {
  measureElement as defaultMeasureElement,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RpcProject, RpcSecurityAuditEvent } from "../../bun/rpc-schema";
import { type AppIconName, materialSymbol } from "../controls/icons";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleSecurityAuditPanelOpen,
  useSecurityAuditPanelOpen,
} from "./sidebar-panels-state";

type SecurityAuditPanelProps = {
  selectedProjectId: number | null;
  events: RpcSecurityAuditEvent[];
  error: string;
  hasLoaded: boolean;
  loading: boolean;
  onRefresh: (options?: {
    projectId?: number | null;
    threadId?: number | null;
  }) => void | Promise<void>;
  projects: RpcProject[];
  selectedThreadId: number | null;
};

const SECURITY_AUDIT_REFRESH_INTERVAL_MS = 15_000;
const SECURITY_AUDIT_VIRTUALIZATION_THRESHOLD = 40;
const SECURITY_AUDIT_ROW_ESTIMATE_PX = 112;
const SECURITY_AUDIT_VIRTUALIZATION_OVERSCAN = 8;
type AuditFilterScope = "all" | "project" | "thread";
const AUDIT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "short",
  timeStyle: "medium",
});

type SecurityAuditDisplayRow = {
  event: RpcSecurityAuditEvent;
  projectLabel: string | null;
};

function eventIconName(eventType: string): AppIconName {
  if (
    eventType.startsWith("auth_") ||
    eventType === "primary_factor_reset" ||
    eventType === "recovery_code_login" ||
    eventType === "recovery_codes_regenerated"
  ) {
    return "account_circle";
  }
  if (eventType.startsWith("unsafe_mode_")) {
    return "bolt";
  }
  if (eventType === "project_task_queued") {
    return "terminal";
  }
  if (eventType === "project_deleted") {
    return "delete";
  }
  if (eventType === "cross_workspace_thread_created") {
    return "arrow_forward";
  }
  return "checklist";
}

function formatAuditTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return AUDIT_TIMESTAMP_FORMATTER.format(timestamp);
}

function readPayloadProjectName(event: RpcSecurityAuditEvent): string | null {
  const projectName = event.payload?.projectName;
  return typeof projectName === "string" && projectName.trim()
    ? projectName
    : null;
}

export function shouldVirtualizeSecurityAuditRows(
  rowCount: number,
  threshold: number = SECURITY_AUDIT_VIRTUALIZATION_THRESHOLD,
): boolean {
  return rowCount >= threshold;
}

export function deriveSecurityAuditDisplayRows(
  events: RpcSecurityAuditEvent[],
  projectNames: ReadonlyMap<number, string>,
): SecurityAuditDisplayRow[] {
  return events.map((event) => ({
    event,
    projectLabel:
      readPayloadProjectName(event) ??
      (event.projectId !== null
        ? (projectNames.get(event.projectId) ?? `Project #${event.projectId}`)
        : null),
  }));
}

const SecurityAuditEventRow = memo(function SecurityAuditEventRow({
  detailsOpen,
  event,
  onToggleDetails,
  projectLabel,
  selectedThreadId,
}: {
  detailsOpen: boolean;
  event: RpcSecurityAuditEvent;
  onToggleDetails: (open: boolean) => void;
  projectLabel: string | null;
  selectedThreadId: number | null;
}) {
  const payloadText = useMemo(() => {
    if (!detailsOpen || event.payload === null) {
      return null;
    }
    return JSON.stringify(event.payload, null, 2);
  }, [detailsOpen, event.payload]);

  return (
    <article
      className={`border px-3 py-2.5 ${
        event.threadId !== null && event.threadId === selectedThreadId
          ? "border-[#4a6678] bg-[#14202a]"
          : "border-[#232b30] bg-[#15191b]"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center bg-[#111619] text-[#8ca6b9]">
          {materialSymbol(eventIconName(event.eventType), "text-[14px]")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-medium leading-4 text-[#f2f0ef]">
              {event.summaryText}
            </div>
            {event.threadId !== null && event.threadId === selectedThreadId ? (
              <span className="bg-[#24455e] px-1.5 py-0.5 font-label text-[9px] font-semibold uppercase tracking-[0.18em] text-[#d8ecf9]">
                Current Thread
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[10px] text-[#8f9aa2]">
            {formatAuditTimestamp(event.createdAt)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="bg-[#101416] px-1.5 py-0.5 font-mono text-[10px] text-[#8ca6b9]">
              {event.eventType}
            </span>
            {projectLabel ? (
              <span className="bg-[#101416] px-1.5 py-0.5 text-[10px] text-[#d0d7dc]">
                {projectLabel}
              </span>
            ) : null}
            {event.threadId !== null ? (
              <span className="bg-[#101416] px-1.5 py-0.5 text-[10px] text-[#d0d7dc]">
                Thread #{event.threadId}
              </span>
            ) : null}
            {event.worktreePath ? (
              <span className="max-w-full truncate bg-[#101416] px-1.5 py-0.5 font-mono text-[10px] text-[#d0d7dc]">
                {event.worktreePath}
              </span>
            ) : null}
          </div>
          {event.payload !== null ? (
            <details
              className="mt-2"
              open={detailsOpen}
              onToggle={(event) => {
                onToggleDetails(event.currentTarget.open);
              }}
            >
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-[#8ca6b9]">
                Event details
              </summary>
              {payloadText ? (
                <pre className="mt-2 overflow-x-auto bg-[#0f1315] px-2 py-2 text-[10px] leading-4 text-[#cdd8df]">
                  {payloadText}
                </pre>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>
    </article>
  );
});

export const SecurityAuditPanel = memo(function SecurityAuditPanel({
  selectedProjectId,
  events,
  error,
  hasLoaded,
  loading,
  onRefresh,
  projects,
  selectedThreadId,
}: SecurityAuditPanelProps) {
  const securityAuditOpen = useSecurityAuditPanelOpen();
  const [scope, setScope] = useState<AuditFilterScope>("all");
  const [expandedEventIds, setExpandedEventIds] = useState<Set<number>>(
    () => new Set(),
  );
  const lastRefreshKeyRef = useRef<string | null>(null);
  const eventListScrollRef = useRef<HTMLDivElement | null>(null);
  const eventRowHeightCacheRef = useRef<Map<number, number>>(new Map());
  const projectNames = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          project.id,
          project.name.trim() || project.path,
        ]),
      ),
    [projects],
  );
  const projectFilterAvailable = selectedProjectId !== null;
  const threadFilterAvailable = selectedThreadId !== null;

  const refreshOptions = useMemo(() => {
    switch (scope) {
      case "project":
        return projectFilterAvailable
          ? {
              projectId: selectedProjectId,
            }
          : {};
      case "thread":
        return threadFilterAvailable
          ? {
              threadId: selectedThreadId,
            }
          : {};
      default:
        return {};
    }
  }, [
    projectFilterAvailable,
    scope,
    selectedProjectId,
    selectedThreadId,
    threadFilterAvailable,
  ]);
  const refreshKey = `${scope}:${selectedProjectId ?? "none"}:${selectedThreadId ?? "none"}`;
  const displayRows = useMemo(
    () => deriveSecurityAuditDisplayRows(events, projectNames),
    [events, projectNames],
  );
  const useVirtualizedRows = shouldVirtualizeSecurityAuditRows(
    displayRows.length,
  );

  useEffect(() => {
    if (scope === "thread" && !threadFilterAvailable) {
      setScope(projectFilterAvailable ? "project" : "all");
      return;
    }
    if (scope === "project" && !projectFilterAvailable) {
      setScope("all");
    }
  }, [projectFilterAvailable, scope, threadFilterAvailable]);

  useEffect(() => {
    if (!securityAuditOpen || hasLoaded || loading) {
      return;
    }
    lastRefreshKeyRef.current = refreshKey;
    void onRefresh(refreshOptions);
  }, [
    hasLoaded,
    loading,
    onRefresh,
    refreshKey,
    refreshOptions,
    securityAuditOpen,
  ]);

  useEffect(() => {
    if (!securityAuditOpen || !hasLoaded) {
      return;
    }
    if (lastRefreshKeyRef.current === refreshKey) {
      return;
    }
    lastRefreshKeyRef.current = refreshKey;
    void onRefresh(refreshOptions);
  }, [hasLoaded, onRefresh, refreshKey, refreshOptions, securityAuditOpen]);

  useEffect(() => {
    if (!securityAuditOpen) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void onRefresh(refreshOptions);
    }, SECURITY_AUDIT_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [onRefresh, refreshOptions, securityAuditOpen]);

  useEffect(() => {
    const visibleEventIds = new Set(events.map((event) => event.id));
    setExpandedEventIds((current) => {
      let changed = false;
      const next = new Set<number>();
      for (const eventId of current) {
        if (visibleEventIds.has(eventId)) {
          next.add(eventId);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [events]);

  const toggleDetailsOpen = useCallback((eventId: number, open: boolean) => {
    setExpandedEventIds((current) => {
      const next = new Set(current);
      if (open) {
        next.add(eventId);
      } else {
        next.delete(eventId);
      }
      return next;
    });
  }, []);

  const measureAuditRowElement = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
    ): number => {
      const eventId = Number(element.dataset.eventId ?? "-1");
      const size = defaultMeasureElement(element, entry, instance);

      if (eventId >= 0) {
        eventRowHeightCacheRef.current.set(eventId, size);
      }

      return size;
    },
    [],
  );

  const auditVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: displayRows.length,
    estimateSize: (index) => {
      const eventId = displayRows[index]?.event.id;
      return eventId === undefined
        ? SECURITY_AUDIT_ROW_ESTIMATE_PX
        : (eventRowHeightCacheRef.current.get(eventId) ??
            SECURITY_AUDIT_ROW_ESTIMATE_PX);
    },
    gap: 8,
    getItemKey: (index) => displayRows[index]?.event.id ?? index,
    getScrollElement: () =>
      useVirtualizedRows ? eventListScrollRef.current : null,
    measureElement: measureAuditRowElement,
    overscan: SECURITY_AUDIT_VIRTUALIZATION_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });
  const virtualRows = auditVirtualizer.getVirtualItems();
  const totalVirtualSize = auditVirtualizer.getTotalSize();

  return (
    <section className="select-none">
      <SidebarSectionHeader
        title="Security"
        open={securityAuditOpen}
        onToggle={toggleSecurityAuditPanelOpen}
        action={
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center border border-[#243038] bg-[#161d21] text-[#8ca6b9] transition-colors hover:border-[#385062] hover:text-[#d6e5f0] disabled:cursor-default disabled:opacity-60"
            disabled={loading}
            onClick={() => {
              void onRefresh(refreshOptions);
            }}
            title="Refresh security audit log"
          >
            {materialSymbol(
              "history",
              loading ? "animate-spin text-[15px]" : "text-[15px]",
            )}
          </button>
        }
      />
      {securityAuditOpen ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["project", "Project"],
                ["thread", "Thread"],
              ] as const
            ).map(([nextScope, label]) => {
              const disabled =
                (nextScope === "project" && !projectFilterAvailable) ||
                (nextScope === "thread" && !threadFilterAvailable);
              const active = scope === nextScope;

              return (
                <button
                  type="button"
                  key={nextScope}
                  className={`px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    active
                      ? "bg-[#24455e] text-[#d8ecf9]"
                      : "bg-[#14181a] text-[#8ca6b9]"
                  } ${disabled ? "opacity-40" : "hover:bg-[#1a2328] hover:text-[#d6e5f0]"}`}
                  disabled={disabled}
                  onClick={() => {
                    setScope(nextScope);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {!hasLoaded && loading ? (
            <div className="bg-[#151b20] px-3 py-2.5 text-xs text-[#d4e4ef]">
              Loading security audit log...
            </div>
          ) : displayRows.length > 0 ? (
            <div
              className="max-h-80 overflow-y-auto pr-1 hide-scrollbar"
              ref={eventListScrollRef}
            >
              {useVirtualizedRows ? (
                <div
                  className="relative w-full"
                  style={{
                    height: `${totalVirtualSize}px`,
                  }}
                >
                  {virtualRows.map((virtualRow) => {
                    const row = displayRows[virtualRow.index];
                    if (!row) {
                      return null;
                    }

                    return (
                      <div
                        className="absolute left-0 top-0 w-full"
                        data-event-id={row.event.id}
                        key={virtualRow.key}
                        ref={auditVirtualizer.measureElement}
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <SecurityAuditEventRow
                          detailsOpen={expandedEventIds.has(row.event.id)}
                          event={row.event}
                          onToggleDetails={(open) => {
                            toggleDetailsOpen(row.event.id, open);
                          }}
                          projectLabel={row.projectLabel}
                          selectedThreadId={selectedThreadId}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  {displayRows.map((row) => (
                    <SecurityAuditEventRow
                      detailsOpen={expandedEventIds.has(row.event.id)}
                      event={row.event}
                      key={row.event.id}
                      onToggleDetails={(open) => {
                        toggleDetailsOpen(row.event.id, open);
                      }}
                      projectLabel={row.projectLabel}
                      selectedThreadId={selectedThreadId}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : hasLoaded ? (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              No security audit events recorded yet.
            </div>
          ) : null}
          {error ? (
            <div className="bg-[#2c1117] px-3 py-2 text-[11px] text-[#ff9db0]">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

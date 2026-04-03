import { memo, useEffect, useMemo } from "react";

import type { RpcProject, RpcSecurityAuditEvent } from "../../bun/rpc-schema";
import { type AppIconName, materialSymbol } from "../controls/icons";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleSecurityAuditPanelOpen,
  useSecurityAuditPanelOpen,
} from "./sidebar-panels-state";

type SecurityAuditPanelProps = {
  events: RpcSecurityAuditEvent[];
  error: string;
  hasLoaded: boolean;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  projects: RpcProject[];
  selectedThreadId: number | null;
};

const SECURITY_AUDIT_REFRESH_INTERVAL_MS = 15_000;

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
  return new Date(value).toLocaleString();
}

function readPayloadProjectName(event: RpcSecurityAuditEvent): string | null {
  const projectName = event.payload?.projectName;
  return typeof projectName === "string" && projectName.trim()
    ? projectName
    : null;
}

export const SecurityAuditPanel = memo(function SecurityAuditPanel({
  events,
  error,
  hasLoaded,
  loading,
  onRefresh,
  projects,
  selectedThreadId,
}: SecurityAuditPanelProps) {
  const securityAuditOpen = useSecurityAuditPanelOpen();
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

  useEffect(() => {
    if (!securityAuditOpen || hasLoaded || loading) {
      return;
    }
    void onRefresh();
  }, [hasLoaded, loading, onRefresh, securityAuditOpen]);

  useEffect(() => {
    if (!securityAuditOpen) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void onRefresh();
    }, SECURITY_AUDIT_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [onRefresh, securityAuditOpen]);

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
              void onRefresh();
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
          {!hasLoaded && loading ? (
            <div className="bg-[#151b20] px-3 py-2.5 text-xs text-[#d4e4ef]">
              Loading security audit log...
            </div>
          ) : events.length > 0 ? (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1 hide-scrollbar">
              {events.map((event) => {
                const projectLabel =
                  readPayloadProjectName(event) ??
                  (event.projectId !== null
                    ? (projectNames.get(event.projectId) ??
                      `Project #${event.projectId}`)
                    : null);
                const payloadText =
                  event.payload === null
                    ? null
                    : JSON.stringify(event.payload, null, 2);

                return (
                  <article
                    key={event.id}
                    className={`border px-3 py-2.5 ${
                      event.threadId !== null &&
                      event.threadId === selectedThreadId
                        ? "border-[#4a6678] bg-[#14202a]"
                        : "border-[#232b30] bg-[#15191b]"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center bg-[#111619] text-[#8ca6b9]">
                        {materialSymbol(
                          eventIconName(event.eventType),
                          "text-[14px]",
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[13px] font-medium leading-4 text-[#f2f0ef]">
                            {event.summaryText}
                          </div>
                          {event.threadId !== null &&
                          event.threadId === selectedThreadId ? (
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
                        {payloadText ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-[#8ca6b9]">
                              Event details
                            </summary>
                            <pre className="mt-2 overflow-x-auto bg-[#0f1315] px-2 py-2 text-[10px] leading-4 text-[#cdd8df]">
                              {payloadText}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
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

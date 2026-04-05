import { describe, expect, it } from "bun:test";

import type { RpcSecurityAuditEvent } from "../../bun/rpc-schema";
import {
  deriveSecurityAuditDisplayRows,
  shouldVirtualizeSecurityAuditRows,
} from "./security-audit-panel";

function auditEvent(
  id: number,
  overrides?: Partial<RpcSecurityAuditEvent>,
): RpcSecurityAuditEvent {
  return {
    createdAt: "2026-04-04T12:00:00.000Z",
    eventType: "unsafe_mode_enabled",
    id,
    payload: null,
    projectId: null,
    summaryText: `Event ${id}`,
    threadId: null,
    worktreePath: null,
    ...overrides,
  };
}

describe("security audit panel helpers", () => {
  it("virtualizes only once the audit list crosses the threshold", () => {
    expect(shouldVirtualizeSecurityAuditRows(39)).toBeFalse();
    expect(shouldVirtualizeSecurityAuditRows(40)).toBeTrue();
  });

  it("derives project labels with payload names first, then project map, then id fallback", () => {
    const rows = deriveSecurityAuditDisplayRows(
      [
        auditEvent(1, {
          payload: {
            projectName: "Payload Project",
          },
          projectId: 7,
        }),
        auditEvent(2, {
          projectId: 9,
        }),
        auditEvent(3, {
          projectId: 11,
        }),
      ],
      new Map([[9, "Mapped Project"]]),
    );

    expect(rows.map((row) => row.projectLabel)).toEqual([
      "Payload Project",
      "Mapped Project",
      "Project #11",
    ]);
  });
});

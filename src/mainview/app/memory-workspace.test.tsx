/**
 * @file src/mainview/app/memory-workspace.test.tsx
 * @description Focused render tests for the Memory Observatory workspace.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectProcedures } from "../../bun/rpc-schema";
import { MemoryWorkspace } from "./memory-workspace";

function procedures(): MemoryWorkspaceTestProcedures {
  return {
    eraseMemory: async () => ({
      erasedEvidenceIds: [],
      erasedFactIds: [],
      evidenceCount: 0,
      factCount: 0,
    }),
    getMemoryEvidenceDetail: async () => null,
    getMemoryFactDetail: async () => null,
    getMemoryStats: async () => ({
      activeFacts: 0,
      evidenceRows: 0,
      rejectedFacts: 0,
      supersededFacts: 0,
      erasedFacts: 0,
      averageRecallLatency: 0,
    }),
    listMemoryEvidence: async () => ({ evidence: [], limit: 25 }),
    listMemoryRecallEvents: async () => [],
    listMemoryWriteEvents: async () => [],
    searchMemoryFacts: async () => ({ facts: [], limit: 50 }),
  };
}

type MemoryWorkspaceTestProcedures = Pick<
  ProjectProcedures,
  | "searchMemoryFacts"
  | "getMemoryFactDetail"
  | "getMemoryEvidenceDetail"
  | "listMemoryEvidence"
  | "listMemoryRecallEvents"
  | "listMemoryWriteEvents"
  | "getMemoryStats"
  | "eraseMemory"
>;

function renderMemoryWorkspace() {
  return renderToStaticMarkup(
    <MemoryWorkspace
      procedures={procedures()}
      selectedProjectId={1}
      selectedWorktreePath="/repo"
    />,
  );
}

describe("MemoryWorkspace", () => {
  it("renders the Memory Observatory empty state and permission-gated explanation", () => {
    const markup = renderMemoryWorkspace();
    expect(markup).toContain("Memory Observatory");
    expect(markup).toContain("permission-gated");
    expect(markup).toContain("No memory exists");
    expect(markup).toContain("metidos:memory");
  });

  it("renders search and filter controls", () => {
    const markup = renderMemoryWorkspace();
    expect(markup).toContain("Search facts and evidence");
    expect(markup).toContain("any status");
    expect(markup).toContain("factType");
    expect(markup).toContain("any kind");
    expect(markup).toContain("scopeEntity");
    expect(markup).toContain("newest");
  });

  it("renders diagnostics and erasure panels with explicit FORGET confirmation", () => {
    const markup = renderMemoryWorkspace();
    expect(markup).toContain("Evidence");
    expect(markup).toContain("Recall events");
    expect(markup).toContain("Write events");
    expect(markup).toContain("Erasure");
    expect(markup).toContain("Type FORGET");
    expect(markup).toContain("Erase fact");
  });
});

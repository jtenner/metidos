/**
 * @file src/mainview/app/memory-workspace.tsx
 * @description Memory Observatory workspace for inspecting Metidos long-term memory.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type {
  ProjectProcedures,
  RpcMemoryEvidencePreview,
  RpcMemoryFactPreview,
} from "../../bun/rpc-schema";
import { AppButton } from "../controls/button";

type MemoryRecallRow = {
  id: number;
  query?: string;
  resultCount?: number;
  latencyMs?: number;
};

type MemoryWriteRow = {
  id: number;
  evidenceId?: number | null;
  acceptedFactIds?: number[];
  rejectedFacts?: unknown[];
  latencyMs?: number;
};

type MemoryWorkspaceProps = {
  procedures: Pick<
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
  selectedProjectId: number | null;
  selectedWorktreePath: string | null;
};

const inputClass =
  "h-8 border border-border-default bg-surface-1 px-2 text-[13px] text-text-primary outline-none focus:border-focus-ring";

export function MemoryWorkspace({
  procedures,
  selectedProjectId,
  selectedWorktreePath,
}: MemoryWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [factType, setFactType] = useState("");
  const [memoryKind, setMemoryKind] = useState("");
  const [scopeEntity, setScopeEntity] = useState("");
  const [sort, setSort] = useState("newest");
  const [facts, setFacts] = useState<RpcMemoryFactPreview[]>([]);
  const [selectedFactId, setSelectedFactId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [evidence, setEvidence] = useState<RpcMemoryEvidencePreview[]>([]);
  const [recalls, setRecalls] = useState<MemoryRecallRow[]>([]);
  const [writes, setWrites] = useState<MemoryWriteRow[]>([]);
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [forgetPhrase, setForgetPhrase] = useState("");
  const scope = useMemo(
    () => ({
      ...(selectedProjectId !== null ? { projectId: selectedProjectId } : {}),
      ...(selectedWorktreePath !== null
        ? { worktreePath: selectedWorktreePath }
        : {}),
    }),
    [selectedProjectId, selectedWorktreePath],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const factQuery = {
        ...scope,
        ...(query ? { query } : {}),
        ...(status ? { status } : {}),
        ...(factType ? { factType } : {}),
        ...(memoryKind ? { memoryKind } : {}),
        ...(scopeEntity ? { scopeEntity } : {}),
        sort,
        limit: 50,
      };
      const evidenceQuery = {
        ...scope,
        ...(query ? { query } : {}),
        limit: 25,
      };
      const [
        factResult,
        evidenceResult,
        recallResult,
        writeResult,
        statsResult,
      ] = await Promise.all([
        procedures.searchMemoryFacts(factQuery),
        procedures.listMemoryEvidence(evidenceQuery),
        procedures.listMemoryRecallEvents({ ...scope, limit: 25 }),
        procedures.listMemoryWriteEvents({ ...scope, limit: 25 }),
        procedures.getMemoryStats(scope),
      ]);
      setFacts(factResult.facts);
      setEvidence(evidenceResult.evidence);
      setRecalls(recallResult as MemoryRecallRow[]);
      setWrites(writeResult as MemoryWriteRow[]);
      setStats(statsResult);
      setSelectedFactId(
        (current) => current ?? factResult.facts[0]?.id ?? null,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load memory observatory data.",
      );
    }
  }, [
    factType,
    memoryKind,
    procedures,
    query,
    scope,
    scopeEntity,
    sort,
    status,
  ]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!selectedFactId) {
      setDetail(null);
      return;
    }
    procedures
      .getMemoryFactDetail({ factId: selectedFactId })
      .then((next) => setDetail(next as Record<string, unknown> | null))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Unable to load fact detail.",
        ),
      );
  }, [selectedFactId, procedures]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };
  const eraseSelected = async () => {
    if (
      !selectedFactId ||
      forgetPhrase !== "FORGET" ||
      !selectedProjectId ||
      !selectedWorktreePath
    )
      return;
    await procedures.eraseMemory({
      projectId: selectedProjectId,
      worktreePath: selectedWorktreePath,
      factIds: [selectedFactId],
      confirm: forgetPhrase,
    });
    setForgetPhrase("");
    setDetail(null);
    await load();
  };

  return (
    <main className="flex h-full min-h-0 flex-col bg-bg-main text-text-primary">
      <header className="border-b border-border-subtle px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[16px] font-bold">Memory Observatory</h1>
            <p className="mt-1 text-xs text-text-muted">
              Provenance-grounded, permission-gated long-term memory. Memory
              tools are default-off and installed only with metidos:memory.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px] text-text-secondary md:grid-cols-6">
            <span>Active: {String(stats.activeFacts ?? 0)}</span>
            <span>Evidence: {String(stats.evidenceRows ?? 0)}</span>
            <span>Rejected: {String(stats.rejectedFacts ?? 0)}</span>
            <span>Superseded: {String(stats.supersededFacts ?? 0)}</span>
            <span>Erased: {String(stats.erasedFacts ?? 0)}</span>
            <span>
              Recall avg: {Math.round(Number(stats.averageRecallLatency ?? 0))}
              ms
            </span>
          </div>
        </div>
      </header>
      <form
        className="border-b border-border-subtle px-4 py-2"
        onSubmit={submit}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} min-w-[220px] flex-1`}
            placeholder="Search facts and evidence"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <select
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value)}
          >
            <option value="">any status</option>
            <option>active</option>
            <option>superseded</option>
            <option>rejected</option>
            <option>erased</option>
          </select>
          <input
            className={inputClass}
            placeholder="factType"
            value={factType}
            onChange={(event) => setFactType(event.currentTarget.value)}
          />
          <select
            className={inputClass}
            value={memoryKind}
            onChange={(event) => setMemoryKind(event.currentTarget.value)}
          >
            <option value="">any kind</option>
            <option>canonical</option>
            <option>observation</option>
            <option>technical</option>
          </select>
          <input
            className={inputClass}
            placeholder="scopeEntity"
            value={scopeEntity}
            onChange={(event) => setScopeEntity(event.currentTarget.value)}
          />
          <select
            className={inputClass}
            value={sort}
            onChange={(event) => setSort(event.currentTarget.value)}
          >
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
            <option value="confidence">confidence</option>
          </select>
          <AppButton type="submit" buttonStyle="secondary">
            Search
          </AppButton>
        </div>
      </form>
      {error ? (
        <div className="border-b border-danger-border px-4 py-2 text-xs text-danger-text">
          {error}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(320px,42%)_1fr]">
        <section className="min-h-0 overflow-auto border-r border-border-subtle">
          {facts.length === 0 ? (
            <div className="p-4 text-sm text-text-muted">
              No memory exists for the current filters. Enable metidos:memory on
              a thread and use memory_remember to create provenance-grounded
              facts.
            </div>
          ) : (
            facts.map((fact) => (
              <button
                key={fact.id}
                type="button"
                onClick={() => setSelectedFactId(fact.id)}
                className={`block w-full border-b border-border-subtle px-4 py-3 text-left hover:bg-surface-1 ${selectedFactId === fact.id ? "bg-surface-1" : ""}`}
              >
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span>M{fact.id}</span>
                  <span>{fact.status}</span>
                  <span>{fact.factType}</span>
                  <span>{fact.memoryKind}</span>
                  <span>{Math.round(fact.confidence * 100)}%</span>
                </div>
                <div className="mt-1 text-[13px] leading-5 text-text-primary">
                  {fact.statement}
                </div>
                <div className="mt-1 text-[11px] text-text-faint">
                  Scope {fact.scopeEntity ?? "project"} · Evidence{" "}
                  {fact.evidenceCount} · Recalls {fact.recallCount} ·{" "}
                  {fact.updatedAt}
                </div>
              </button>
            ))
          )}
        </section>
        <section className="min-h-0 overflow-auto p-4">
          <h2 className="text-[14px] font-semibold">Fact detail</h2>
          {detail ? (
            <pre className="mt-2 max-h-[360px] overflow-auto border border-border-subtle bg-surface-1 p-3 font-mono text-[11px] text-text-secondary">
              {JSON.stringify(detail, null, 2)}
            </pre>
          ) : (
            <p className="mt-2 text-sm text-text-muted">
              Select a fact to inspect lifecycle, validation diagnostics,
              supersession, and provenance.
            </p>
          )}
          <div className="mt-4 border-t border-border-subtle pt-3">
            <h3 className="text-[13px] font-semibold">Erasure</h3>
            <div className="mt-2 flex items-center gap-2">
              <input
                className={inputClass}
                placeholder="Type FORGET"
                value={forgetPhrase}
                onChange={(event) => setForgetPhrase(event.currentTarget.value)}
              />
              <AppButton
                buttonStyle="error"
                disabled={forgetPhrase !== "FORGET" || !selectedFactId}
                onClick={eraseSelected}
              >
                Erase fact
              </AppButton>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <section>
              <h3 className="text-[13px] font-semibold">Evidence</h3>
              <ul className="mt-2 space-y-2 text-xs text-text-secondary">
                {evidence.map((item) => (
                  <li
                    key={item.id}
                    className="border-b border-border-subtle pb-2"
                  >
                    E{item.id} {item.sourceKind}: {item.textPreview}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="text-[13px] font-semibold">Recall events</h3>
              <ul className="mt-2 space-y-2 text-xs text-text-secondary">
                {recalls.map((item) => (
                  <li
                    key={item.id}
                    className="border-b border-border-subtle pb-2"
                  >
                    {item.query} · {item.resultCount} results · {item.latencyMs}
                    ms
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="text-[13px] font-semibold">Write events</h3>
              <ul className="mt-2 space-y-2 text-xs text-text-secondary">
                {writes.map((item) => (
                  <li
                    key={item.id}
                    className="border-b border-border-subtle pb-2"
                  >
                    E{item.evidenceId} accepted{" "}
                    {item.acceptedFactIds?.length ?? 0} rejected{" "}
                    {item.rejectedFacts?.length ?? 0} · {item.latencyMs}ms
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

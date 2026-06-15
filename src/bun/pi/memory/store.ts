/**
 * @file src/bun/pi/memory/store.ts
 * @description SQLite authoritative store for provenance-grounded memory.
 */

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { extractMemorySignals, summarizeSignals } from "./signals";
import { validateMemoryFact } from "./validation";
import type {
  MemoryEvidenceInput,
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryRecallFact,
  MemoryRememberInput,
  MemoryRememberResult,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function run(
  db: Database,
  sql: string,
  ...bindings: unknown[]
): ReturnType<Database["run"]> {
  return bindings.length === 0 ? db.run(sql) : db.run(sql, bindings as never);
}

function boundedLimit(limit: number | null | undefined, fallback = 50): number {
  if (!Number.isFinite(limit ?? Number.NaN)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(limit as number)));
}

export function redactMemoryPreview(text: string, maxLength = 240): string {
  return text
    .replace(
      /\b(?:sk|pk|rk|ghp|github_pat)_[A-Za-z0-9_=-]{12,}\b/gu,
      "[redacted-token]",
    )
    .replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu,
      "[redacted-email]",
    )
    .slice(0, maxLength);
}

export function createMemoryEvidence(
  db: Database,
  input: MemoryEvidenceInput,
): { id: number; textSha256: string } {
  const textSha256 = sha256(input.text);
  const result = run(
    db,
    `INSERT INTO memory_evidence (project_id, worktree_path, origin_thread_id, origin_message_id, source_kind, source_role, text, text_sha256, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.projectId,
    input.worktreePath,
    input.originThreadId ?? null,
    input.originMessageId ?? null,
    input.sourceKind,
    input.sourceRole ?? null,
    input.text,
    textSha256,
    json(input.metadata),
  );
  const id = Number(result.lastInsertRowid);
  run(
    db,
    `INSERT INTO memory_evidence_fts(rowid, text) VALUES (?, ?)`,
    id,
    input.text,
  );
  return { id, textSha256 };
}

export function rememberMemoryFacts(
  db: Database,
  input: MemoryRememberInput,
): MemoryRememberResult {
  const started = Date.now();
  const evidence = createMemoryEvidence(db, input);
  const signals = extractMemorySignals(input.text);
  for (const signal of signals) {
    run(
      db,
      `INSERT INTO memory_signals (evidence_id, kind, value, normalized_value, start_offset, end_offset, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      evidence.id,
      signal.kind,
      signal.value,
      signal.normalizedValue ?? null,
      signal.startOffset ?? null,
      signal.endOffset ?? null,
      signal.confidence ?? 1,
    );
  }

  const accepted: MemoryRememberResult["accepted"] = [];
  const rejected: MemoryRememberResult["rejected"] = [];
  const allSuperseded: number[] = [];
  const failures: Record<string, number> = {};

  for (const candidate of input.facts) {
    const validation = validateMemoryFact({
      candidate,
      evidenceText: input.text,
      evidenceSignals: signals,
      knownContextEntities: [
        String(input.projectId),
        input.worktreePath,
        `thread:${input.originThreadId ?? ""}`,
      ],
    });
    if (!validation.accepted) {
      for (const reason of validation.diagnostics.reasons)
        failures[reason] = (failures[reason] ?? 0) + 1;
      const rejectedInsert = run(
        db,
        `INSERT INTO memory_facts (project_id, worktree_path, origin_thread_id, statement, fact_type, memory_kind, scope_entity, status, mutable, confidence, validation_json, metadata_json, valid_from, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?, ?, ?, ?, ?)`,
        input.projectId,
        input.worktreePath,
        input.originThreadId ?? null,
        candidate.statement,
        candidate.factType,
        candidate.memoryKind ?? "canonical",
        candidate.scopeEntity ?? null,
        candidate.mutable === false ? 0 : 1,
        validation.confidence,
        json(validation),
        json(candidate.metadata),
        candidate.validFrom ?? null,
        candidate.validUntil ?? null,
      );
      run(
        db,
        `INSERT INTO memory_fact_evidence (fact_id, evidence_id, support_kind, excerpt) VALUES (?, ?, 'rejected_source', ?)`,
        Number(rejectedInsert.lastInsertRowid),
        evidence.id,
        redactMemoryPreview(input.text, 500),
      );
      rejected.push({
        statement: candidate.statement,
        reasons: validation.diagnostics.reasons,
        validation,
      });
      continue;
    }

    const supersededFactIds: number[] = [];
    const shouldSupersede =
      (candidate.mutable ?? true) &&
      (candidate.memoryKind ?? "canonical") === "canonical" &&
      candidate.scopeEntity;
    let explicitSupersedes = candidate.supersedesFactId ?? null;
    if (shouldSupersede) {
      const rows = db
        .query<{ id: number }, [number, string, string, string]>(
          `SELECT id FROM memory_facts
         WHERE project_id = ? AND worktree_path = ? AND fact_type = ? AND scope_entity = ?
           AND status = 'active' AND mutable = 1 AND memory_kind = 'canonical' AND erased_at IS NULL
         ORDER BY updated_at DESC`,
        )
        .all(
          input.projectId,
          input.worktreePath,
          candidate.factType,
          candidate.scopeEntity ?? "",
        );
      for (const row of rows) supersededFactIds.push(row.id);
      explicitSupersedes ??= supersededFactIds[0] ?? null;
    }

    const result = run(
      db,
      `INSERT INTO memory_facts (project_id, worktree_path, origin_thread_id, statement, fact_type, memory_kind, scope_entity, mutable, confidence, validation_json, metadata_json, valid_from, valid_until, supersedes_fact_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.projectId,
      input.worktreePath,
      input.originThreadId ?? null,
      candidate.statement,
      candidate.factType,
      candidate.memoryKind ?? "canonical",
      candidate.scopeEntity ?? null,
      candidate.mutable === false ? 0 : 1,
      validation.confidence,
      json(validation),
      json(candidate.metadata),
      candidate.validFrom ?? null,
      candidate.validUntil ?? null,
      explicitSupersedes,
    );
    const factId = Number(result.lastInsertRowid);
    run(
      db,
      `INSERT INTO memory_fact_evidence (fact_id, evidence_id, support_kind, excerpt) VALUES (?, ?, 'source', ?)`,
      factId,
      evidence.id,
      redactMemoryPreview(input.text, 500),
    );
    run(
      db,
      `INSERT INTO memory_facts_fts(rowid, statement, scope_entity, fact_type) VALUES (?, ?, ?, ?)`,
      factId,
      candidate.statement,
      candidate.scopeEntity ?? "",
      candidate.factType,
    );
    for (const oldId of supersededFactIds) {
      if (oldId === factId) continue;
      run(
        db,
        `UPDATE memory_facts SET status = 'superseded', superseded_by_fact_id = ?, updated_at = ? WHERE id = ?`,
        factId,
        nowIso(),
        oldId,
      );
      run(db, `DELETE FROM memory_facts_fts WHERE rowid = ?`, oldId);
    }
    allSuperseded.push(...supersededFactIds);
    accepted.push({
      id: factId,
      statement: candidate.statement,
      supersededFactIds,
    });
  }

  const latencyMs = Date.now() - started;
  const diagnostics = {
    evidenceId: evidence.id,
    textSha256: evidence.textSha256,
    signalCountsByKind: summarizeSignals(signals),
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    validationFailuresByReason: failures,
    supersededFactIds: allSuperseded,
    latencyMs,
  };
  run(
    db,
    `INSERT INTO memory_write_events (project_id, worktree_path, thread_id, evidence_id, accepted_fact_ids_json, rejected_facts_json, signal_summary_json, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.projectId,
    input.worktreePath,
    input.originThreadId ?? null,
    evidence.id,
    json(accepted.map((fact) => fact.id)),
    json(rejected),
    json(diagnostics.signalCountsByKind),
    latencyMs,
  );
  return {
    evidenceId: evidence.id,
    textSha256: evidence.textSha256,
    accepted,
    rejected,
    diagnostics,
  };
}

export function getMemoryFact(
  db: Database,
  factId: number,
): Record<string, unknown> | null {
  return (
    db
      .query<Record<string, unknown>, [number]>(
        `SELECT * FROM memory_facts WHERE id = ?`,
      )
      .get(factId) ?? null
  );
}

export function getMemoryEvidence(
  db: Database,
  evidenceId: number,
): Record<string, unknown> | null {
  return (
    db
      .query<Record<string, unknown>, [number]>(
        `SELECT * FROM memory_evidence WHERE id = ?`,
      )
      .get(evidenceId) ?? null
  );
}

export function upsertMemoryFactEmbedding(
  db: Database,
  input: {
    factId: number;
    projectId: number;
    worktreePath: string;
    embedding: number[];
    modelKey?: string | null;
  },
): void {
  if (input.embedding.length === 0) {
    return;
  }
  run(
    db,
    `INSERT INTO memory_embeddings (fact_id, project_id, worktree_path, embedding_json, embedding_dimensions, model_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(fact_id) DO UPDATE SET
       embedding_json = excluded.embedding_json,
       embedding_dimensions = excluded.embedding_dimensions,
       model_key = excluded.model_key,
       updated_at = excluded.updated_at`,
    input.factId,
    input.projectId,
    input.worktreePath,
    JSON.stringify(input.embedding),
    input.embedding.length,
    input.modelKey ?? null,
  );
}

export function eraseMemory(
  db: Database,
  input: MemoryForgetInput,
): MemoryForgetResult {
  if (input.confirm !== "FORGET")
    throw new Error('memory_forget requires confirm === "FORGET".');
  const erasedAt = nowIso();
  const factIds = new Set(input.factIds ?? []);
  const evidenceIds = new Set(input.evidenceIds ?? []);
  if (input.query?.trim()) {
    const rows = searchMemoryFactsForObservability(db, {
      projectId: input.projectId,
      worktreePath: input.worktreePath,
      query: input.query,
      limit: 50,
    });
    for (const row of rows.facts) factIds.add(row.id);
  }
  for (const evidenceId of [...evidenceIds]) {
    const linked = db
      .query<{ fact_id: number }, [number, number, string]>(
        `SELECT mfe.fact_id FROM memory_fact_evidence mfe JOIN memory_facts mf ON mf.id = mfe.fact_id WHERE mfe.evidence_id = ? AND mf.project_id = ? AND mf.worktree_path = ?`,
      )
      .all(evidenceId, input.projectId, input.worktreePath);
    for (const row of linked) factIds.add(row.fact_id);
  }
  for (const factId of factIds) {
    run(
      db,
      `UPDATE memory_facts SET status = 'erased', erased_at = ?, updated_at = ? WHERE id = ? AND project_id = ? AND worktree_path = ?`,
      erasedAt,
      erasedAt,
      factId,
      input.projectId,
      input.worktreePath,
    );
    run(db, `DELETE FROM memory_facts_fts WHERE rowid = ?`, factId);
    run(db, `DELETE FROM memory_embeddings WHERE fact_id = ?`, factId);
  }
  for (const evidenceId of evidenceIds) {
    run(
      db,
      `UPDATE memory_evidence SET erased_at = ? WHERE id = ? AND project_id = ? AND worktree_path = ?`,
      erasedAt,
      evidenceId,
      input.projectId,
      input.worktreePath,
    );
    run(db, `DELETE FROM memory_evidence_fts WHERE rowid = ?`, evidenceId);
  }
  return {
    erasedFactIds: [...factIds],
    erasedEvidenceIds: [...evidenceIds],
    factCount: factIds.size,
    evidenceCount: evidenceIds.size,
  };
}

export function searchMemoryFactsForObservability(
  db: Database,
  input: {
    projectId?: number;
    worktreePath?: string;
    query?: string;
    status?: string;
    factType?: string;
    memoryKind?: string;
    scopeEntity?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  },
) {
  const limit = boundedLimit(input.limit);
  const where = ["1 = 1"];
  const bindings: unknown[] = [];
  if (input.projectId) {
    where.push("mf.project_id = ?");
    bindings.push(input.projectId);
  }
  if (input.worktreePath) {
    where.push("mf.worktree_path = ?");
    bindings.push(input.worktreePath);
  }
  if (input.status) {
    where.push("mf.status = ?");
    bindings.push(input.status);
  }
  if (input.factType) {
    where.push("mf.fact_type = ?");
    bindings.push(input.factType);
  }
  if (input.memoryKind) {
    where.push("mf.memory_kind = ?");
    bindings.push(input.memoryKind);
  }
  if (input.scopeEntity) {
    where.push("mf.scope_entity LIKE ?");
    bindings.push(`%${input.scopeEntity}%`);
  }
  if (input.query?.trim()) {
    where.push(
      "mf.id IN (SELECT rowid FROM memory_facts_fts WHERE memory_facts_fts MATCH ?)",
    );
    bindings.push(
      input.query
        .trim()
        .match(/[A-Za-z0-9_.@/-]{2,}/gu)
        ?.map((term) => `"${term.replace(/"/gu, "")}"`)
        .join(" OR ") ?? "",
    );
  }
  const order =
    input.sort === "oldest"
      ? "mf.updated_at ASC"
      : input.sort === "confidence"
        ? "mf.confidence DESC, mf.updated_at DESC"
        : "mf.updated_at DESC";
  const facts = db
    .query<any, any[]>(
      `SELECT mf.*, (SELECT count(*) FROM memory_fact_evidence mfe WHERE mfe.fact_id = mf.id) AS evidence_count,
            (SELECT count(*) FROM memory_recall_events mre WHERE mre.result_fact_ids_json LIKE '%"' || mf.id || '"%' OR mre.result_fact_ids_json LIKE '%' || mf.id || '%') AS recall_count
     FROM memory_facts mf WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...bindings, limit, input.offset ?? 0)
    .map(mapFactPreview);
  return { facts, limit };
}

function mapFactPreview(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    worktreePath: row.worktree_path,
    originThreadId: row.origin_thread_id,
    statement: redactMemoryPreview(String(row.statement ?? ""), 360),
    factType: row.fact_type,
    memoryKind: row.memory_kind,
    scopeEntity: row.scope_entity,
    status: row.status,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    erasedAt: row.erased_at,
    supersedesFactId: row.supersedes_fact_id,
    supersededByFactId: row.superseded_by_fact_id,
    evidenceCount: row.evidence_count ?? 0,
    recallCount: row.recall_count ?? 0,
  };
}

export const listMemoryFactsForObservability =
  searchMemoryFactsForObservability;

export function listMemoryEvidenceForObservability(
  db: Database,
  input: {
    projectId?: number;
    worktreePath?: string;
    query?: string;
    limit?: number;
    offset?: number;
  },
) {
  const limit = boundedLimit(input.limit);
  const where = ["1 = 1"];
  const bindings: unknown[] = [];
  if (input.projectId) {
    where.push("project_id = ?");
    bindings.push(input.projectId);
  }
  if (input.worktreePath) {
    where.push("worktree_path = ?");
    bindings.push(input.worktreePath);
  }
  if (input.query?.trim()) {
    where.push(
      "id IN (SELECT rowid FROM memory_evidence_fts WHERE memory_evidence_fts MATCH ?)",
    );
    bindings.push(
      input.query
        .trim()
        .match(/[A-Za-z0-9_.@/-]{2,}/gu)
        ?.map((term) => `"${term.replace(/"/gu, "")}"`)
        .join(" OR ") ?? "",
    );
  }
  const evidence = db
    .query<any, any[]>(
      `SELECT *, substr(text, 1, 240) AS text_preview FROM memory_evidence WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...bindings, limit, input.offset ?? 0)
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      worktreePath: row.worktree_path,
      originThreadId: row.origin_thread_id,
      originMessageId: row.origin_message_id,
      sourceKind: row.source_kind,
      sourceRole: row.source_role,
      textPreview: redactMemoryPreview(row.text_preview ?? ""),
      textSha256: row.text_sha256,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      erasedAt: row.erased_at,
    }));
  return { evidence, limit };
}

export function getMemoryFactDetail(db: Database, factId: number) {
  const fact = getMemoryFact(db, factId) as any;
  if (!fact) return null;
  const evidence = db
    .query<any, [number]>(
      `SELECT e.*, mfe.excerpt FROM memory_fact_evidence mfe JOIN memory_evidence e ON e.id = mfe.evidence_id WHERE mfe.fact_id = ?`,
    )
    .all(factId);
  return {
    fact: mapFactPreview({
      ...fact,
      evidence_count: evidence.length,
      recall_count: 0,
    }),
    validation: JSON.parse(fact.validation_json ?? "{}"),
    metadata: JSON.parse(fact.metadata_json ?? "{}"),
    evidence: evidence.map((row) => ({
      id: row.id,
      textPreview: redactMemoryPreview(row.text ?? "", 500),
      excerpt: row.excerpt,
      sourceKind: row.source_kind,
      sourceRole: row.source_role,
      originThreadId: row.origin_thread_id,
      originMessageId: row.origin_message_id,
      createdAt: row.created_at,
      erasedAt: row.erased_at,
    })),
  };
}

export function getMemoryEvidenceDetail(db: Database, evidenceId: number) {
  const evidence = getMemoryEvidence(db, evidenceId) as any;
  if (!evidence) return null;
  const signals = db
    .query<any, [number]>(
      `SELECT * FROM memory_signals WHERE evidence_id = ? ORDER BY kind, start_offset`,
    )
    .all(evidenceId);
  const facts = db
    .query<any, [number]>(
      `SELECT mf.*, 1 AS evidence_count, 0 AS recall_count FROM memory_fact_evidence mfe JOIN memory_facts mf ON mf.id = mfe.fact_id WHERE mfe.evidence_id = ?`,
    )
    .all(evidenceId)
    .map(mapFactPreview);
  return {
    evidence: {
      id: evidence.id,
      text: redactMemoryPreview(evidence.text ?? "", 10000),
      textSha256: evidence.text_sha256,
      sourceKind: evidence.source_kind,
      sourceRole: evidence.source_role,
      originThreadId: evidence.origin_thread_id,
      originMessageId: evidence.origin_message_id,
      capturedAt: evidence.captured_at,
      createdAt: evidence.created_at,
      erasedAt: evidence.erased_at,
      metadata: JSON.parse(evidence.metadata_json ?? "{}"),
    },
    signals,
    facts,
  };
}

export function getMemoryStats(
  db: Database,
  input: { projectId?: number; worktreePath?: string },
) {
  const where = ["1 = 1"];
  const bindings: unknown[] = [];
  if (input.projectId) {
    where.push("project_id = ?");
    bindings.push(input.projectId);
  }
  if (input.worktreePath) {
    where.push("worktree_path = ?");
    bindings.push(input.worktreePath);
  }
  const factCount = (status: string) =>
    db
      .query<{ count: number }, any[]>(
        `SELECT count(*) AS count FROM memory_facts WHERE ${where.join(" AND ")} AND status = ?`,
      )
      .get(...bindings, status)?.count ?? 0;
  const evidenceRows =
    db
      .query<{ count: number }, any[]>(
        `SELECT count(*) AS count FROM memory_evidence WHERE ${where.join(" AND ")}`,
      )
      .get(...bindings)?.count ?? 0;
  const recall =
    db
      .query<any, any[]>(
        `SELECT count(*) AS count, avg(latency_ms) AS avg_latency FROM memory_recall_events WHERE ${where.join(" AND ")}`,
      )
      .get(...bindings) ?? {};
  const write =
    db
      .query<any, any[]>(
        `SELECT count(*) AS count FROM memory_write_events WHERE ${where.join(" AND ")}`,
      )
      .get(...bindings) ?? {};
  return {
    activeFacts: factCount("active"),
    rejectedFacts: factCount("rejected"),
    supersededFacts: factCount("superseded"),
    erasedFacts: factCount("erased"),
    evidenceRows,
    recallCount: recall.count ?? 0,
    writeCount: write.count ?? 0,
    averageRecallLatency: recall.avg_latency ?? 0,
    topFactTypes: db
      .query<any, any[]>(
        `SELECT fact_type AS value, count(*) AS count FROM memory_facts WHERE ${where.join(" AND ")} GROUP BY fact_type ORDER BY count DESC LIMIT 10`,
      )
      .all(...bindings),
    topScopeEntities: db
      .query<any, any[]>(
        `SELECT scope_entity AS value, count(*) AS count FROM memory_facts WHERE ${where.join(" AND ")} AND scope_entity IS NOT NULL GROUP BY scope_entity ORDER BY count DESC LIMIT 10`,
      )
      .all(...bindings),
    lastMemoryWrite:
      db
        .query<any, any[]>(
          `SELECT created_at FROM memory_write_events WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 1`,
        )
        .get(...bindings)?.created_at ?? null,
    lastMemoryRecall:
      db
        .query<any, any[]>(
          `SELECT created_at FROM memory_recall_events WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 1`,
        )
        .get(...bindings)?.created_at ?? null,
  };
}

export function listMemoryRecallEvents(
  db: Database,
  input: { projectId?: number; worktreePath?: string; limit?: number },
) {
  const limit = boundedLimit(input.limit);
  const where = ["1 = 1"];
  const bindings: unknown[] = [];
  if (input.projectId) {
    where.push("project_id = ?");
    bindings.push(input.projectId);
  }
  if (input.worktreePath) {
    where.push("worktree_path = ?");
    bindings.push(input.worktreePath);
  }
  return db
    .query<any, any[]>(
      `SELECT * FROM memory_recall_events WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...bindings, limit)
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      worktreePath: row.worktree_path,
      threadId: row.thread_id,
      query: row.query,
      answerMode: row.answer_mode,
      routePlan: JSON.parse(row.route_plan_json ?? "{}"),
      resultFactIds: JSON.parse(row.result_fact_ids_json ?? "[]"),
      resultCount: row.result_count,
      latencyMs: row.latency_ms,
      createdAt: row.created_at,
    }));
}

export function listMemoryWriteEvents(
  db: Database,
  input: { projectId?: number; worktreePath?: string; limit?: number },
) {
  const limit = boundedLimit(input.limit);
  const where = ["1 = 1"];
  const bindings: unknown[] = [];
  if (input.projectId) {
    where.push("project_id = ?");
    bindings.push(input.projectId);
  }
  if (input.worktreePath) {
    where.push("worktree_path = ?");
    bindings.push(input.worktreePath);
  }
  return db
    .query<any, any[]>(
      `SELECT * FROM memory_write_events WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...bindings, limit)
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      worktreePath: row.worktree_path,
      threadId: row.thread_id,
      evidenceId: row.evidence_id,
      acceptedFactIds: JSON.parse(row.accepted_fact_ids_json ?? "[]"),
      rejectedFacts: JSON.parse(row.rejected_facts_json ?? "[]"),
      signalSummary: JSON.parse(row.signal_summary_json ?? "{}"),
      latencyMs: row.latency_ms,
      createdAt: row.created_at,
    }));
}

export function mapRecallFact(row: any, score: number): MemoryRecallFact {
  return {
    id: row.id,
    statement: row.statement,
    factType: row.fact_type,
    memoryKind: row.memory_kind,
    scopeEntity: row.scope_entity,
    status: row.status,
    confidence: row.confidence,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    score,
  };
}

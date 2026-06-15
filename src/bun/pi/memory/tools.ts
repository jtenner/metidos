/**
 * @file src/bun/pi/memory/tools.ts
 * @description Native Pi memory tool pack for Metidos agents.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { initAppDatabase } from "../../db";
import { textToolResult, withMetidosToolTelemetry } from "../metidos/shared";
import { recallMemory } from "./retrieval";
import {
  eraseMemory,
  getMemoryEvidenceDetail,
  getMemoryFactDetail,
  rememberMemoryFacts,
  searchMemoryFactsForObservability,
  upsertMemoryFactEmbedding,
} from "./store";
import type { MemorySourceKind } from "./types";

export type PiMemoryToolOptions = {
  threadId: number;
  projectId: number;
  worktreePath: string;
  ownerUserId?: number | null | undefined;
  embed?: ((text: string) => Promise<number[]>) | undefined;
  embeddingAvailable?: boolean;
};

const MemoryFactCandidate = Type.Object({
  statement: Type.String({ minLength: 1 }),
  factType: Type.String({ minLength: 1 }),
  memoryKind: Type.Optional(
    Type.Union([
      Type.Literal("canonical"),
      Type.Literal("observation"),
      Type.Literal("technical"),
    ]),
  ),
  scopeEntity: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mutable: Type.Optional(Type.Boolean()),
  validFrom: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  validUntil: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  supersedesFactId: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const RememberParameters = Type.Object({
  evidenceText: Type.String({ minLength: 1 }),
  sourceKind: Type.Optional(
    Type.Union([
      Type.Literal("user_message"),
      Type.Literal("assistant_message"),
      Type.Literal("tool"),
      Type.Literal("manual"),
      Type.Literal("system"),
    ]),
  ),
  sourceRole: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  facts: Type.Array(MemoryFactCandidate),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const RecallParameters = Type.Object({
  query: Type.String({ minLength: 1 }),
  answerMode: Type.Optional(
    Type.Union([
      Type.Literal("strict"),
      Type.Literal("balanced"),
      Type.Literal("advanced"),
    ]),
  ),
  scope: Type.Optional(
    Type.Union([
      Type.Literal("project"),
      Type.Literal("worktree"),
      Type.Literal("thread"),
    ]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  tokenBudget: Type.Optional(Type.Integer({ minimum: 200, maximum: 8000 })),
  includeSuperseded: Type.Optional(Type.Boolean()),
  includeEvidence: Type.Optional(Type.Boolean()),
});

const InspectParameters = Type.Object({
  factId: Type.Optional(Type.Integer({ minimum: 1 })),
  evidenceId: Type.Optional(Type.Integer({ minimum: 1 })),
  query: Type.Optional(Type.String({ minLength: 1 })),
});

const ForgetParameters = Type.Object({
  factIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
  evidenceIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
  query: Type.Optional(Type.String()),
  scope: Type.Optional(
    Type.Union([
      Type.Literal("project"),
      Type.Literal("worktree"),
      Type.Literal("thread"),
    ]),
  ),
  confirm: Type.String(),
});

export function createPiMemoryTools(
  options: PiMemoryToolOptions,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        name: "memory_remember",
        label: "Remember Memory",
        description:
          "Store immutable evidence, extract deterministic signals, validate candidate facts, and promote accepted project-scoped long-term memories.",
        parameters: RememberParameters,
        promptSnippet: "Store provenance-grounded project memory",
        execute: async (_toolCallId, params) => {
          const db = initAppDatabase();
          const result = rememberMemoryFacts(db, {
            projectId: options.projectId,
            worktreePath: options.worktreePath,
            originThreadId: options.threadId,
            sourceKind: (params.sourceKind ?? "manual") as MemorySourceKind,
            sourceRole: params.sourceRole ?? null,
            text: params.evidenceText,
            ...(params.metadata ? { metadata: params.metadata } : {}),
            facts: params.facts,
          });
          const embeddingDiagnostics = {
            attempted: false,
            failed: 0,
            succeeded: 0,
          };
          if (options.embed && result.accepted.length > 0) {
            embeddingDiagnostics.attempted = true;
            for (const fact of result.accepted) {
              try {
                const embedding = await options.embed(fact.statement);
                upsertMemoryFactEmbedding(db, {
                  embedding,
                  factId: fact.id,
                  projectId: options.projectId,
                  worktreePath: options.worktreePath,
                });
                embeddingDiagnostics.succeeded += 1;
              } catch {
                embeddingDiagnostics.failed += 1;
              }
            }
          }
          return textToolResult(
            `Stored evidence E${result.evidenceId}. Accepted ${result.accepted.length} fact(s), rejected ${result.rejected.length}.`,
            { ...result, embeddingDiagnostics },
          );
        },
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        name: "memory_recall",
        label: "Recall Memory",
        description:
          "Retrieve project-scoped provenance-grounded memory deterministically with diagnostics and context separated from answer instructions.",
        parameters: RecallParameters,
        promptSnippet: "Recall provenance-grounded project memory",
        execute: async (_toolCallId, params) => {
          let queryEmbedding: number[] | undefined;
          let embeddingFailed = false;
          if (options.embed) {
            try {
              queryEmbedding = await options.embed(params.query);
            } catch {
              embeddingFailed = true;
            }
          }
          const result = recallMemory(initAppDatabase(), {
            projectId: options.projectId,
            worktreePath: options.worktreePath,
            threadId: options.threadId,
            query: params.query,
            ...(params.answerMode ? { answerMode: params.answerMode } : {}),
            scope: params.scope ?? "worktree",
            ...(typeof params.limit === "number"
              ? { limit: params.limit }
              : {}),
            ...(typeof params.tokenBudget === "number"
              ? { tokenBudget: params.tokenBudget }
              : {}),
            ...(typeof params.includeSuperseded === "boolean"
              ? { includeSuperseded: params.includeSuperseded }
              : {}),
            ...(typeof params.includeEvidence === "boolean"
              ? { includeEvidence: params.includeEvidence }
              : {}),
            ...(queryEmbedding ? { queryEmbedding } : {}),
            embeddingAvailable: !!options.embed && !embeddingFailed,
          });
          return textToolResult(
            result.context || "No memory matched the query.",
            result,
          );
        },
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        name: "memory_inspect",
        label: "Inspect Memory",
        description:
          "Inspect full provenance, lifecycle, signals, evidence links, and validation diagnostics for a memory fact or evidence item.",
        parameters: InspectParameters,
        promptSnippet: "Inspect memory provenance and diagnostics",
        execute: async (_toolCallId, params) => {
          const db = initAppDatabase();
          const detail = params.factId
            ? getMemoryFactDetail(db, params.factId)
            : params.evidenceId
              ? getMemoryEvidenceDetail(db, params.evidenceId)
              : params.query
                ? searchMemoryFactsForObservability(db, {
                    projectId: options.projectId,
                    worktreePath: options.worktreePath,
                    query: params.query,
                    limit: 10,
                  })
                : null;
          return textToolResult(
            detail ? JSON.stringify(detail, null, 2) : "No memory item found.",
            { detail },
          );
        },
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        name: "memory_forget",
        label: "Forget Memory",
        description:
          "Erase visible project/worktree/thread memory. Requires confirm exactly FORGET and marks memory erased rather than hard-deleting.",
        parameters: ForgetParameters,
        promptSnippet: "Erase project memory with explicit confirmation",
        execute: async (_toolCallId, params) => {
          const result = eraseMemory(initAppDatabase(), {
            projectId: options.projectId,
            worktreePath: options.worktreePath,
            threadId: options.threadId,
            ...(params.factIds ? { factIds: params.factIds } : {}),
            ...(params.evidenceIds ? { evidenceIds: params.evidenceIds } : {}),
            ...(params.query ? { query: params.query } : {}),
            scope: params.scope ?? "worktree",
            confirm: params.confirm,
          });
          return textToolResult(
            `Erased ${result.factCount} fact(s) and ${result.evidenceCount} evidence row(s).`,
            result,
          );
        },
      }),
    ),
  ];
}

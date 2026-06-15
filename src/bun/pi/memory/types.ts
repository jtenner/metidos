/**
 * @file src/bun/pi/memory/types.ts
 * @description Types for Metidos provenance-grounded long-term memory.
 */

export type MemorySourceKind =
  | "user_message"
  | "assistant_message"
  | "tool"
  | "manual"
  | "system";

export type MemoryKind = "canonical" | "observation" | "technical";
export type MemoryFactStatus = "active" | "superseded" | "rejected" | "erased";
export type MemoryFactType =
  | "preference"
  | "decision"
  | "constraint"
  | "task_state"
  | "environment"
  | "technical"
  | "observation"
  | string;

export type MemorySignalInput = {
  kind: string;
  value: string;
  normalizedValue?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  confidence?: number;
};

export type MemoryEvidenceInput = {
  projectId: number;
  worktreePath: string;
  originThreadId?: number | null;
  originMessageId?: number | null;
  sourceKind: MemorySourceKind;
  sourceRole?: string | null;
  text: string;
  metadata?: Record<string, unknown>;
};

export type MemoryFactCandidate = {
  statement: string;
  factType: MemoryFactType;
  memoryKind?: MemoryKind;
  scopeEntity?: string | null;
  mutable?: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  supersedesFactId?: number | null;
  metadata?: Record<string, unknown>;
};

export type MemoryValidationResult = {
  accepted: boolean;
  confidence: number;
  diagnostics: {
    hardAnchors: Array<{ value: string; present: boolean; kind: string }>;
    lexicalSupportScore: number;
    subjectGrounded: boolean;
    negationConflict: boolean;
    correctionIntent: boolean;
    reasons: string[];
  };
};

export type MemoryRememberInput = MemoryEvidenceInput & {
  facts: MemoryFactCandidate[];
};

export type MemoryRememberResult = {
  evidenceId: number;
  textSha256: string;
  accepted: Array<{
    id: number;
    statement: string;
    supersededFactIds: number[];
  }>;
  rejected: Array<{
    statement: string;
    reasons: string[];
    validation: MemoryValidationResult;
  }>;
  diagnostics: {
    evidenceId: number;
    textSha256: string;
    signalCountsByKind: Record<string, number>;
    acceptedCount: number;
    rejectedCount: number;
    validationFailuresByReason: Record<string, number>;
    supersededFactIds: number[];
    latencyMs: number;
  };
};

export type MemoryRecallInput = {
  projectId: number;
  worktreePath: string;
  threadId?: number | null;
  query: string;
  answerMode?: "strict" | "balanced" | "advanced";
  scope?: "project" | "worktree" | "thread";
  limit?: number;
  tokenBudget?: number;
  includeSuperseded?: boolean;
  includeEvidence?: boolean;
  embeddingAvailable?: boolean;
};

export type MemoryRecallFact = {
  id: number;
  statement: string;
  factType: string;
  memoryKind: MemoryKind;
  scopeEntity: string | null;
  status: MemoryFactStatus;
  confidence: number;
  updatedAt: string;
  createdAt: string;
  score: number;
  evidence?: Array<{
    id: number;
    excerpt: string | null;
    sourceKind: string;
    originThreadId: number | null;
  }>;
};

export type MemoryRecallResult = {
  context: string;
  answer_instructions: string;
  facts: MemoryRecallFact[];
  diagnostics: Record<string, unknown>;
  latencyMs: number;
};

export type MemoryForgetInput = {
  projectId: number;
  worktreePath: string;
  threadId?: number | null;
  factIds?: number[];
  evidenceIds?: number[];
  query?: string;
  scope?: "project" | "worktree" | "thread";
  confirm: string;
};

export type MemoryForgetResult = {
  erasedFactIds: number[];
  erasedEvidenceIds: number[];
  factCount: number;
  evidenceCount: number;
};

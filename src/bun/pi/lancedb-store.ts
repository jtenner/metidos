/**
 * @file src/bun/pi/lancedb-store.ts
 * @description Small project-scoped vector store backing metidos:lancedb tools and plugin APIs.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const STORE_FILE_NAME = "metidos-lancedb.json";
const MAX_VECTOR_DIMENSIONS = 8192;
const MAX_NUMERIC_RECORD_ID = Number.MAX_SAFE_INTEGER - 1;
const MAX_NEXT_NUMERIC_RECORD_ID = Number.MAX_SAFE_INTEGER;
const DEFAULT_QUERY_LIMIT = 10;
const MAX_LANCEDB_RECORDS = 20_000;
const MAX_LANCEDB_UPSERT_ROWS = 1_000;
const MAX_LANCEDB_PROPS_JSON_BYTES = 256 * 1024;
const MAX_LANCEDB_STORE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_LANCEDB_QUERY_RESULT_BYTES = 4 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();

export type LanceDbRecordId = number | string;

export type LanceDbRecord = {
  id: LanceDbRecordId;
  props: Record<string, unknown>;
  vector: number[];
};

export type LanceDbQueryResult = {
  id: LanceDbRecordId;
  props: Record<string, unknown>;
  score: number;
};

type LanceDbStoreFile = {
  nextId: number;
  records: LanceDbRecord[];
};

export function normalizeLanceDbVector(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("LanceDB vectors must be arrays of finite numbers.");
  }
  if (value.length === 0 || value.length > MAX_VECTOR_DIMENSIONS) {
    throw new Error(
      `LanceDB vectors must contain 1-${MAX_VECTOR_DIMENSIONS} dimensions.`,
    );
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error("LanceDB vectors must contain only finite numbers.");
    }
    return item;
  });
}

function normalizeProps(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LanceDB props must be an object.");
  }
  const props = { ...(value as Record<string, unknown>) };
  if (
    TEXT_ENCODER.encode(JSON.stringify(props)).byteLength >
    MAX_LANCEDB_PROPS_JSON_BYTES
  ) {
    throw new Error(
      `LanceDB props are limited to ${MAX_LANCEDB_PROPS_JSON_BYTES} bytes.`,
    );
  }
  return props;
}

function normalizeId(value: unknown): LanceDbRecordId | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_NUMERIC_RECORD_ID
  ) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return null;
}

function assertContained(rootPath: string, candidatePath: string): void {
  const relativePath = relative(rootPath, candidatePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("LanceDB path must stay inside the current workspace.");
  }
}

function assertNoSymlinkPathComponents(input: {
  directoryPath: string;
  rootPath: string;
}): void {
  const realRootPath = realpathSync(input.rootPath);
  const relativeDirectory = relative(input.rootPath, input.directoryPath);
  let currentPath = input.rootPath;
  for (const segment of relativeDirectory.split(sep).filter(Boolean)) {
    currentPath = resolve(currentPath, segment);
    if (!existsSync(currentPath)) {
      break;
    }
    const stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error("LanceDB path must not contain symbolic links.");
    }
    assertContained(realRootPath, realpathSync(currentPath));
  }
}

export function resolveLanceDbStoreFile(input: {
  path: string;
  rootPath: string;
}): string {
  if (!input.path.trim()) {
    throw new Error("LanceDB path must be a non-empty string.");
  }
  if (isAbsolute(input.path)) {
    throw new Error("LanceDB path must be relative to the current workspace.");
  }
  const rootPath = resolve(input.rootPath);
  const directoryPath = resolve(rootPath, input.path);
  assertContained(rootPath, directoryPath);
  assertNoSymlinkPathComponents({ directoryPath, rootPath });
  return join(directoryPath, STORE_FILE_NAME);
}

async function readStore(filePath: string): Promise<LanceDbStoreFile> {
  try {
    if (existsSync(filePath)) {
      const storeStat = lstatSync(filePath);
      if (storeStat.isSymbolicLink()) {
        throw new Error("LanceDB store file must not be a symbolic link.");
      }
      if (storeStat.size > MAX_LANCEDB_STORE_FILE_BYTES) {
        throw new Error(
          `LanceDB store files are limited to ${MAX_LANCEDB_STORE_FILE_BYTES} bytes.`,
        );
      }
    }
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid LanceDB store file.");
    }
    const record = parsed as Record<string, unknown>;
    const rawRecords = Array.isArray(record.records) ? record.records : [];
    const records = rawRecords.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Invalid LanceDB store record.");
      }
      const entry = item as Record<string, unknown>;
      const id = normalizeId(entry.id);
      if (id === null) {
        throw new Error("Invalid LanceDB record id.");
      }
      return {
        id,
        props: normalizeProps(entry.props),
        vector: normalizeLanceDbVector(entry.vector),
      };
    });
    if (records.length > MAX_LANCEDB_RECORDS) {
      throw new Error(
        `LanceDB stores are limited to ${MAX_LANCEDB_RECORDS} records.`,
      );
    }
    const largestNumericId = records.reduce(
      (largest, item) =>
        typeof item.id === "number" ? Math.max(largest, item.id) : largest,
      0,
    );
    const nextId =
      record.nextId === undefined
        ? 1
        : typeof record.nextId === "number" &&
            Number.isSafeInteger(record.nextId) &&
            record.nextId >= 1 &&
            record.nextId <= MAX_NEXT_NUMERIC_RECORD_ID
          ? record.nextId
          : null;
    if (nextId === null) {
      throw new Error("Invalid LanceDB store next id.");
    }
    return {
      nextId: Math.max(nextId, largestNumericId + 1),
      records,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { nextId: 1, records: [] };
    }
    throw error;
  }
}

async function writeStore(
  filePath: string,
  store: LanceDbStoreFile,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const serializedStore = `${JSON.stringify(store, null, 2)}\n`;
  if (
    TEXT_ENCODER.encode(serializedStore).byteLength >
    MAX_LANCEDB_STORE_FILE_BYTES
  ) {
    throw new Error(
      `LanceDB store files are limited to ${MAX_LANCEDB_STORE_FILE_BYTES} bytes.`,
    );
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, serializedStore, "utf8");
  await rename(tempPath, filePath);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    return Number.NEGATIVE_INFINITY;
  }
  let scale = 0;
  for (let index = 0; index < left.length; index += 1) {
    scale = Math.max(
      scale,
      Math.abs(left[index] ?? 0),
      Math.abs(right[index] ?? 0),
    );
  }
  if (scale === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = (left[index] ?? 0) / scale;
    const rightValue = (right[index] ?? 0) / scale;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export async function upsertLanceDbRecords(input: {
  filePath: string;
  rows: unknown[];
}): Promise<{ ids: LanceDbRecordId[]; count: number }> {
  if (input.rows.length > MAX_LANCEDB_UPSERT_ROWS) {
    throw new Error(
      `LanceDB upserts are limited to ${MAX_LANCEDB_UPSERT_ROWS} rows.`,
    );
  }
  const store = await readStore(input.filePath);
  const ids: LanceDbRecordId[] = [];
  for (const row of input.rows) {
    const props = normalizeProps(row);
    const vector = normalizeLanceDbVector(props.vector);
    const explicitId = normalizeId(props.id);
    if (props.id !== undefined && explicitId === null) {
      throw new Error(
        `LanceDB numeric ids must be safe positive integers up to ${MAX_NUMERIC_RECORD_ID}; string ids must be non-empty.`,
      );
    }
    if (explicitId === null && store.nextId > MAX_NUMERIC_RECORD_ID) {
      throw new Error("LanceDB numeric id space is exhausted.");
    }
    const id = explicitId ?? store.nextId;
    if (typeof id === "number" && id >= store.nextId) {
      store.nextId = Math.trunc(id) + 1;
    } else if (explicitId === null) {
      store.nextId += 1;
    }
    const savedProps = { ...props, id };
    const existingIndex = store.records.findIndex((record) => record.id === id);
    const record = { id, props: savedProps, vector };
    if (existingIndex >= 0) {
      store.records[existingIndex] = record;
    } else {
      if (store.records.length >= MAX_LANCEDB_RECORDS) {
        throw new Error(
          `LanceDB stores are limited to ${MAX_LANCEDB_RECORDS} records.`,
        );
      }
      store.records.push(record);
    }
    ids.push(id);
  }
  await writeStore(input.filePath, store);
  return { count: ids.length, ids };
}

export async function queryLanceDbRecords(input: {
  filePath: string;
  limit?: number;
  vector: unknown;
}): Promise<LanceDbQueryResult[]> {
  const vector = normalizeLanceDbVector(input.vector);
  const limit = Math.max(
    1,
    Math.min(100, Math.trunc(input.limit ?? DEFAULT_QUERY_LIMIT)),
  );
  const store = await readStore(input.filePath);
  const results = store.records
    .map((record) => ({
      id: record.id,
      props: record.props,
      score: cosineSimilarity(vector, record.vector),
    }))
    .filter((record) => Number.isFinite(record.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  if (
    TEXT_ENCODER.encode(JSON.stringify(results)).byteLength >
    MAX_LANCEDB_QUERY_RESULT_BYTES
  ) {
    throw new Error(
      `LanceDB query results are limited to ${MAX_LANCEDB_QUERY_RESULT_BYTES} bytes.`,
    );
  }
  return results;
}

export async function deleteLanceDbRecord(input: {
  filePath: string;
  id: LanceDbRecordId;
}): Promise<{ deleted: boolean; id: LanceDbRecordId }> {
  const store = await readStore(input.filePath);
  const nextRecords = store.records.filter((record) => record.id !== input.id);
  const deleted = nextRecords.length !== store.records.length;
  await writeStore(input.filePath, { ...store, records: nextRecords });
  return { deleted, id: input.id };
}

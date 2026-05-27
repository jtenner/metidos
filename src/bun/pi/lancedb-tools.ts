/**
 * @file src/bun/pi/lancedb-tools.ts
 * @description Project-scoped vector search tools for metidos:lancedb access.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { textToolResult } from "./metidos/shared";
import {
  deleteLanceDbRecord,
  queryLanceDbRecords,
  resolveLanceDbStoreFile,
  upsertLanceDbRecords,
  type LanceDbRecordId,
} from "./lancedb-store";

export type PiLanceDbEmbeddingHost = (input: string) => Promise<number[]>;

export type PiLanceDbToolsOptions = {
  embed: PiLanceDbEmbeddingHost;
  worktreePathContext: string;
};

const LanceDbUpsertParameters = Type.Object({
  path: Type.String({ description: "Workspace-relative LanceDB directory." }),
  props: Type.Unknown({
    description:
      "Record object to upsert. Include vector:number[]; include id to update an existing record.",
  }),
});

const LanceDbQueryParameters = Type.Object({
  path: Type.String({ description: "Workspace-relative LanceDB directory." }),
  query: Type.String({
    description: "Text to embed and use as the vector similarity query.",
  }),
});

const LanceDbDeleteParameters = Type.Object({
  id: Type.Number({
    description: "Numeric record id to delete.",
  }),
  path: Type.String({ description: "Workspace-relative LanceDB directory." }),
});

function jsonToolResult(result: unknown) {
  return textToolResult(JSON.stringify(result, null, 2), result);
}

function storeFileFor(options: PiLanceDbToolsOptions, path: string): string {
  return resolveLanceDbStoreFile({
    path,
    rootPath: options.worktreePathContext,
  });
}

export function createPiLanceDbTools(
  options: PiLanceDbToolsOptions,
): ToolDefinition[] {
  return [
    defineTool<typeof LanceDbUpsertParameters, unknown>({
      description:
        "Upsert one vector record into a workspace-scoped LanceDB store. props must be an object with vector:number[]; when props.id is present it updates that id.",
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await upsertLanceDbRecords({
            filePath: storeFileFor(options, params.path),
            rows: [params.props],
          }),
        ),
      label: "LanceDB Upsert",
      name: "lancedb_upsert",
      parameters: LanceDbUpsertParameters,
      promptGuidelines: [
        "Use lancedb_upsert only for workspace-scoped vector records whose props include vector:number[].",
        "Use a relative path; absolute paths and parent-directory escapes are rejected.",
      ],
      promptSnippet:
        "Upsert a vector record into a workspace-scoped LanceDB store",
    }),
    defineTool<typeof LanceDbQueryParameters, unknown>({
      description:
        "Embed a text query with the configured Metidos embedding model and run vector similarity search against a workspace-scoped LanceDB store.",
      execute: async (_toolCallId, params) => {
        const vector = await options.embed(params.query);
        return jsonToolResult(
          await queryLanceDbRecords({
            filePath: storeFileFor(options, params.path),
            vector,
          }),
        );
      },
      label: "LanceDB Query",
      name: "lancedb_query",
      parameters: LanceDbQueryParameters,
      promptGuidelines: [
        "Use lancedb_query for text-to-vector retrieval. The query string is embedded by the host before search.",
        "Use a relative path; absolute paths and parent-directory escapes are rejected.",
      ],
      promptSnippet: "Embed text and query a workspace-scoped LanceDB store",
    }),
    defineTool<typeof LanceDbDeleteParameters, unknown>({
      description:
        "Delete one vector record from a workspace-scoped LanceDB store by id.",
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deleteLanceDbRecord({
            filePath: storeFileFor(options, params.path),
            id: params.id as LanceDbRecordId,
          }),
        ),
      label: "LanceDB Delete",
      name: "lancedb_delete",
      parameters: LanceDbDeleteParameters,
      promptGuidelines: [
        "Use lancedb_delete to remove one record by id from a workspace-scoped vector store.",
        "Use a relative path; absolute paths and parent-directory escapes are rejected.",
      ],
      promptSnippet:
        "Delete a vector record from a workspace-scoped LanceDB store",
    }),
  ];
}

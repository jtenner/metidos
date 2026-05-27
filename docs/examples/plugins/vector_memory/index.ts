import { definePlugin } from "@metidos/plugin-api";

type RememberNoteProps = {
  id?: number;
  note: string;
  title?: string;
};

type SearchNotesProps = {
  limit?: number;
  query: string;
};

const MEMORY_PATH = "~/memory/notes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

function validateRememberNoteProps(input: unknown): RememberNoteProps {
  if (!isRecord(input)) {
    throw new Error("remember_note props must be an object.");
  }
  const props: RememberNoteProps = { note: stringField(input.note, "note") };
  if (typeof input.id === "number" && Number.isFinite(input.id)) {
    props.id = Math.trunc(input.id);
  }
  const title = optionalString(input.title);
  if (title) {
    props.title = title;
  }
  return props;
}

function validateSearchNotesProps(input: unknown): SearchNotesProps {
  if (!isRecord(input)) {
    throw new Error("search_notes props must be an object.");
  }
  const props: SearchNotesProps = { query: stringField(input.query, "query") };
  const limit = optionalPositiveInteger(input.limit);
  if (limit) {
    props.limit = limit;
  }
  return props;
}

function markdownTable(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "No matching notes found.";
  }
  const lines = ["| Score | ID | Title | Note |", "| --- | ---: | --- | --- |"];
  for (const row of rows) {
    const props = isRecord(row.props) ? row.props : {};
    lines.push(
      `| ${typeof row.score === "number" ? row.score.toFixed(3) : ""} | ${String(row.id ?? "")} | ${String(props.title ?? "").replaceAll("|", "\\|")} | ${String(props.note ?? "").replaceAll("|", "\\|")} |`,
    );
  }
  return lines.join("\n");
}

export default definePlugin((metidos) => {
  metidos.addAgentTool<RememberNoteProps, string>({
    tool: "remember_note",
    name: "Remember note",
    description:
      "Embed and store a note in plugin-owned vector memory. Props: note (required), title, id.",
    timeoutMs: 10_000,
    validateProps: validateRememberNoteProps,
    async action(_context, props) {
      const db = await metidos.lancedb.open(MEMORY_PATH);
      const vector = await metidos.embeddings.embed(props.note, {
        purpose: "vector_memory.remember_note",
      });
      const result = await db.upsert({
        ...(props.id === undefined ? {} : { id: props.id }),
        note: props.note,
        title: props.title ?? props.note.slice(0, 80),
        updatedAt: new Date().toISOString(),
        vector,
      });
      await metidos.log("info", "Stored vector memory note.");
      return `Stored ${result.count} note(s): ${result.ids.join(", ")}`;
    },
  });

  metidos.addAgentTool<SearchNotesProps, string>({
    tool: "search_notes",
    name: "Search notes",
    description:
      "Embed a natural-language query and search notes stored by remember_note. Props: query (required), limit.",
    timeoutMs: 10_000,
    validateProps: validateSearchNotesProps,
    async action(_context, props) {
      const db = await metidos.lancedb.open(MEMORY_PATH);
      const vector = await metidos.embeddings.embed(props.query, {
        purpose: "vector_memory.search_notes",
      });
      const rows = await db.query(vector, { limit: props.limit ?? 10 });
      return markdownTable(rows as readonly Record<string, unknown>[]);
    },
  });
});

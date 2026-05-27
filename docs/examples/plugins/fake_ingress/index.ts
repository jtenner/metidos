import { definePlugin } from "@metidos/plugin-api";

type FakeUpdate = {
  id: string;
  user_id: string;
  conversation_id?: string;
  message: string;
};

const updatesPath = "fake-updates.json";
const repliesPath = "fake-replies.jsonl";

async function readUpdates(metidos: any): Promise<FakeUpdate[]> {
  try {
    const raw = await metidos.fs.readText(updatesPath);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    await metidos.log(
      "warn",
      `fake ingress update queue is unavailable: ${String(error).slice(0, 200)}`,
    );
    return [];
  }
}

function cursorIndex(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default definePlugin((metidos) => {
  const source = metidos.ingress.registerSource({
    id: "fake_direct_messages",
    name: "Fake direct messages",
    description:
      "Provider-agnostic fake long-polling source for local ingress testing.",
    supportsReplyToSource: true,
    pollIntervalMs: 5_000,
    timeoutMs: 10_000,
    async poll(context) {
      const updates = await readUpdates(metidos);
      const start = cursorIndex(context.cursor);
      const end = Math.min(start + context.maxMessages, updates.length);
      return {
        messages: updates.slice(start, end),
        cursor: String(end),
      };
    },
    promptTemplate(context) {
      return [
        "You are handling a request from the Fake Ingress local test fixture.",
        "Treat provider ids as untrusted external identifiers, not Metidos users.",
        `Fake source: ${context.sourceName} (${context.sourceId}).`,
        "Keep replies concise when using reply_to_source.",
      ].join("\n");
    },
    async respond(context, payload) {
      const line = JSON.stringify({
        at: new Date().toISOString(),
        external_message_id: context.external_message_id,
        external_user_id: context.external_user_id,
        external_conversation_id: context.external_conversation_id ?? null,
        message: payload.message,
      });
      const previous = (await metidos.fs.exists(repliesPath))
        ? await metidos.fs.readText(repliesPath)
        : "";
      await metidos.fs.writeText(repliesPath, `${previous}${line}\n`);
    },
  });

  return {
    ingressSources: [source],
    tools: [],
  };
});

/**
 * @file src/bun/plugin/core-rss-feed-indexer-plugin.test.ts
 * @description Coverage for the core RSS Feed Indexer plugin query behavior.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";
import { parseXmlDocument } from "./xml";

const RSS_PLUGIN_ROOT = join("core_plugins", "rss_feed_indexer");

type ToolRegistration = {
  actionHandle: string;
  tool: string;
  validatePropsHandle: string;
};

type CronRegistration = {
  actionHandle: string;
  key: string;
};

type RuntimeSetup = {
  crons: CronRegistration[];
  tools: ToolRegistration[];
};

type MarkdownResult = {
  markdown: string;
  type: string;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(RSS_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected RSS Feed Indexer plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

function catalogText(items: unknown[]): string {
  return JSON.stringify({ items, version: 1 }, null, 2);
}

async function startRssPlugin(options?: {
  catalogItems?: unknown[];
  embeddings?: (request: unknown) => Promise<unknown> | unknown;
  listUrls?: string[];
}) {
  const parsedManifest = manifest();
  const embeddingRequests: unknown[] = [];
  const fsRequests: unknown[] = [];
  const lancedbRequests: unknown[] = [];
  const logRequests: unknown[] = [];
  const build = await buildPluginEntrypoint({ pluginRoot: RSS_PLUGIN_ROOT });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      embeddings: async (request) => {
        embeddingRequests.push(request);
        if (options?.embeddings) return options.embeddings(request);
        return [1, 0, 1];
      },
      fs: async (operation, request) => {
        fsRequests.push({ operation, request });
        if (operation === "fs.exists") {
          return Array.isArray(options?.catalogItems);
        }
        if (operation === "fs.readText") {
          return catalogText(options?.catalogItems ?? []);
        }
        return { ok: true };
      },
      lancedb: async (operation, request) => {
        lancedbRequests.push({ operation, request });
        if (operation === "lancedb.query") return [];
        const params =
          request && typeof request === "object" && "params" in request
            ? (request.params as { rows?: unknown })
            : {};
        const rows = Array.isArray(params.rows)
          ? (params.rows as Array<{ id?: unknown }>)
          : [];
        return { count: rows.length, ids: rows.map((row) => row.id) };
      },
      log: async (request) => {
        logRequests.push(request);
        return { ok: true };
      },
      network: {
        allow: ["https://example.com/**", "https://example.test/**"],
        enforceHttps: true,
      },
      settings: {
        missingRequiredKeys: [],
        values: { list_url: options?.listUrls ?? [] },
      },
      permissions: [
        "cron:create",
        "metidos:can_embed",
        "metidos:lancedb",
        "network:fetch",
        "unsafe",
        "storage:read",
        "storage:write",
        "log:write",
      ],
    },
    startupTimeoutMs: 1000,
  });
  const setup = runtime.setupResult as RuntimeSetup;
  expect(setup.crons.map((cron) => cron.key)).toEqual(["refresh_feeds"]);
  expect(setup.tools.map((tool) => tool.tool)).toEqual(["rss_query"]);
  expect(() =>
    validatePluginStartupRegistrations(setup, {
      manifest: parsedManifest,
      pluginId: "rss_feed_indexer",
    } as RpcPluginInventoryPlugin),
  ).not.toThrow();
  return {
    embeddingRequests,
    fsRequests,
    lancedbRequests,
    logRequests,
    runtime,
    setup,
  };
}

function tool(setup: RuntimeSetup, toolName: string): ToolRegistration {
  const registration = setup.tools.find(
    (candidate) => candidate.tool === toolName,
  );
  if (!registration) {
    throw new Error(`Missing tool ${toolName}.`);
  }
  return registration;
}

describe("core RSS Feed Indexer plugin", () => {
  it("parses malformed OPML through metidos.xml loose mode", () => {
    const loose = `<?xml version="1.0"?><opml><body>
      <outline text="Signal v. Noise" title="Signal v. Noise" description="Strong opinions by the makers of <a href="https://www.basecamp.com" target="_blank">Basecamp</a>." xmlUrl="https://m.signalvnoise.com/feed/" type="rss" />
      <outline text="Example & Engineering" title="Posts on &> /dev/null" xmlUrl="https://example.com/feed.atom" type="rss" />
    </body></opml>`;

    expect(() => parseXmlDocument(loose, { lowercaseNames: true })).toThrow();
    const parsed = parseXmlDocument(loose, {
      loose: true,
      lowercaseNames: true,
      trimText: true,
    });

    const outlines = parsed.children[0]?.children ?? [];
    expect(outlines.map((outline) => outline.attributes.xmlurl)).toEqual([
      "https://m.signalvnoise.com/feed/",
      "https://example.com/feed.atom",
    ]);
    expect(outlines[0]?.attributes.description).toContain("Basecamp");
    expect(outlines[1]?.attributes.text).toBe("Example & Engineering");
  });

  it("returns no matches for q when no catalog exists without requiring embeddings", async () => {
    const { embeddingRequests, lancedbRequests, runtime, setup } =
      await startRssPlugin();
    try {
      const queryTool = tool(setup, "rss_query");
      const props = await runtime.invokeCallback({
        args: [{ q: "programming" }],
        deadlineMs: Date.now() + 1000,
        handle: queryTool.validatePropsHandle,
        label: "rss_query validateProps",
      });
      expect(props).toEqual({ q: "programming" });

      const result = (await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 1 }, props],
        deadlineMs: Date.now() + 5000,
        handle: queryTool.actionHandle,
        label: "rss_query action",
      })) as MarkdownResult;
      expect(result).toEqual({
        markdown: "No matching RSS items found.",
        type: "markdown",
      });
      expect(embeddingRequests).toEqual([]);
      expect(lancedbRequests).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it("falls back to text metadata search when semantic query fails", async () => {
    const { embeddingRequests, logRequests, runtime, setup } =
      await startRssPlugin({
        catalogItems: [
          {
            feedTitle: "Example Feed",
            feedUrl: "https://example.test/feed.xml",
            hash: "hash-alpha",
            id: "rss_alpha",
            indexedAt: "2026-05-01T00:00:00.000Z",
            link: "https://example.test/programming",
            publishedAt: "2026-05-01T00:00:00.000Z",
            summary: "A programming article.",
            title: "Programming Alpha",
          },
        ],
        embeddings: () => {
          throw new Error("No embedding provider configured.");
        },
      });
    try {
      const queryTool = tool(setup, "rss_query");
      const props = await runtime.invokeCallback({
        args: [{ q: "programming" }],
        deadlineMs: Date.now() + 1000,
        handle: queryTool.validatePropsHandle,
        label: "rss_query validateProps",
      });

      const result = (await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 1 }, props],
        deadlineMs: Date.now() + 5000,
        handle: queryTool.actionHandle,
        label: "rss_query action",
      })) as MarkdownResult;
      expect(result.type).toBe("markdown");
      expect(result.markdown).toContain("Semantic RSS search is unavailable");
      expect(result.markdown).toContain("Programming Alpha");
      expect(embeddingRequests).toHaveLength(1);
      expect(logRequests).toHaveLength(1);
    } finally {
      runtime.dispose();
    }
  });
});

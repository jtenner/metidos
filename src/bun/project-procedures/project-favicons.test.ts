import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearProjectFaviconCache,
  discoverProjectFaviconDataUrl,
} from "./project-favicons";

const tempRoots: string[] = [];
const ICON_BYTES = new Uint8Array([0, 0, 1, 0]);
const NESTED_ICON_BYTES = new Uint8Array([1, 2, 3, 4]);
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function makeTempProject(name: string): Promise<string> {
  const root = join(import.meta.dir, `.tmp-${name}-${crypto.randomUUID()}`);
  tempRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

beforeEach(() => {
  clearProjectFaviconCache();
});

afterEach(async () => {
  clearProjectFaviconCache();
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("discoverProjectFaviconDataUrl", () => {
  it("prefers the root index.html favicon before nested index files and direct favicon files", async () => {
    const root = await makeTempProject("root-index-relative");
    await mkdir(join(root, "public"), { recursive: true });
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "public", "site.ico"), ICON_BYTES);
    await writeFile(join(root, "nested", "nested.ico"), NESTED_ICON_BYTES);
    await writeFile(join(root, "favicon.ico"), new Uint8Array([9, 9, 9, 9]));
    await writeFile(
      join(root, "index.html"),
      '<html><head><link rel="icon" href="public/site.ico"></head></html>',
    );
    await writeFile(
      join(root, "nested", "index.html"),
      '<link rel="icon" href="nested.ico">',
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/x-icon", ICON_BYTES));
  });

  it("prefers nested index.html files before other html files", async () => {
    const root = await makeTempProject("nested-index-priority");
    await mkdir(join(root, "app"), { recursive: true });
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "app", "favicon.ico"), ICON_BYTES);
    await writeFile(join(root, "docs", "page.ico"), NESTED_ICON_BYTES);
    await writeFile(
      join(root, "app", "index.html"),
      '<link rel="icon" href="favicon.ico">',
    );
    await writeFile(
      join(root, "docs", "page.html"),
      '<link rel="icon" href="page.ico">',
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/x-icon", ICON_BYTES));
  });

  it("rejects favicon links that resolve to symlinks outside the project", async () => {
    const root = await makeTempProject("symlinked-icon");
    const outside = await makeTempProject("outside-icon");
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(outside, "secret.png"), PNG_BYTES);
    await symlink(
      join(outside, "secret.png"),
      join(root, "assets", "icon.png"),
    );
    await writeFile(
      join(root, "index.html"),
      '<html><head><link rel="icon" href="assets/icon.png"></head></html>',
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBeNull();
  });

  it("uses HTMLRewriter parsing to find favicon links with mixed-case attributes and rel tokens", async () => {
    const root = await makeTempProject("html-rewriter-link-parser");
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "icon.png"), PNG_BYTES);
    await writeFile(
      join(root, "index.html"),
      '<html><head><LINK HREF="assets/icon.png" REL="shortcut ICON"></head></html>',
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/png", PNG_BYTES));
  });

  it("ignores node_modules html and falls back to project favicon.ico", async () => {
    const root = await makeTempProject("skip-node-modules");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "pkg", "bad.ico"),
      new Uint8Array([8, 8, 8, 8]),
    );
    await writeFile(
      join(root, "node_modules", "pkg", "index.html"),
      '<link rel="icon" href="bad.ico">',
    );
    await writeFile(join(root, "favicon.ico"), ICON_BYTES);

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/x-icon", ICON_BYTES));
  });

  it("resolves asset-root favicon placeholders to root png files", async () => {
    const root = await makeTempProject("asset-root");
    await mkdir(join(root, "src", "mainview"), { recursive: true });
    await writeFile(join(root, "bird.png"), PNG_BYTES);
    await writeFile(
      join(root, "src", "mainview", "index.html"),
      '<link rel="icon" type="image/png" href="__METIDOS_ASSET_ROOT__/bird.png">',
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/png", PNG_BYTES));
  });

  it("resolves common public-url favicon placeholders to root files", async () => {
    const root = await makeTempProject("public-url");
    await mkdir(join(root, "public"), { recursive: true });
    await writeFile(join(root, "favicon.ico"), ICON_BYTES);
    await writeFile(
      join(root, "public", "index.html"),
      '<link rel="icon" href="%PUBLIC_URL%/favicon.ico">',
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/x-icon", ICON_BYTES));
  });

  it("falls back to favicon files when html files exist without a usable favicon link", async () => {
    const root = await makeTempProject("html-without-icon");
    await writeFile(join(root, "favicon.png"), PNG_BYTES);
    await writeFile(
      join(root, "index.html"),
      "<html><head><title>No icon</title></head></html>",
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/png", PNG_BYTES));
  });

  it("falls back to root favicon.png when no html files exist", async () => {
    const root = await makeTempProject("favicon-png");
    await writeFile(join(root, "favicon.png"), PNG_BYTES);

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/png", PNG_BYTES));
  });

  it("falls back to common project icon filenames when there is no favicon-prefixed file", async () => {
    const root = await makeTempProject("common-icon-names");
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app", "icon.png"), PNG_BYTES);

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/png", PNG_BYTES));
  });

  it("can force refresh instead of reusing the cached favicon", async () => {
    const root = await makeTempProject("force-refresh-cache");
    const faviconPath = join(root, "favicon.ico");
    await writeFile(faviconPath, ICON_BYTES);

    const cachedDataUrl = await discoverProjectFaviconDataUrl(root);
    await writeFile(faviconPath, NESTED_ICON_BYTES);
    const reusedDataUrl = await discoverProjectFaviconDataUrl(root);
    const refreshedDataUrl = await discoverProjectFaviconDataUrl(root, {
      forceRefresh: true,
    });

    expect(cachedDataUrl).toBe(dataUrl("image/x-icon", ICON_BYTES));
    expect(reusedDataUrl).toBe(cachedDataUrl);
    expect(refreshedDataUrl).toBe(dataUrl("image/x-icon", NESTED_ICON_BYTES));
  });

  it("reads web app manifest icon entries referenced from html", async () => {
    const root = await makeTempProject("manifest-icons");
    await mkdir(join(root, "public"), { recursive: true });
    await writeFile(join(root, "public", "icon-192.png"), PNG_BYTES);
    await writeFile(
      join(root, "site.webmanifest"),
      JSON.stringify({ icons: [{ src: "public/icon-192.png" }] }),
    );
    await writeFile(
      join(root, "index.html"),
      '<link rel="manifest" href="site.webmanifest">',
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/png", PNG_BYTES));
  });

  it("reads web app manifest icon entries without an html link", async () => {
    const root = await makeTempProject("direct-manifest-icons");
    await mkdir(join(root, "icons"), { recursive: true });
    await writeFile(join(root, "icons", "icon-192.png"), PNG_BYTES);
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({ icons: [{ src: "icons/icon-192.png" }] }),
    );

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/png", PNG_BYTES));
  });

  it("falls back to nested favicon images when no html or root favicon exists", async () => {
    const root = await makeTempProject("nested-favicon");
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "favicon.ico"), ICON_BYTES);

    const discoveredDataUrl = await discoverProjectFaviconDataUrl(root);

    expect(discoveredDataUrl).toBe(dataUrl("image/x-icon", ICON_BYTES));
  });
});

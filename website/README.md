# Metidos landing page

A self-contained static landing page for Metidos, built with the same Tailwind v4
setup and design tokens as the product UI.

## How it's wired

- `index.html` — the page. Uses token-derived Tailwind utilities (`bg-bg-app`,
  `text-text-primary`, `border-border-default`, `text-accent`, `rounded-md`,
  `font-mono`, …) so it matches `src/mainview/` without copying component code.
- `input.css` — the Tailwind entry: imports `tailwindcss`, imports `theme.css`,
  and scans `./**/*.html`.
- `theme.css` — the `@theme { … }` token block copied verbatim from
  `src/mainview/input.css`. Keep it in sync when the product palette changes.
- `styles.css` — **generated** by the Tailwind CLI (git-ignored).

No JavaScript framework and no external images. The website currently tracks
`bird.png`, a byte-identical copy of the root mascot/favicon asset; its public
redistribution provenance is still pending in
`docs/public-asset-provenance-audit-2026-06-02.md`. No font assets are committed
under `website/`; Inter / Fira Code degrade gracefully to the system font stacks
declared in the tokens.

## Build

From the repo root:

```bash
bun run website:build   # one-off minified build -> website/styles.css
bun run website:watch   # rebuild on change
```

## Preview

Serve the folder with any static server, e.g.:

```bash
bunx serve website
# or
python3 -m http.server -d website 8080
```

## Deploy

It's plain static output (`index.html` + built `styles.css`), so it works on
GitHub Pages or any static host. For GitHub Pages, either commit a built
`styles.css` (remove the `.gitignore` entry) or run `bun run website:build` in CI
before publishing the `website/` folder.

## TODO before going live

- Replace the placeholder GitHub URLs (`https://github.com/YOUR_ORG_OR_USER/metidos`)
  with the real org/repo.
- Set the real canonical site URL in the `og:url` / Twitter meta.
- Add a real 1200×630 Open Graph image and update the `og:image` /
  `twitter:image` URLs (currently placeholders).

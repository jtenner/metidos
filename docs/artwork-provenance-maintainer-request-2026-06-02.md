# Artwork provenance maintainer request — 2026-06-02

Use this note to collect the human provenance decision required before publishing the checked-in artwork assets. It is derived from `docs/public-asset-provenance-audit-2026-06-02.md`.

## Assets awaiting confirmation

| Asset path | Current audit status | Confirmation needed |
| --- | --- | --- |
| `bird.png` | Byte-identical to `website/bird.png`; no textual PNG metadata; Git history only traces to the 2026-05-27 initial open-source snapshot. | Creator/source, creation date if known, license or assignment status, public redistribution approval, and whether the root copy should remain tracked. |
| `website/bird.png` | Byte-identical duplicate of `bird.png`; used so `website/` can remain a self-contained static deployable folder. | Same shared mascot confirmation as `bird.png`, plus whether the website still needs its self-contained duplicate. |
| `src/mainview/pixel-crown.png` | 1024×1024 PNG with no textual PNG metadata; Git history only traces to the 2026-05-27 initial open-source snapshot. | Creator/source, creation date if known, license or assignment status, and public redistribution approval. |

## Questions to send to the maintainer

1. For the shared bird mascot at `bird.png` and `website/bird.png`:
   - Who created it, or what source did it come from?
   - When was it created, if known?
   - Is it owned by this project/repository, assigned to the project, or licensed for public redistribution?
   - If licensed, what exact license terms should be recorded?
   - Is it approved to remain in a public/open-source repository?
   - Should both copies remain tracked so `website/` is self-contained, or should one copy be removed/replaced?
2. For `src/mainview/pixel-crown.png`:
   - Who created it, or what source did it come from?
   - When was it created, if known?
   - Is it owned by this project/repository, assigned to the project, or licensed for public redistribution?
   - If licensed, what exact license terms should be recorded?
   - Is it approved to remain in a public/open-source repository?

## How to record the answer

After the maintainer answers, update `docs/public-asset-provenance-audit-2026-06-02.md` with:

- creator/source details;
- creation date when known;
- license, assignment, or ownership status;
- explicit public redistribution decision;
- whether `website/bird.png` remains necessary as a self-contained website duplicate;
- any replacement/removal decision for assets that cannot be approved.

Then re-run the tracked asset inventory command from the audit:

```bash
git ls-files '*png' '*jpg' '*jpeg' '*svg' '*ico' '*webp' '*gif' '*woff2' '*ttf' '*otf' | sort
```

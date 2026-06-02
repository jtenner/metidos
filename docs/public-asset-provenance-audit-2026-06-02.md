# Public asset provenance audit — 2026-06-02

This audit inventories checked-in binary visual/font assets that need ownership, provenance, and redistribution review before making the repository public.

## Scope and method

Command used:

```bash
git ls-files '*png' '*jpg' '*jpeg' '*svg' '*ico' '*webp' '*gif' '*woff2' '*ttf' '*otf' | sort
```

The inventory below covers only assets tracked by Git. Dependency assets under ignored or vendored package directories are out of scope unless they are copied into tracked repository paths.

## Inventory

| Path | Kind | Observed details | Provenance / license status | Public-readiness decision |
| --- | --- | --- | --- | --- |
| `bird.png` | PNG mascot / favicon | 64×64 PNG, SHA-256 `8f1ac4e0261fae981510691240c2fe70ea524ffc88da634355db690384e4ec39` | Same bytes as `website/bird.png`. No checked-in provenance note found. | Needs owner/provenance confirmation before public redistribution. |
| `website/bird.png` | PNG mascot / favicon | 64×64 PNG, SHA-256 `8f1ac4e0261fae981510691240c2fe70ea524ffc88da634355db690384e4ec39` | Duplicate of `bird.png`. `website/README.md` now identifies this tracked binary and points back to this audit, but the source owner is still unconfirmed. | Needs the same confirmation as `bird.png`; once confirmed, document shared provenance once. |
| `docs/uploadthing-test.png` | PNG test fixture | 1×1 RGB white PNG, 69 bytes, SHA-256 `9853e99cb7e9817f7ee8b6fb9ade7c8e023d2520647034a098f7f85ed81e9cb0` | Regenerated in-repository on 2026-06-02 as a deterministic placeholder fixture for UploadThing documentation/testing; no external source, branding, or third-party creative work. | Safe to redistribute as a repo-owned generated test fixture. |
| `src/mainview/crown.png` | PNG app artwork | 1024×1024 PNG, SHA-256 `3574f6cd4c1923ab86e48ad190b3001d768a239e42a0482b79f91c546772444f` | No checked-in provenance note found. | Needs owner/provenance confirmation before public redistribution. |
| `src/mainview/logo.png` | PNG app artwork | 1024×1024 PNG, SHA-256 `beee44be23886c0ef0e1b7ad0483be5b476b0561c3869fa25d001f924a037bd8` | No checked-in provenance note found. | Needs owner/provenance confirmation before public redistribution. |
| `src/mainview/pixel-crown.png` | PNG app artwork | 1024×1024 PNG, SHA-256 `612ce96ff6a4abf74bbab6b1b1b438d1e181fc34b8c7ebc6870dc7944e293c40` | No checked-in provenance note found. | Needs owner/provenance confirmation before public redistribution. |
| `src/mainview/fonts/fira-code-vf.woff2` | WOFF2 font | SHA-256 `408e876a202f15ea6ee307a70a65cf40ceb222c589a0b17e0a3a371db96dd49f` | `src/mainview/fonts/README.md` says it is vendored from `firacode@6.2.0`; `src/mainview/fonts/FiraCode-LICENSE.txt` contains the SIL Open Font License 1.1. | Public redistribution appears covered if license text remains with the asset. |
| `src/mainview/fonts/inter-latin-ext-wght-normal.woff2` | WOFF2 font | SHA-256 `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956` | `src/mainview/fonts/README.md` says it is vendored from `@fontsource-variable/inter@5.2.8`; `src/mainview/fonts/Inter-LICENSE.txt` contains the SIL Open Font License 1.1. | Public redistribution appears covered if license text remains with the asset. |
| `src/mainview/fonts/inter-latin-wght-normal.woff2` | WOFF2 font | SHA-256 `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` | `src/mainview/fonts/README.md` says it is vendored from `@fontsource-variable/inter@5.2.8`; `src/mainview/fonts/Inter-LICENSE.txt` contains the SIL Open Font License 1.1. | Public redistribution appears covered if license text remains with the asset. |

## Findings

- The tracked font assets have usable checked-in provenance and license files.
- The tracked artwork PNG assets do not yet have enough checked-in provenance to prove public redistribution rights.
- `docs/uploadthing-test.png` is a repo-owned generated 1×1 fixture and is safe to keep tracked for public redistribution.
- `bird.png` and `website/bird.png` are byte-identical duplicates; any future provenance note should identify the shared source and why both copies are needed.

## Recommended follow-up

1. Add a durable provenance note for repo-owned artwork (`bird.png`, `website/bird.png`, `src/mainview/crown.png`, `src/mainview/logo.png`, `src/mainview/pixel-crown.png`) that names the creator/source, creation date if known, license or assignment status, redistribution approval, and why both bird copies are needed if both remain tracked.
2. Re-run the `git ls-files` inventory after any asset additions or removals.

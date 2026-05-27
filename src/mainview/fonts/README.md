# Vendored mainview fonts

These WOFF2 files are served by the Bun backend for the mainview `@font-face` rules in `src/mainview/input.css`.

- `fira-code-vf.woff2` is vendored from `firacode@6.2.0` (`node_modules/firacode/distr/woff2/FiraCode-VF.woff2`) and licensed under the SIL Open Font License 1.1. See `FiraCode-LICENSE.txt`.
- `inter-latin-wght-normal.woff2` and `inter-latin-ext-wght-normal.woff2` are vendored from `@fontsource-variable/inter@5.2.8` and licensed under the SIL Open Font License 1.1. See `Inter-LICENSE.txt`.

Keep these filenames stable unless you also update the `@font-face` URLs and static asset mappings.

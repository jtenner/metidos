Break the top-level mainview shell into smaller controller and workspace modules rooted under `src/mainview/app/` and nearby focused files.

## Scope

- extract unrelated controller logic and helper clusters out of `App.tsx`
- keep warning, loading, selection, and workspace flows closer to the UI areas that own them
- preserve the existing behavior and test coverage while reducing file size and review surface

## Acceptance

- `App.tsx` no longer acts as the default home for unrelated state and controller code
- extracted modules have focused responsibilities and clearer ownership
- existing mainview tests still pass and new tests cover any newly isolated logic where worthwhile
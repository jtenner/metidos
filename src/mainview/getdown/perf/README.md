# Performance baselines

Run the internal performance harness from the repository root:

```bash
bun run src/mainview/getdown/perf/baseline.tsx
```

Save a timestamped JSON snapshot for future comparison:

```bash
bun run src/mainview/getdown/perf/baseline.tsx --save
```

The harness reports:

- `mean/op` and `p95/op` timing across repeated rounds.
- `heap Δ/op`: heap growth before the post-case GC sweep, a proxy for transient allocation pressure.
- `retained Δ/op` and `retained obj/op`: heap/object growth after `gcAndSweep()`, a proxy for retained memory.
- `throughput`: input size converted to KB per second for scale benchmarks.

Benchmark groups:

- **document**: Full `parseDocument` calls exercising individual block types and structural sharing.
- **inline**: `parseInlines`, `hasUnclosedCodeSpan`, and `normalizeReferenceLabel` micro-benchmarks.
- **streaming**: Append deltas to a growing string and call `parseDocument(content, previous)` after each delta.
- **react**: `renderToStaticMarkup(<GetDown ... />)` end-to-end rendering.

## Current baseline

Captured with `bun run src/mainview/getdown/perf/baseline.tsx` on May 6, 2026.

| group | case | mean/op | p95/op | heap Δ/op | retained Δ/op | retained obj/op |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| document | `parseDocument:kitchen-sink` | 38.19 µs | 47.76 µs | 86.2 B | 37.1 B | 0.092 |
| document | `parseDocument:reuse-unchanged` | 73 ns | 94 ns | 0.0 B | 3.3 B | 0.047 |
| inline | `parseInlines:kitchen-sink` | 14.15 µs | 14.95 µs | 7.9 B | 1.0 B | 0.006 |
| inline | `hasUnclosedCodeSpan` | 98 ns | 112 ns | 0.0 B | 0.1 B | 0.001 |
| inline | `normalizeReferenceLabel` | 151 ns | 172 ns | 0.0 B | 0.0 B | 0.000 |
| streaming | `stream:96-byte-chunks` | 11.89 ms | 12.55 ms | 106.03 KiB | -5.75 KiB | -142.467 |
| streaming | `stream:line-chunks` | 56.95 ms | 58.28 ms | 434.34 KiB | -21.11 KiB | -212.380 |
| streaming | `stream:final-block-trickle` | 1.64 ms | 1.66 ms | 11.51 KiB | 180.6 B | 1.617 |
| react | `renderToStaticMarkup:GetDown` | 173.97 µs | 410.59 µs | 414.1 B | 162.0 B | 0.231 |

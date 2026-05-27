/**
 * @file src/mainview/app/frontend-audit-dispositions.ts
 * @description Source-level disposition notes for the May 2026 Mainview frontend audit pass.
 *
 * This file is intentionally runtime-neutral. It keeps the audit review comments
 * close to the Mainview source tree without adding product behavior.
 *
 * Dispositions for the 30 reported items:
 *
 * 1. Deferred transcript content races: fixed in App by validating IDs and
 *    ignoring responses whose AbortSignal was already aborted.
 * 2. Phantom content request keys: fixed in App by rejecting non-positive or
 *    non-integer thread/message IDs before building the request key.
 * 3. Nested project/worktree state pruning: accepted as a local consistency
 *    tradeoff; both updates are synchronous React state projections from the
 *    same project payload and the later worktree pruning is idempotent.
 * 4. Startup initialization ref: not a bug; startup restore intentionally runs
 *    once per Mainview mount from the initial persisted/session snapshot.
 * 5. Compact text signature cache accounting: fixed with a defensive invalid-key
 *    branch that clears the bounded cache before byte accounting can drift.
 * 6. Thread-start thinking-label ternary readability: not a correctness issue;
 *    the optional chain preserves the default label when a model option is absent.
 * 7. Thread preview role="note": fixed by switching noninteractive previews to
 *    role="tooltip".
 * 8. Timezone autocomplete options: fixed by adding aria-selected for listbox
 *    option state.
 * 9. Transcript pseudo-headings: fixed for error and reasoning transcript blocks
 *    by using real heading elements with existing label styling.
 * 10. Virtualized transcript aria-describedby: not a bug; each row and its
 *     described summary are mounted/unmounted together by the virtualizer.
 * 11. Settings modal focus trapping: not a bug; ModalDialogSurface centralizes
 *     focus management and traps Tab for modal surfaces.
 * 12. text-text-faint contrast: no code change here; token-level contrast belongs
 *     in STYLE/input.css auditing rather than one-off component overrides.
 * 13. Thread-status polling promise chains: not a leak; active request refs are
 *     nulled in finally blocks and interval cleanup aborts in-flight fetches.
 * 14. WeakMap message signatures: not a leak; keys are weak and retained message
 *     count is bounded by thread-message retention.
 * 15. Memory telemetry snapshot ref: not a leak; it intentionally keeps only the
 *     latest small counter snapshot for interval publication.
 * 16. RPC pendingRequests map: not a leak; disconnect/disable paths reject and
 *     clear all pending requests, while per-request abort removes entries.
 * 17. Deferred sidebar search: accepted performance tradeoff; the UI may show a
 *     short stale-search frame to keep typing responsive.
 * 18. Selected-thread detail poll skipping: accepted backoff; the refresh key and
 *     run-state transition checks still force important selected-thread refreshes.
 * 19. Copied-message feedback: accepted; the status popover is noninteractive,
 *     short-lived, and announced through its status role.
 * 20. New-worktree popover focus: accepted; PopoverSurface owns focus restore and
 *     nonmodal-dialog dismissal for that transient form.
 * 21. Thread-start approval busy state: not a bug; the selection controller sets,
 *     checks, and resets isApprovingThreadStartRequest around approvals.
 * 22. Thread model/reasoning busy flags: not a bug; App resets both flags in the
 *     respective RPC finally blocks.
 * 23. Thread action busy state: not a bug; rename, pin, and delete handlers guard
 *     on the busy flag and reset it on completion or recoverable errors.
 * 24. Image alt text: accepted for now; transcript images use available
 *     attachment context and labels so users get capture context.
 * 25. Transcript virtualizer estimate: accepted performance tradeoff; measured
 *     rows correct the fixed estimate and keep initial virtualization cheap.
 * 26. Extension prompt dialog focus: fixed by using ModalDialogSurface instead of
 *     a raw non-modal dialog element.
 * 27. Completed-thread indicator clearing: accepted; Set cloning is bounded by
 *     visible thread interactions and avoids mutating React state in place.
 * 28. Command preview copy keyboard propagation: fixed by stopping keydown
 *     propagation on the inline copy control.
 * 29. Sidebar collapsed ref/state: accepted; the ref is a synchronous bridge for
 *     callback logic while React state remains the render source of truth.
 * 30. Remote markdown image loading policy: deferred to a future security-hardening slice.
 */

export {};

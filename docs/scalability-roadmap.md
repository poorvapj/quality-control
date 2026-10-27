# Scalability Roadmap

Ordered by expected impact. Nothing here is applied unless listed in the changelog. Every item preserves current API shapes unless marked.

1. **Measure first** (see performance-baseline.md). The items below depend on real `/api/state` size and request rates.
2. **Delta sync instead of full-state refetch (highest impact, medium-high risk).** Add a *new, additive* endpoint (e.g. `GET /api/changes?since=<rev>`) backed by per-record `updatedAt`/rev stamps; keep `/api/state` as is so old clients keep working. Needs a schema addition (stamp field) → backward-compatible, no migration of existing docs required if treated as "missing = always include". **Requires approval.**
3. **Cache `/api/rev` in memory (low risk, needs a decision).** Single Render instance: keep the rev in process, update on `bumpRev`, with a ~1s TTL as the safety net for out-of-band writes (same pattern as `stateCache`). Would cut one Mongo read per client per 5s. Trade-off: if ever run as >1 instance, instances see each other's writes up to TTL late.
4. **Pre-load users/teams once for approval checks.** Reuse a short-TTL cache (like `roleCache`) in `applyApprovalRules`/`decideApprovalFromSlack`. Small win; correctness-sensitive (approver identity) so keep TTL ≤ 10s as existing role caches do.
5. **Route-level code splitting** of rarely used pages (Backups, AuditLog, PermissionMatrix, Masters, CaseStudies). Keep the dashboard, QC, snags, measurement pages eager or prefetched, because lazily loading a chunk offline fails. Verify with offline test before shipping.
6. **Events/audit growth.** `events` is capped at 5000 (older audit history is deleted). If long-term audit retention matters, archive trimmed events to a separate collection instead of deleting. **Business decision.**
7. **Pagination for tables** once any collection passes ~10k rows; today the full-board model makes this a prerequisite for #2.
8. **Add indexes only after profiler data** (e.g. `snags.projectId`, `qualityInspections.unitId`) — none are justified by current server-side filtered queries, which are only the project-delete cascade and the VMS link report (both already indexed).
9. **Operational:** structured request logging with timings, a health endpoint, and moving scheduled jobs off in-process timers if Render is upgraded off the free tier.

---
## Revised priorities after measurement (2026-10-27)
Measured locally (see `performance-baseline.md`; loopback + in-memory MongoDB, relative numbers): the board at today's size is ~0.86 MB raw / 59 KB gzip and everything is fast; **cost grows linearly with data and is paid on every write and by every client**:
1. **Thundering herd on state rebuild (new, high at scale, small safe fix).** When the revision changes, every connected client requests `/api/state` at once and each request rebuilds (JSON + gzip) the whole board independently on the single Node thread. At 10x data with 40 clients: fan-out ≈ 11 s and server working set ≈ 1.9–2.4 GB; a throwaway prototype that lets concurrent requests share one in-flight rebuild brought that to ≈ 0.32 s and ≈ 440 MB. **Recommended first, ahead of delta sync** — ~15 lines in `getStateGzip`, no API/contract change. **Implemented in Round 4 (commit `6265776`, not deployed); see performance-baseline.md for before/after.**
2. **Write latency includes a full-board rebuild.** `POST /api/ops` replies with the whole board, so a save takes ≈ 33 ms at 1x but ≈ 250–290 ms at 10x. Letting the client ask for a small reply (additive, opt-in) would remove it; this is also the first step toward delta sync.
3. **Latent race in `getState`** (reads the revision *in parallel with* the data, so a snapshot can be stamped with a newer revision than its data, making a client skip one update until the next change). Reading the revision first fixes it; included in the proposal in (1).
4. Delta sync — only after (1)–(3) are re-measured; see `delta-sync-design.md` §14 and `performance-baseline.md`.
5. Database user is `atlasAdmin@admin`; create a least-privilege user (config change, needs approval).

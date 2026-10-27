# Architecture Audit

Updated 2026-10-27. **Legend:** ✅ confirmed by reading the code (or running a test) · 🔎 needs production profiling · ⚠️ reported by the frontend-audit subagent and not independently re-verified by me.

## Coverage — what was and was not inspected
- **Read in full:** `backend/server.js` except lines ~139-380 and ~1800-1855 (Slack/n8n helper functions and parts of the Slack action handler, skimmed only); `seed.js` header, collection list and user seed; `AppContext.tsx` poll/flush/apply paths (read directly); `vmsDprApiHandler.js` insert path.
- **Grep/skim only:** the other backend modules (`approvalRules`, `qualityInspectionRules`, `workMeasurementRules`, `syncVmsDpr`, `progressAnalysis`, `executionReconciliation`, `teamDailyReports`, `weeklyQcReport`, Slack modules, one-off `fix-*`/`migrate-*` scripts and `scripts/`). Their unit tests pass (14 files); I did not review their logic line by line.
- **Frontend pages:** audited by a read-only subagent that read AppContext, `rules.ts`, `misData.ts`, `boardLens.ts`, and the hot paths of ~10 pages; it only grepped DailyProgressReport, PossessionForm and QualityInspection. Treat the frontend section as thorough-but-not-exhaustive.
- **Not available:** Render dashboard/instance config (none is in the repo), Atlas metrics/profiler, production logs, real collection sizes. `backend/.env` exists locally and was deliberately not opened.

## Architecture (verified)
- React 18 + Vite + Tailwind SPA on Vercel (`frontend/vercel.json`); one raw Node `http` server (`backend/server.js`) on Render; MongoDB Atlas; Cloudinary for photos; Slack, n8n, VMS (Mongo + HTTP push), IMS (webhook) integrations. JWT sessions (7d), stateless.
- Data: ~30 generic collections keyed by `id` (list in `seed.js`), `progress` keyed `target::stage`, `events` (cap 5000), `meta` (`rev` counter + report markers), `backups` (whole board per document).
- Sync: client holds the whole board. `GET /api/state` (gzip, cached per rev for 3s) → poll `GET /api/rev` every 5s → full refetch on change. `POST /api/ops` applies record-level upserts/deletes/progress/events, then `bumpRev()`, and replies with the full state.
- Server-side enforcement exists for: admin-only deletes and `users`/`moduleGrants` writes; Masters role gate; drawing-request transition table + stage permission + compare-and-swap; approval derivation/decision (`approvalRules.js`); stage `progress` role checks; anonymous create-only for `dpr`/`drawingRequests`/public forms; quality-inspection result recomputed from checklist; measurement validation; project-delete cascade and reset/restore inside a transaction.

## Findings

### Security / integrity
| ID | Sev | Finding | Evidence |
|---|---|---|---|
| S1 | **High** ✅ | `GET /api/state` needs no session. Anyone who can reach the API gets the whole board (users' names/emails/phones/slackIds, snags, inspections, permissions…). Password hashes are stripped. Public pages call it (AppProvider wraps them) so a fix needs a reduced public snapshot. | `handleApi` `/api/state` has no `getSession`; `main.tsx` wraps public routes |
| S2 | **High** ✅ | `POST /api/photo` needs no session → anonymous uploads to your Cloudinary account (up to 16 MB, no rate limit). | server.js ~L1907 |
| S3 | **High (data loss)** ✅ **FIXED in `8357555` (not deployed)** | Queued offline/expired-session ops are dropped on the first flush: `flushPendingOps` discards a batch on **any** non-OK response (incl. 401, 429, 5xx/502 from a sleeping Render dyno), contradicting `apply()`'s own 401 comment. | AppContext.tsx L281-288 vs L333-345 |
| S4 | Medium ⚠️ | Multi-tab flush: `isFlushingRef` is per tab; two tabs can POST the same batch; no op id/idempotency key; event ops carry no id so a replay duplicates audit events; flush rewrites the queue from in-memory copy and can clobber another tab's queued ops. | AppContext.tsx L268-299 |
| S5 | Medium ⚠️ | `logout()` leaves the pending queue and cached board in localStorage; the next user on a shared device would flush the previous user's queue with their own token. | AppContext.tsx ~L527 |
| S6 | Medium ✅ | Slack "Close snag" button closes the snag even if the clicker can't be matched to an app user (`actor` null → "closed via Slack"); only Slack's request signature is checked. | server.js ~L1872-1881 |
| S7 | Medium ✅ **FIXED in `8357555` (not deployed)** | Rev-bypassing writers: the IMS webhook (`purchaseOrders` upsert, ~L1753) and VMS DPR push (`vmsDprApiHandler.js` L45) never call `bumpRev()`. Clients only see those records after some unrelated later write. | grep of every write path |
| S8 | Medium ✅ (measured: backups 0.65→1.22 MB, 7.6% of limit; see backup-storage-investigation.md) | **Backups embed the whole board in one Mongo document.** `createBackup` does one `insertOne` with all collections inside; MongoDB's 16 MB document limit will make backups **fail** as data grows (and a failed scheduled backup is silent to users). Also no backup retention/pruning. | `createBackup`, L1446-1464 |
| S9 | Low ✅ | JWTs can't be revoked for 7 days (documented trade-off). Role/permission caches are per-process 10s. | server.js L101-103, L399-442 |
| S10 | Low ✅ | Identity in the UI comes from localStorage `neoteric_user` / header switcher; server trusts the JWT, so this is a UI-only concern. Client-only guards listed by the subagent (`canAccessTab`, `canDecide`, `canAct`, evidence-photo requirement) were not each checked against the server; the server-side list above shows which are mirrored. ⚠️ | frontend `permissionMatrix.ts`, `approval.ts` |

### Backend performance / scalability
| ID | Sev | Finding | Status |
|---|---|---|---|
| B1 | High at scale ✅ | Whole-board snapshot per change per client (design limit). | See delta-sync-design.md |
| B2 | Medium ✅ | `bumpRev` = 2 round trips and, under concurrency, returned duplicate revs (**measured: 15 distinct values for 200 concurrent bumps**). | **Fixed** (see changelog) |
| B3 | Low ✅ | `trimEvents` exact `countDocuments` on every ops batch. | **Mitigated** (estimate fast-path; deletion still uses an exact count) |
| B4 | Medium ✅ | `applyOps` re-reads `users`+`teams` fully for every approval-collection save; Slack-resend loads 3 whole collections; `/api/team-reports/generate` calls full `getState()`. Tables small today. 🔎 | Roadmap |
| B5 | Medium ✅ | Heavy per-request validation in `assertOpAllowed` does 1-3 `findOne`s per op; a batch of N ops costs O(N) round trips. 🔎 | Roadmap |
| B6 | Low ✅ | Login case-insensitive anchored regex can't use the email index (small collection). | Roadmap |
| B7 | Low ✅ | No server-level request/header timeouts, no request rate limits other than login lockout and the Slack-resend cooldown; 16 MB body cap on every endpoint. | Roadmap |
| B8 | Low ✅ | Several unawaited notification promises are caught individually, but `process.on("unhandledRejection")` **exits the process** — any missed rejection restarts the service (and drops in-memory state/timers). | server.js L2183 |
| B9 | Info ✅ | In-process timers (VMS poll 30 min, weekly report check 5 min) run on every instance. The weekly report is protected by an atomic claim; the VMS poll is idempotent. | server.js L2214-2306 |

### Frontend performance (⚠️ from subagent; items marked 🔎 need a profile)
- F1 `mergeStableCollections` does `JSON.stringify` of both versions of every collection on every rev change, and returns a new top-level object, so every `useMemo([data])` recomputes after each poll. 🔎
- F2 `apply()` does `structuredClone` of the whole board per action. 🔎
- F3 The context `value` is not memoized → every `useApp()` consumer re-renders on any state change (toast, mode, modals).
- F4 `Sidebar` computes `myReleases` + snag counts on every context change: `myReleases` → per-unit `blockReason`, which does `byId(units)` (O(units)) → roughly O(units² × stages). `unitSummary` has the same shape and is called for every unit in OpsDashboard (no memo), TowerBoard, `buildUnitRows`. 🔎
- F5 `Drawer` filters/sorts up to 5000 events on every render; `AuditLog` sorts all events on every keystroke; `Masters` does `JSON.stringify(row)` per row per keystroke; no pagination/virtualization in Snags, Masters (units ≈ 2,640 rows), DrawingRequests, HandoverChecklist.
- F6 All pages are in one 693 kB (184 kB gz) chunk; lazy loading conflicts with offline support (a not-yet-loaded chunk can't be fetched offline).
- F7 Poll loop has no in-flight guard/ordering: a slow `/api/state` can land after a newer `apply()` response and roll data back one tick; `/api/rev` response isn't checked for `ok`, so an error body (`rev === undefined`) triggers a full `/api/state` download every tick until it clears.
- F8 Queued optimistic edits aren't re-applied when server state replaces local state (poll/reload), so after a reload "N waiting" shows with the edits invisible.
- F9 Public pages (`/dpr/new`, drawing-request, forms) download the whole board and poll every 5s (ties to S1).
- No listener/interval leaks found in the paths checked.

## What I did NOT change (needs your approval)
S1/S2 (investigated: security-public-flows.md), S8 (investigated: backup-storage-investigation.md), S4-S6, B4-B8, all F-items, delta sync. See `scalability-roadmap.md`.

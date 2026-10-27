# Save diagnostics (log-only) — how to enable, read and evaluate

**What this is:** an *observation-only* mode that checks, on real traffic, the rule the "minimal save reply" design (`save-response-design.md`) would use to decide a save is **clean**. It does **not** implement minimal replies, does not change any response body, write, or the frontend. **Default: OFF.**

## 1. Enabling and disabling
| Setting | Default | Meaning |
|---|---|---|
| `SAVE_DIAGNOSTICS=1` | unset (OFF) | turns it on (exactly `1`; anything else is off). The server prints `save diagnostics: ON` once at start. Read at startup → a restart is needed to change it. |
| `SAVE_DIAGNOSTICS_EXAMPLES` | 3 | max example lines per outcome+reason combination |
| `SAVE_DIAGNOSTICS_SUMMARY_EVERY` | 200 | a summary line every N compared batches |
Disable = remove the variable and restart. Nothing is stored in the database, no collection, no schema, no new endpoint. Output goes to the normal server log (Render ▸ Logs); filter on `[save-diag]`.
**Not enabled by me, and not enabled in any commit** — setting the variable on Render is your decision.

## 2. What is compared
For every `POST /api/ops` batch that is actually applied:
- **PREDICTED** (the proposed rule): *clean* unless the batch touches a collection the server rewrites (`users`, `qualityInspections`, `materialMeasurements`, `workMeasurements`, `teamDailyReports`, `formSubmissions`; and `drawingRequests`/`dpr` when **anonymous**) or deletes a project.
- **OBSERVED** (what the server really did), detected generically — not by re-implementing each rule:
  - any op record whose fields differ **after** the server's rules ran (a fingerprint of every top-level field is taken before and after) → covers approval derive/decide/strip, inspection `result` forced from the checklist, work-measurement link re-derivation, public drawing-request/DPR/form defaults, team-report sign-off rewrite, and any rule added later;
  - a `users` save carrying a password (the server hashes and discards it);
  - a **project-delete cascade**, with the server's own deletion counts per collection (floors, units, snags, assignments, dpr, drawingRequests, stagemap, workTargets, progress);
  - a **passing re-inspection that actually closed the original's snag** (from the update's modified count).
Refused or failed batches (4xx/5xx) are not compared (nothing was applied).

## 3. Outcomes
| Outcome | Meaning | Action |
|---|---|---|
| `agree-clean` | predicted clean, nothing changed | the saves a minimal reply would speed up |
| `agree-not-clean` | predicted not clean and the server did transform something | the rule is right |
| **`MISMATCH-unsafe`** | predicted **clean**, but the server changed something | **a minimal reply would have left the writer's copy wrong.** Logged at **warn** level (rate-limited to 20 per 10 min, the rest counted in `suppressedUnsafe`). **Must be zero before any minimal-reply behaviour is enabled.** |
| `mismatch-conservative` | predicted not clean but nothing changed (e.g. an admin saving an inspection — no approval applies) | harmless; shows where the rule could later be widened |

## 4. Log format and what is never logged
One line per example / summary, e.g.
```
[save-diag] {"outcome":"agree-not-clean","predictedClean":false,"observedClean":false,"ops":[{"kind":"upsert","coll":"qualityInspections"}],"reasons":["server-modified:qualityInspections"],"changed":[{"coll":"qualityInspections","fields":["result","approval"]}],"anonymous":false}
[save-diag] {"summary":true,"batches":200,"aborted":3,"suppressedUnsafe":0,"outcomes":{"agree-clean|snags":150,...},"reasons":{...}}
```
Only collection names (checked against the known list, else `<unknown>`), op kinds, counts, and **field names from a fixed allow-list of fields the server is known to write** (anything else is `<other>`). **Never** logged: passwords, tokens, record ids, user ids, emails, names, phone numbers, record values, or board contents — enforced by unit and end-to-end tests that plant such values and scan the output (and by a mutation check that fails the suite if field-name filtering is removed). Every line is length-capped (700 chars).

## 5. Bounds and safety
- **Volume:** ≤ `EXAMPLES` lines per outcome+reason + a summary per `SUMMARY_EVERY` batches + ≤ 20 unsafe lines per 10 minutes. In the 14-scenario end-to-end run: 15 lines total.
- **Cost (local micro-benchmark, one machine):** ≈ 12 µs per small save, ≈ 0.14 ms for a 16 KB inspection (SHA-1 of each top-level field before and after) against ≈ 33 ms for a save. Memory per batch is freed at the end of the request. Unmeasured on Render.
- **Cannot change saving:** the ops are not modified by the diagnostics (tested byte-for-byte); the two server hooks only *keep results the code already received* (`deleteMany`/`updateOne` results, read null-safely); every diagnostic call swallows its own errors (tested with circular objects, throwing getters, BigInt, a throwing logger, and a live-server fault injection where the diagnostics' hash function throws — saves still returned 200, wrote the same data, and the server stayed up); an identical 14-scenario script run against a server with diagnostics ON and one with it OFF produced identical HTTP statuses, error texts, and final database contents (all collections, revision, events).

## 6. How to evaluate the logs before enabling any minimal-response client behaviour
1. **Run it for at least 2 weeks of normal use** including at least one approval cycle, one project/master edit session, public DPR submissions, and a re-inspection; capture every `[save-diag]` line (Render logs are retained for a limited time — export them periodically).
2. **Hard gate — `MISMATCH-unsafe` must be 0** across the whole window (check `outcomes` in the latest summary and grep for the outcome). Any hit: read its `ops`/`changed`/`reasons` (names only), add the collection or rule to the static predictor (and to this document), and restart the clock.
3. **Coverage gate:** every row of `save-response-design.md` §3 should have been **seen at least once** in `agree-not-clean` (approval, inspection result, work-measurement link, public defaults, user password, project cascade, re-inspection closure). A rule never seen has not been validated by real traffic.
4. **Benefit estimate:** `agree-clean ÷ all` = the share of saves a minimal reply would speed up; `mismatch-conservative` shows how much more could be won by widening the rule. If the clean share is small, the optimisation is not worth its risk.
5. **Unknowns to settle separately (the diagnostics cannot see them):** (a) whether the *client's own optimistic copy* equals the server's copy for a clean save (null-vs-absent, merge semantics) — needs a client-side compare in staging; (b) revision continuity (`rev === lastSeen + 1`) — it is checked client-side in the design; the server only sees concurrency inside one batch; (c) approval *decisions* by leaders on records made by others are covered (they change `approval`), but changes made by *other users* between saves are handled by the revision rule, not by this check.
6. Only then decide, in writing, whether to proceed to the opt-in `reply:"minimal"` server path; that is a separate, separately approved change.

## 7. Tests
`backend/saveDiagnostics.test.js` (22: each transformation, privacy, bounds, rate limit, isolation, no mutation, predictor); real-server end-to-end (20 checks: every transformation with real fixtures, ON-vs-OFF identity, log hygiene) and fault injection (3 checks); mutation checks (password reason, field-name filtering, example cap). The two end-to-end scripts live in the session scratchpad (they need `mongodb-memory-server`, not a repo dependency).

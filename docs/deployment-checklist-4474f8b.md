# Deployment checklist — the eight commits `75f574a..4474f8b`

**Status: nothing pushed or deployed.** Which remote/branch Render tracks (`origin` = shipra-neoteric/project-quality, or `poorva` = poorvapj/quality-control) is **unconfirmed**; if Render's Auto-Deploy is "On Commit", a push *is* a deploy.

Legend: **[V]** verified (test or inspection), **[A]** assumption, **[U]** unmeasured on production.

| Commit | What |
|---|---|
| `8357555` | IMS/VMS writes bump the revision; offline queue keeps and de-duplicates edits |
| `7495c30` | token on state/photo calls, public snapshot, photo guard (both enforcement flags OFF) |
| `d4e21ed` | backups: cheaper listing, size/duration logs, loud failure, audit-event copy |
| `6265776` | `/api/state` rebuild shared across concurrent requests |
| `2e9c432` | docs only |
| `c960f58` | no plaintext password in the writer's local board |
| `10a53ef` | log-only save diagnostics (OFF) |
| `4474f8b` | diagnostics: valid multipart summaries, batch totals, shutdown summary; no client IP in photo log |

## 1. Always-on behaviour changes (no flag)
- **Revision bump on IMS/VMS writes** [V local]: clients see those writes and refetch the whole board more often. [U] production refetch rate and `/api/state` load.
- **Shared `/api/state` rebuild** [V local benchmark, in-memory DB]: concurrent requests for the same revision share one build (< 30 s old); failures never cached; 3 s TTL unchanged. Local: 10x data 11.8 s → 0.29 s for 40 clients; at 1x about +20 ms catch-up. [U] Render.
- **Idempotent saves** [V]: a `batchId` on `/api/ops` stores a marker; a duplicate delivery returns the stored outcome; a concurrent duplicate gets 503 and retries. Old clients send no `batchId` → unchanged behaviour.
- **Offline queue** [V unit + browser]: 401/408/425/429/5xx keep the batch; other 4xx drop it with a toast; never replayed under another user's token; full board re-fetched after sign-in.
- **Backups** [V]: new backups include audit events (bigger); a document over 16 MB is refused *before* the insert → HTTP 500 + `BACKUP_FAILED` audit event + optional Slack DM (`BACKUP_ALERT_EMAILS`). Storage format/retention unchanged.
- **Photo guard** [V]: monitor-only; still counts uploads, logs `[photo] monitor-only, would refuse …` without IP; refuses nothing.
- **Password** [V]: stripped from the local `users` record only; ops still carry it to the server.

## 2. Database changes
- **One new index at startup** [V on Atlas replica set read-only inspection + local]: `meta` TTL `{expireAt:1}, expireAfterSeconds:0`. Existing `meta` docs (e.g. `rev`) have no `expireAt` → untouched. [V] The app's DB user is `atlasAdmin@admin`, so `createIndex` is permitted. [U] index build time on production (tiny collection → expected instant).
- **Idempotency markers**: `meta` documents `_id:"opb:<batchId>"`, pending → done, `expireAt` = +30 days, removed by the TTL monitor (runs about every 60 s) [A: TTL deletion timing is Atlas-controlled]. About two small writes per save that carries a `batchId`.
- **No migration, no new collection, no schema change, no data rewrite** [V by diff review].

## 3. Backup-size limit
[V] production backups are 0.65 and 1.22 MB (7.6 % of the 16 MB document limit); the board is about 1.3 MB. Adding events grows each backup by an amount [U] (depends on the real events history). Over 16 MB the backup fails loudly (not silently) — watch for `BACKUP_FAILED`. [U] whether Atlas Cloud Backup is enabled/which tier (user to check).

## 4. Environment variables (all optional, none set by this work)
| Variable | Default | Note |
|---|---|---|
| `SAVE_DIAGNOSTICS` | unset = OFF | exactly `1` enables; read at start |
| `SAVE_DIAGNOSTICS_SUMMARY_EVERY` | 25 | `1` for the observation window |
| `SAVE_DIAGNOSTICS_EXAMPLES` | 3 | per outcome+reason |
| `PUBLIC_STATE_ENFORCE` | unset = OFF | not before old tabs reload |
| `PHOTO_GUARD_ENFORCE` | unset = OFF | same |
| `CLIENT_IP_HOPS_FROM_RIGHT` | 0 | [A] correct value for Render not verified; affects per-IP counting only |
| `BACKUP_ALERT_EMAILS` | QC report owner | Slack DM recipients for backup failure |

## 5. Rollout order
1. Confirm repo/branch in Render ▸ Settings; confirm a recent good backup exists.
2. **Deploy backend with all flags absent.** Verify: clean startup, no `save diagnostics: ON`; `GET /api/rev`; sign in; one real save; `meta` TTL index present in Atlas; one backup completes (size/duration line).
3. **Deploy frontend** [V compatible both ways: new frontend + old backend ignores `batchId`/token; old frontend + new backend is unchanged].
4. Wait for old tabs to reload (JWTs last 7 days); check logs for `[photo] monitor-only` lines.
5. Separately approved: `SAVE_DIAGNOSTICS=1` + `SAVE_DIAGNOSTICS_SUMMARY_EVERY=1`; observe up to six weeks; export logs periodically (Render retention is limited); review with `node backend/reviewSaveDiag.js` (PASS only with ≥ 100 real batches, zero unsafe, valid summaries, all ten rules real or synthetically verified; otherwise "insufficient evidence").
6. Enforcement flags and minimal save replies: separate decisions, not part of this deployment.

## 6. Stop conditions and rollback
- Stop if: save errors/5xx rise, `/api/state` latency or memory worsens, `BACKUP_FAILED`, any `MISMATCH-unsafe`.
- **Diagnostics / enforcement flags:** remove the variable, restart (nothing stored).
- **Code:** redeploy the previous Render deploy or revert the commits. No data/schema to undo; the TTL index and `opb:*` markers are harmless to leave (markers expire; the index can be dropped).

## 7. What was and was not validated
**Done locally, Node v26.7.0:** 21 backend test files, frontend tests, real-server end-to-end with in-memory MongoDB, synthetic diagnostics tests (`save-diagnostics-synthetic-test.md`).
**Not done:** Node 20 (the `engines` target, `20.x`) — not installed on this machine, not downloaded; Render itself; production load; Atlas backup tier.
**Approved ways to get Node 20 here (user action):** install nvm-windows or fnm yourself, then `nvm use 20` (or `fnm use 20`) and rerun `for t in backend/*.test.js; do node $t; done`; or run the suite in CI/Docker (Docker is not installed here).

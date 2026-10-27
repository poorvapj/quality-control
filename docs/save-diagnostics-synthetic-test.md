# Save diagnostics — synthetic tests and log reviewer

Everything here runs on **invented data only**: no production data, no credentials, no `clone-db-for-dev.js`, no network beyond `127.0.0.1`.

## A. `backend/reviewSaveDiag.test.js` — reviewer logic (no database)
`node backend/reviewSaveDiag.test.js` (12 tests). Feeds logs produced by the **real** `saveDiagnostics.js` to the reviewer `backend/reviewSaveDiag.js` and checks:

| Area | Checked |
|---|---|
| Valid JSON, 700-char limit | every line valid JSON and ≤ 700, including a worst-case oversized batch; an over-long or cut line → hard FAIL (gate 2) |
| Multipart summaries | parts reassembled by `boot`+`seq`; an incomplete latest summary falls back to the previous complete one |
| Batch reconciliation | `batchOutcomes` adds up to `batches`; a tampered total → hard FAIL (gate 3) |
| Unsafe mismatch | a batch predicted clean but changed by the server → FAIL, exit 2 (gate 1) |
| Insufficient evidence | < 100 batches, or rules never seen → `INSUFFICIENT EVIDENCE`, exit 3, never PASS; empty log → same; `--synthetic` coverage file lifts gate 5 only |
| PASS | only with ≥ 100 real batches, all ten rules seen, zero unsafe, valid summaries |
| Restarts / shutdown | boots are summed; shutdown summary neither lost nor duplicated |
| Privacy | no planted secret in the reviewer output |

Mutation check: disabling gate 1 in the reviewer makes the unsafe-mismatch test fail.

Reviewer usage on an exported Render log: `node backend/reviewSaveDiag.js render.log [--synthetic coverage.json] [--min-batches 100] [--json]` → exit 0 PASS, 2 FAIL, 3 INSUFFICIENT EVIDENCE.

## B. `backend/diagnosticsSynthetic.e2e.js` — real server, in-memory MongoDB
Starts a throw-away **in-memory MongoDB** (`mongodb-memory-server`, dev-only, **not** in `package.json`; it downloads a `mongod` binary on first use, so install it in a scratch folder) and the real `backend/server.js` with an explicit minimal environment (no `.env`, no inherited `MONGODB_URI`; refuses to run unless the URI is `mongodb://127.0.0.1…`).
```
cd backend
NODE_PATH="<backend>\node_modules;<scratch>\node_modules" node diagnosticsSynthetic.e2e.js [--write-coverage coverage.json]
```
(`;` separates paths on Windows, `:` elsewhere.) 32 checks, exit 0 = all pass:
1. **Observation (1–13):** 15 scripted saves give the expected outcome/reason/field names; a refused save logs nothing; no `MISMATCH-unsafe`.
2. **No behaviour change (14–17):** the same script with diagnostics ON and OFF yields identical HTTP replies and an identical final database; the password is still hashed; OFF logs nothing.
3. **Hygiene (18–20):** planted passwords/emails/names/phones/titles/ids never appear; lines ≤ 700; volume bounded.
4. **Totals and rules (21–23):** last summary complete; `batches` = applied saves; `batchOutcomes` adds up; each rule below has a count > 0 in the server's own summary.

| # | Rule (reason) | Scenario |
|---|---|---|
| 1 | `server-modified:qualityInspections` | member saves an inspection (approval derived, result forced) |
| 2 | `server-modified:workMeasurements` | member saves a work measurement |
| 3 | `server-modified:materialMeasurements` | member saves a material measurement |
| 4 | `users-password` | admin creates a user with a password |
| 5 | `project-delete-cascade` | admin deletes a project (floors/units/snags/progress counts) |
| 6 | `re-inspection-closed-record` | passing re-inspection closes the original's snag |
| 7 | `server-modified:drawingRequests` | anonymous drawing request |
| 8 | `server-modified:dpr` | anonymous DPR |
| 9 | `server-modified:formSubmissions` | anonymous form submission |
| 10 | `server-modified:teamDailyReports` | leader signs off a team report |

Mutation check: removing the `users-password` reason from `saveDiagnostics.js` makes checks 6 and 23 fail.

**Correction of an earlier statement:** the first scratch version of this script had 9 rule scenarios — it did **not** cover `materialMeasurements`. That scenario was added here.

## Limits
Proves the rules and the log pipeline on invented data. It says nothing about real traffic volume and does not replace the observation window (`save-diagnostics.md` §6b): synthetic coverage can satisfy gate 5 (rule coverage) only, never gate 4 (real batches).

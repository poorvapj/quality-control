# Public endpoints: `/api/photo` and `/api/state` — investigation, design and implementation status

## Implementation status (committed as `7495c30`, not deployed; both new behaviours are OFF by default)
| Piece | Where | Default | Switch |
|---|---|---|---|
| Token sent on every `/api/state` fetch and on all three `/api/photo` calls | `AppContext.tsx` (`fetchBoard`), `uploadPhoto.ts`, `useActions.ts` | on (harmless: the server ignores it until a flag is set) | — |
| Public allow-listed snapshot for callers without a valid session on `GET /api/state` **and** the `/api/ops` reply | `backend/publicState.js`, `sendStateResponse` | **OFF** | `PUBLIC_STATE_ENFORCE=1` |
| Client handling: re-fetch the full board after sign-in; expired-session detection (never lets the reduced snapshot replace a signed-in board; drops the stale token → sign-in screen); public pages never overwrite the cached board | `AppContext.tsx`, `shared/stateSync.ts`, `main.tsx` (`publicRoute`) | on | — |
| `/api/photo` guard: anonymous = type `dpr` only, images only, ≤ 8 MB decoded, ≤ 20 uploads / 10 min / IP, ≤ 300 / hour overall; Cloudinary `allowed_formats` + `anonymous-upload` tag; `Retry-After` on 429; early `Content-Length` 413 | `backend/photoGuard.js`, `/api/photo` | **monitor-only** (logs "would refuse", refuses nothing) | `PHOTO_GUARD_ENFORCE=1` |
| Signed-in callers | unchanged in every mode (any type, size, rate) | — | — |

**Why OFF by default:** frontends already in users' browsers fetch `/api/state` and `/api/photo` *without* a token. Turning enforcement on first would hand them the reduced snapshot (blank board) and make their uploads look anonymous (refused). **Rollout order:** (1) deploy backend (flags off) → (2) deploy frontend → (3) wait until old tabs have reloaded (JWTs last 7 days; tabs can stay open) and check the Render logs for `[photo] monitor-only, would refuse` lines — any such line from a signed-in user means a client is still old → (4) set `PHOTO_GUARD_ENFORCE=1`, then `PUBLIC_STATE_ENFORCE=1` (independent). **Rollback:** unset the variable and restart (no data or schema involved).
Optional tuning env: `CLIENT_IP_HOPS_FROM_RIGHT` (which `X-Forwarded-For` entry is the real client; unset = leftmost). **Not verified for Render** — if it is wrong the per-IP limit may be spoofable or may bucket everyone together; the global cap (300/hour) still bounds cost either way. Check what Render sends (log one request's `x-forwarded-for`) before relying on per-IP limits.

### Tested
- Unit: `photoGuard.test.js` (9). Server end-to-end (real `server.js`, in-memory MongoDB; Cloudinary absent so "passed the guard" = 502): 17 photo checks (enforce) + 4 (monitor-only); 15 public-state checks (flag on) + 2 (flag off).
- **Real browser (Edge driving the built frontend against the real server), flags ON:** anonymous `/dpr/new` renders from the snapshot and a full public DPR **with a photo submits and is saved**; the Cloudinary call receives `allowed_formats` + the anonymous tag; every `/api/state` body an anonymous browser received contained none of the seeded private values (emails, phones, snag titles); sign-in screen → sign-in fetches the full board → app renders; reload stays signed in; an **expired token** brings up the sign-in screen, clears the token and shows no private data; signing in again works; **mid-session expiry** brings up sign-in on the next poll without replacing the board; lost-reply retry creates no duplicate (see changelog). **Flags OFF:** sign-in, reload, public DPR with photo all behave as before and an anonymous visitor still receives the full board (unchanged until you flip the flag).
- **Not tested:** real Cloudinary, real Render proxy headers, mobile Safari/Chrome, offline-mode UI, a restricted-project user's post-login project default (code path reviewed only), the two public pages other than DPR in a browser (drawing request and custom form are covered at the data level by the allow-list; their browser flows were not driven).

### Remaining gaps / recommendations (not done)
- With the flag on, a user whose token expires while uploading an *internal* photo type gets a 401 from `/api/photo` (the photo is kept locally with the existing warning). Acceptable, but worth knowing.
- Server-assigned ids for public submissions (fixes the client-side `nextId` collision weakness) — behavior change, awaiting your decision.
- The app connects to MongoDB as **`atlasAdmin@admin`** (seen in the read-only probe). That is far broader than the app needs; a dedicated user with `readWrite` on the one database limits the blast radius of any future injection or leak. This is a configuration change in Atlas + the `MONGODB_URI` env var — **not done; needs your approval**.
- Photo cap values are initial safeguards as approved; revisit with real upload sizes (typical watermarked JPEGs here are ≤ 1280 px wide).

---
## Original investigation
**Status when written: investigation only.** Do not simply "require login" on either endpoint: that would break the current login screen and the public forms (details below).

## 1. Who calls what (traced in code)

### `POST /api/photo` (`server.js`, no session check; 16 MB body cap)
| Caller | Photo type | Signed in? | Sends token today? |
|---|---|---|---|
| `shared/uploadPhoto.ts` → ChecklistModal, PossessionForm, DrawingRequestDetailModal, CaseStudies, PhotoGroupUploader | qc / drawings / caseStudies / dpr | internal pages: yes; **PhotoGroupUploader is used by the public DPR form: no** | **No — no caller sends `Authorization`** |
| `hooks/useActions.ts` L232, L387 | snags / progress | yes | No |
The only **anonymous** legitimate use found is the public DPR form (`/dpr/new` → DprForm → PhotoGroupUploader, type `dpr`). The public drawing-request form and the public custom form have no upload call (grep). PDFs are accepted server-side only for `caseStudies` (internal).

### `GET /api/state` (no session check)
- **Every** state fetch in `AppContext.tsx` (L350-462: initial load, poll, offline recovery, post-reject resync) is sent **without** an `Authorization` header — including for signed-in internal users.
- The login screen itself depends on it: `AppProvider` downloads the board *before* login, and `validUser`/`loggedIn` are derived from `data.users` (AppContext ~L475-497). So "require a session on `/api/state`" would make the app unable to start for anyone.
- Public routes (`main.tsx`) wrap `/dpr/new`, `/drawing-requests/new`, `/forms/:id` in the same `AppProvider`, so they download the whole board too.
- **A second leak path:** `POST /api/ops` replies with the full board (`sendStateResponse`) — including to anonymous callers who just created a public DPR/drawing request/form submission. Gating only `GET /api/state` would leave this open.

## 2. What the public forms actually read from the board (verified)
| Public page | Data used | Fields needed |
|---|---|---|
| DPR (`DprForm`) | `projects` (active) | id, name, active |
| | `users` (role DRI/SUPERVISOR, active) | **name only** (dropdown value/label) |
| | `workTargets` for the chosen project | projectId, category, unit, plannedQty, active |
| | `vendors` + vendor pairs seen in `dpr` | vendorCode, vendorName |
| | `dpr` (all rows) | **ids** only, to compute the next `DPR-####` client-side (`nextId`) + vendorCode/vendorName pairs |
| Drawing request (`DrawingRequestForm`) | `projects` (active) | id, name, active; ticket number probably also derived client-side from existing `drawingRequests` ids (`nextId` is imported in `useDrawingRequestActions.ts`; not fully traced) |
| Custom form (`PublicCustomFormPage`/`CustomFormFill`) | `forms` (the one form) | id, name, fields, isPublic, active |
| | `formSubmissions` | **ids** only, for `nextId("SUB")` |
Everything else the anonymous caller receives today is unnecessary: users' emails/phones/Slack ids/projectIds, permissions, moduleGrants, all snags, inspections, measurements, POs, team reports, other people's form responses and DPR photos, audit events.

**Related existing weakness (verified):** because ids are computed client-side from a snapshot, two anonymous submitters can pick the same id; the server's `upsert` then either overwrites (first record lost, for ids it hasn't "existed" yet in the same instant) or rejects the second with 401 ("sign-in required" for an existing record). Server-assigned ids would remove this; that is a behavior change and needs your approval.

## 3. Proposed minimal public snapshot (design)
`GET /api/public/state` → `{ rev, data }` with **only**:
```
projects:   [{id, name, code?, active}]                 (active only)
users:      [{id, name, role, active}]                  (role DRI/SUPERVISOR only; no email/phone/slackId/projectIds/teamId)
workTargets:[{id, projectId, category, unit, plannedQty, active}]
vendors:    [{id, vendorCode, vendorName}]
dpr:        [{id, vendorCode, vendorName}]              (id + vendor pair only — no photos/entries)
drawingRequests: [{id, ticketNo}]                       (ids only)
forms:      [the public & active forms only]
formSubmissions: [{id}]                                 (ids only)
```
Allow-list (never deny-list): any collection/field not listed is never sent anonymously. `/api/ops` replies to anonymous callers with `{rev}` (plus this snapshot only if the client asks) instead of the full board. `/api/rev` is unchanged (a number, not sensitive).

## 4. Safe migration sequence (each step independently deployable; old clients keep working until the last)
1. **Client sends the token everywhere** (all `/api/state`, `/api/photo` fetches) — harmless today, prerequisite for gating.
2. **Add `GET /api/public/state`** (additive). Public routes switch to it (`AppProvider publicMode`). Anonymous `/api/ops` replies shrink to the public shape.
3. **Fix the login bootstrap**: derive the signed-in user from the token (`/api/me`, new) instead of `data.users`, and fetch the full board *after* login with the token.
4. **Gate**: `GET /api/state` and full-state `/api/ops` replies require a valid session; anonymous callers get the public snapshot (or 401 for the full endpoint). Rollout needs a version window: **keep `/api/state` open until the old frontend bundle is out of circulation** (Vercel deploys instantly but offline PWA-ish tabs/phones keep old JS until reload — the 7-day JWT lifetime suggests tabs stay open for days).
5. Optional: server-assigned DPR/ticket/submission ids.
Tests required at each step: public DPR / drawing request / custom-form submission end-to-end; login → board load; internal save; offline queue replay; `/api/state` anonymous returns no private fields (contract test over every field of the `users` record).

## 5. `/api/photo` — abuse protection design (does not break public DPR)
- **Signed-in** (valid JWT): unchanged — any type, same limits as today.
- **Anonymous**: allowed **only** for type `dpr`, images only (no PDF), smaller size cap (proposal 8 MB base64 — the watermarked JPEGs the app uploads should be well under; to be confirmed from real uploads), plus:
  - per-IP rate limit (proposal 20 uploads / 10 min; Render passes the client IP in `X-Forwarded-For` — first hop),
  - a global anonymous cap (proposal 300/hour) as a cost circuit-breaker, returning 429 with a clear message,
  - Cloudinary options on anonymous uploads: `tags: ["anon"]` (so orphans can be found and purged), `allowed_formats`, `max_file_size`.
- In-memory counters are per instance and reset on restart (same trade-off as the existing login lockout); acceptable as a cost-abuse brake, not as an auth boundary. With >1 instance the effective limit multiplies.
- Client change: `uploadPhoto.ts`/`useActions.ts` send the token when present. A failed anonymous upload already degrades gracefully (`localOnly` fallback).
- Residual risk: an attacker can still upload up to the caps as `dpr`. Stronger option if needed: a short-lived upload token issued with the public form page (needs a server round-trip + client change), or Cloudflare Turnstile/hCaptcha on the public DPR form.

## 6. Decisions needed
1. Approve steps 1–3 (additive, low risk) first?
2. Approve photo caps (8 MB / 20 per 10 min per IP / 300 per hour global) or give your own numbers?
3. Server-assigned ids for public submissions (fixes the id-collision weakness, changes behavior)?
4. Is a CAPTCHA acceptable on the public DPR form?

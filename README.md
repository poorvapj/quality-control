# Neoteric Tower Quality Release Board

Master-data-driven web app for stage-gated quality control, snag tracking and trade handoffs
on a residential tower. The API server keeps the shared board in MongoDB and evidence photos in
Cloudinary, so every phone on site (or off it) reads and writes **the same board**, live (5-second
sync).

## Layout

```
frontend/   index.html, app.js, vercel.json   — static, deploys to Vercel
backend/    server.js, seed.js, package.json, .env.example   — API, deploys to Render
```

## Run it locally

```
cd backend
cp .env.example .env    # fill in MONGODB_URI and CLOUDINARY_URL
npm install
node server.js              # http://localhost:5173, serving ../frontend
node server.js --port 8080  # pick another port
```

Node 18+. Requires a MongoDB connection string and a Cloudinary account — see
`backend/.env.example` for every variable. The server prints a `Network:` URL as well — open that
on a phone on the same Wi-Fi to reach the same server. On first run against an empty database it
seeds the demo dataset automatically. `server.js` serves the sibling `../frontend` folder as
static files, so this one command gives you the whole app for local/LAN use.

Opening `frontend/index.html` directly with `file://` (no server) still works, but falls back to
per-device `localStorage` and the header will say `THIS DEVICE ONLY`.

## Deploying — frontend on Vercel, backend on Render

**Backend (Render):**
1. New Web Service → point at this repo, **Root Directory: `backend`**.
2. Build command `npm install`, start command `node server.js`.
3. Set environment variables: `MONGODB_URI`, `MONGODB_DB`, `CLOUDINARY_URL`, and `ALLOWED_ORIGIN`
   (your Vercel URL, e.g. `https://your-app.vercel.app` — required for the browser to be allowed
   to call this API cross-origin). Render supplies `PORT` itself.
4. Deploy, then note the service URL, e.g. `https://tower-quality-board.onrender.com`.

**Frontend (Vercel):**
1. New Project → same repo, **Root Directory: `frontend`**. `frontend/vercel.json` already
   disables the install/build steps so Vercel just serves the static files as-is.
2. Edit the `window.API_BASE` line near the bottom of `frontend/index.html` to the Render URL
   from above, then push/redeploy.

Both pieces can also run from the same origin (skip the split, just run `node backend/server.js`
and open it directly) if you don't need separate hosting.

## Files

| File | Purpose |
| --- | --- |
| `backend/server.js` | HTTP server: static files locally + the JSON API, backed by MongoDB/Cloudinary. |
| `backend/seed.js` | Master-data definitions and the demo dataset. |
| `backend/.env.example` | Every environment variable the server needs. |
| `frontend/index.html` | Shell, styles, and the `API_BASE` backend-URL setting. |
| `frontend/app.js` | All client logic — rules engine, screens, CRUD. |
| `frontend/vercel.json` | Tells Vercel to serve this folder as static files, no build step. |

## Masters

Every screen is driven by master data, editable in-app under **Masters** (DRI role only).
The eight masters share one schema-driven table/form/CSV engine defined at the top of `app.js`.

- **Project Master** — sites. The active project scopes every other screen.
- **Floor Master** — floors, with the bottom-up casting sequence.
- **Unit Master** — flats, their floor, type and carpet area.
- **Stage Master** — the vocabulary of work: track (unit/floor), owning role, whether it is a
  QC gate and whether it is hidden work.
- **Quality Master** — inspection parameters: method, acceptance criteria, severity.
- **Quality Checklist** — parameters grouped per gate, with mandatory/photo-evidence flags.
- **Stage Mapping** — which stages run on a project, in what order, with which checklist and
  SLA. **This is what the board enforces** — reorder here and the workflow changes.
- **User Master** — everyone who can act, and their role.

## Demo dataset

`seed.js` generates a full working site on first run (or via `Masters ▸ Reload demo data`).
It is deterministic — reseeding gives byte-identical data — and is built so that **every one of
the 22 mapped stages carries live records**, in every state the board can render.

| | |
| --- | --- |
| Units / floors / users | 90 · 10 · 17 |
| Snags | 46 (22 open, 8 in progress, 16 closed, 6 critical) |
| Assignments | 42 (22 assigned, 11 accepted, 9 done, 11 overdue) |
| Stage progress records | 572 |
| Activity events | 121 |

The tower reads as a real site in mid-build: floors 1–8 cured, floor 9 mid-slab, floor 10 locked
behind it, and the 72 released flats spread down the trade sequence — 72 at masonry tapering to
10 at final handover, with 4 fully handed over.

Each rule has units deliberately parked against it, so nothing has to be staged by hand to demo:

- **10 slow handoffs** — released past SLA, never acknowledged (drives the dashboard panel).
- **12 hidden stages complete but unmeasured** — units sitting at Gate 1 / Gate 3 blocked by the
  hidden-work lock until the DET measures them.
- **26 units carrying open snags** — their gates are blocked until the snags close.
- **4 failed gates** in rework, plus units in released / acknowledged / in-progress states.

## Rules the board enforces

1. **Bottom-up casting** — a floor's structure track is locked until the floor below has cured.
2. **Structure release** — a flat's trades are locked until its own floor has cured.
3. **Predecessor** — a stage cannot start until its Stage Mapping predecessor is complete.
4. **Hidden-work lock** — rebar, sleeves, conduits, plumbing and waterproofing must be measured
   and photographed by the Measurement DET before the following QC gate can pass.
5. **Snag lock** — a QC gate cannot pass while an open snag exists at that stage or earlier.
6. **Handoff flow** — completing a stage releases the next one. The receiving role must
   Acknowledge → Start → Complete. Releases past their SLA show as **slow handoffs**.

## Quality gates and snags

Running a gate opens its checklist. Pass every line and the gate passes and releases the next
stage. Fail any line and the gate fails, and **each failed parameter becomes a snag**
automatically — titled from the parameter, severity inherited from Quality Master, assigned to
the owning trade, with a due date of 24h (Critical) or 72h (everything else).

Snags can also be raised by hand from any unit, filtered by status/severity/owner, reassigned,
photographed, and exported (`Masters ▸ Snag register CSV`).

## Assigning work

Assign from any stage in the unit/floor drawer, from the Team tab, or from a person's card.
Pick target, stage, person, due date and instruction. The assignee sees it under **My Work**
and moves it Assigned → Accepted → Done. **Team** shows workload and overdue counts per person.

## Photos

Photo capture uses the device camera via a file input, then shrinks the image to 1280px and
stamps unit, timestamp and user onto it before upload. The image never touches the frontend's
Cloudinary credentials — there aren't any; the base64 image goes to the backend, which holds the
one `CLOUDINARY_URL` secret and does the actual upload server-side via the official Cloudinary
Node SDK.

Every upload lands under `ProjectQuality/<type>` in your existing Cloudinary account — segregated
by what it's evidence of — and never touches any other folder (e.g. your VMS assets elsewhere in
the same account):

| Type | Cloudinary folder | Used for |
| --- | --- | --- |
| `snags` | `ProjectQuality/snags` | Snag/defect evidence photos |
| `progress` | `ProjectQuality/progress` | Hidden-work (rebar/plumbing/etc.) measurement evidence |
| `qc` | `ProjectQuality/qc` | Reserved for QC gate checklist evidence, once wired up |
| `drawings` | `ProjectQuality/drawings` | Reserved for drawing/GFC uploads, once that master exists |

`POST /api/photo` requires `type` to be one of the four above (400 otherwise) and returns both
`secure_url` and `public_id` from Cloudinary's response; both are stored on the record in MongoDB
— `{ url, publicId }` — so a photo can be looked up or deleted in Cloudinary by `publicId` later,
not just displayed by URL.

> Over plain HTTP on a LAN IP the browser will not treat the page as a secure context, so the
> live-camera and geolocation APIs are unavailable. The file-input capture used here still opens
> the native camera on phones, which is why it is built that way.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/rev` | Cheap poll — current revision number. |
| `GET /api/state` | Full snapshot `{rev, data}`. |
| `POST /api/ops` | Apply record-level ops, bump revision. |
| `POST /api/photo` | `{dataUrl, type}` → upload to `ProjectQuality/<type>`, return `{url, publicId}`. |
| `POST /api/reset` | `{mode:"demo"\|"blank"}` — reseed or wipe. |

Writes are small record-level ops (`upsert` / `delete` / `progress` / `event`) applied directly as
MongoDB updates, so two engineers editing different units never overwrite each other.
`null` in an upsert clears that field (`$unset`). Each master lives in its own MongoDB collection
(named after the `COLLECTIONS` list in `seed.js`); `progress` and `events` are their own
collections too, and a single `meta` document holds the revision counter every client polls.

## Known limits

- **Login is trust-based** — you pick your name from User Master; there is no password. Fine on a
  controlled site team, not enough if the board becomes a contractual record.
- **No conflict resolution within a single record** — two people editing the *same* unit-stage in
  the same second: last write wins.
- **No cross-collection transaction** — an ops batch that touches several collections applies
  them one at a time, not atomically as a whole. A crash mid-batch could leave a partial write;
  each op is still internally consistent.
- Take regular MongoDB backups (Atlas does this for you); there's no in-app export beyond CSV.

## Suggested next steps

- Per-stage cycle-time CSV (waiting vs working hours) — the `rel`/`ack`/`start`/`at` timestamps
  are already recorded on every stage, so this is a report, not a data change.
- Drawing register / GFC linkage as a proper master (currently a `dwg` text field on Stage).
- Wrap multi-collection ops batches in a MongoDB transaction (needs a replica-set cluster, which
  Atlas already is) for full batch atomicity.
- Push notifications on assignment and on snags going overdue.

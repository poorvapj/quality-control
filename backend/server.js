#!/usr/bin/env node
/*
 * Neoteric Tower Quality Board — API server.
 * Storage: MongoDB (Atlas). Photos: Cloudinary. Node 18+.
 *
 *   node server.js              # http://localhost:5173
 *   node server.js --port 8080
 *
 * Serves the sibling ../frontend folder as static files (handy for local dev,
 * so one `node server.js` gives you the whole app) AND exposes the shared
 * board state as a JSON API backed by MongoDB, so every device that points
 * at this server's URL reads and writes ONE board, live (5s poll).
 *
 * Required env (see .env.example):
 *   MONGODB_URI, MONGODB_DB, CLOUDINARY_URL, ALLOWED_ORIGIN, JWT_SECRET
 *
 * Cloudinary credentials are read ONLY from CLOUDINARY_URL (the SDK picks it
 * up automatically) — never split into separate cloud_name/key/secret vars.
 * Every upload lands under ProjectQuality/<type> in your Cloudinary account,
 * alongside (not touching) any existing VMS assets in other folders.
 *
 * API
 *   GET  /api/rev           -> {rev}                          cheap poll
 *   GET  /api/state         -> {rev, data}                     full snapshot (password hashes stripped)
 *   POST /api/login         -> {user} | 401                    email+password check (scrypt, server-side only)
 *   POST /api/ops           -> {rev, data}                     apply ops, bump rev
 *   POST /api/photo         -> {url, publicId}                 upload to Cloudinary
 *   POST /api/reset         -> {rev, data}                     reseed or blank
 *   POST /api/backups       -> {id, createdAt, ...}            create a backup now (admin)
 *   GET  /api/backups       -> {backups: [...]}                list backups, newest first (admin)
 *   GET  /api/backups/:id   -> {collections, progress}         one backup's data, passwords stripped (admin)
 *   POST /api/backups/:id/restore -> {rev, data}                overwrite the live board with a backup (admin)
 *   DELETE /api/backups/:id -> {ok}                              permanently remove a backup (admin)
 *   GET  /api/backup/scheduled    -> {id, createdAt, ...}       cron-triggered backup, no login — needs
 *                                                                X-Cron-Secret header matching BACKUP_CRON_SECRET
 *   POST /api/automation/drawing-requests/:id/decision -> {request}  approve/return/resubmit a drawing
 *                                                                request from an unattended caller (e.g. n8n
 *                                                                reacting to a Slack button click) — needs
 *                                                                X-Automation-Secret header matching
 *                                                                AUTOMATION_SECRET. Fires N8N_WEBHOOK_URL (if
 *                                                                set) on every real reviewStatus change, from
 *                                                                this route AND from a normal /api/ops upsert.
 */

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const cloudinary = require("cloudinary").v2;
const { seedData, blankData, COLLECTIONS } = require("./seed.js");

/* ------------------------------------------------------------- passwords
   Node's built-in scrypt is our own hashing scheme going forward. Plaintext
   passwords are NEVER stored or returned; only passwordHash/passwordSalt
   live in Mongo, and getState() strips both before any /api/state response
   leaves the server.

   legacyPasswordHash: a small number of imported users carry their real
   bcrypt hash from a previous system (their actual password was never
   known to us — bcrypt hashes can't be converted to scrypt directly). On
   their first successful login we verify against bcrypt, then transparently
   re-hash to scrypt and drop the legacy field, so every account converges
   on the same scheme within one login. */
const bcrypt = require("bcryptjs");

/* --------------------------------------------------------------- sessions
   Signed JWTs — stateless, so "who's admin" is a real server-verified
   claim (not a client-held convenience) that also survives a server
   restart/redeploy without forcing every signed-in user to log in again,
   unlike an in-memory session store.

   ADMIN_USER_ID names the one account whose token is trusted for
   admin-gated ops (deletes, and any write to the users collection) —
   matches the frontend's existing "U-ADMIN" convention.

   Tradeoff to know: a JWT can't be revoked before it expires — deactivating
   a user or changing their password doesn't invalidate a token they already
   hold. SESSION_TTL bounds how long that window can last. */
const jwt = require("jsonwebtoken");
const ADMIN_USER_ID = "U-ADMIN";
const SESSION_TTL = "7d";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not set — see .env.example. Refusing to start with no signing key.");
}
const JWT_SECRET = process.env.JWT_SECRET;

function issueSession(user) {
  return jwt.sign({ userId: user.id, isAdmin: user.id === ADMIN_USER_ID }, JWT_SECRET, { expiresIn: SESSION_TTL });
}

/* --------------------------------------------------- drawing-request review
   Stage transitions used to exist ONLY on the frontend (hooks/useDrawing
   RequestActions.ts) — the generic /api/ops upsert endpoint accepted any
   reviewStatus a client sent, with no server-side check that it was a real
   transition from the record's current stage. That's fine for a normal
   logged-in user (the UI only ever offers the valid next step), but it's not
   safe to expose to an unattended caller like an n8n workflow: a leaked or
   guessed AUTOMATION_SECRET should only ever be able to advance a ticket
   through its real state machine, never jump it anywhere.

   This map is the single source of truth for "what's a legal next stage" —
   both the generic ops path (assertOpAllowed, below) and the dedicated
   automation endpoint (performDrawingRequestDecision) check against it. */
const DRAWING_TRANSITIONS = {
  "stage-1-screen": ["stage-2-produce", "returned"],
  "stage-2-produce": ["stage-3-crosscheck"],
  "stage-3-crosscheck": ["stage-4-final-approve", "stage-2-produce"],
  "stage-4-final-approve": ["approved", "stage-2-produce"],
  returned: ["stage-1-screen"],
  approved: []
};

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const AUTOMATION_SECRET = process.env.AUTOMATION_SECRET || "";

// The only two collections the public, no-login submission forms write to —
// and only ever to CREATE a new ticket, never to edit one that already
// exists. Everything else through /api/ops (including a second write to an
// existing dpr/drawingRequests row) needs a real signed-in session.
const PUBLIC_CREATE_ONLY = ["dpr", "drawingRequests"];

// Collections that belong to one project — cascade-deleted when that
// project itself is deleted, so removing a project doesn't leave its
// floors/units/snags/etc. as orphaned records with a projectId that no
// longer resolves to anything.
const PROJECT_SCOPED_COLLECTIONS = ["floors", "units", "snags", "assignments", "dpr", "drawingRequests", "stagemap"];

/* Same constant-time comparison already used for password hashes
   (verifyPassword, below) — the cron/automation secret checks used to do a
   plain `!==`, which leaks timing information proportional to how many
   leading characters match. Low practical risk for a random 32+ byte
   secret, but there's no reason for the two secret-checking code paths in
   this file to have different security postures. */
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) {
    // Still do a comparison (against bufA itself) so a length mismatch
    // doesn't return measurably faster than a same-length mismatch.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/* Fire-and-forget notification to n8n on every real stage change — never
   blocks or fails the request that triggered it (a Slack outage or a
   misconfigured n8n instance must never stop someone from approving a
   drawing on the board itself). */
function notifyDrawingRequestStageChange(doc) {
  if (!N8N_WEBHOOK_URL) return;
  fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: doc.id,
      ticketNo: doc.ticketNo,
      projectName: doc.projectName,
      description: doc.description,
      reviewStatus: doc.reviewStatus,
      priority: doc.priority || doc.requestedPriority || null,
      requesterName: doc.requesterName,
      assignedTo: doc.assignedTo || null,
      lastHistoryEntry: doc.reviewHistory?.[doc.reviewHistory.length - 1] || null
    })
  }).catch((e) => console.error("n8n webhook notify failed:", e.message));
}

function getSession(req) {
  const header = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return null;
  try {
    return jwt.verify(m[1], JWT_SECRET);
  } catch {
    return null; // expired, tampered, or malformed — all treated as unauthenticated
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}
function verifyPassword(password, salt, hash) {
  const candidate = hashPassword(password, salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* -------------------------------------------------------- login lockout
   /api/login had no rate-limiting at all — an attacker could script
   unlimited password guesses against any known email. In-memory (not
   Mongo-backed) is a deliberate tradeoff: a server restart resets everyone's
   lockout, which is fine for what this defends against (a live brute-force
   burst), and avoids adding load to the DB on every single login attempt,
   successful or not. Keyed by email, not IP, since the login form itself
   already tells an attacker which email to target — IP-based limiting would
   also punish everyone behind a shared office/NAT IP for one person's typo. */
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MS = 60 * 1000;
const loginAttempts = new Map(); // email -> { count, lockedUntil }

function loginLockoutRemaining(email) {
  const entry = loginAttempts.get(email);
  if (!entry || !entry.lockedUntil) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}
function recordFailedLogin(email) {
  const entry = loginAttempts.get(email) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_LOCKOUT_THRESHOLD) {
    entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    entry.count = 0;
  }
  loginAttempts.set(email, entry);
}
function clearLoginAttempts(email) {
  loginAttempts.delete(email);
}

const ROOT = __dirname;
// frontend/ is now a React+TS app requiring a build step (npm run build);
// serve the compiled output so `node server.js` alone still works locally
// after a build, same as it did for the old build-free vanilla app.
const STATIC_ROOT = path.join(ROOT, "..", "frontend", "dist");
const MAX_BODY = 16 * 1024 * 1024; // 16MB — photo uploads
const MAX_EVENTS = 5000;

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
let PORT = portArg !== -1 ? parseInt(args[portArg + 1], 10) : parseInt(process.env.PORT, 10);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) PORT = 5173;

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Cloudinary's SDK auto-configures from CLOUDINARY_URL — no explicit .config() call.
// This is intentionally the only credential source (never split into separate vars).
if (!process.env.CLOUDINARY_URL) {
  console.warn("  ! CLOUDINARY_URL is not set — photo uploads will fail.");
}

// Every Project Quality asset lives under this root, segregated by type, so it
// never collides with — or needs to touch — existing VMS assets in the same account.
const CLOUDINARY_ROOT = "ProjectQuality";
const PHOTO_TYPES = ["snags", "qc", "progress", "drawings", "dpr"];

/* ---------------------------------------------------------------- storage */

let mongoDb = null;
let mongoClient = null; // kept module-level (not just local to connectMongo) so
// resetDb/restoreBackup can open a session and run their multi-collection
// replace as one transaction instead of an all-or-nothing-in-theory-only loop.

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");
  const client = new MongoClient(uri);
  await client.connect();
  mongoClient = client;
  mongoDb = client.db(process.env.MONGODB_DB || undefined);

  for (const c of COLLECTIONS) {
    await mongoDb.collection(c).createIndex({ id: 1 }, { unique: true });
  }
  await mongoDb.collection("events").createIndex({ ts: -1 });
  // sparse: users created before email-based login existed (or without an
  // email) don't collide with each other on a shared "" value.
  await mongoDb.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true });
  await mongoDb.collection("backups").createIndex({ id: 1 }, { unique: true });
  await mongoDb.collection("backups").createIndex({ createdAt: -1 });

  const projectCount = await mongoDb.collection("projects").countDocuments();
  if (projectCount === 0) {
    console.log("  no data found — starting with an empty board (use /api/reset to seed demo data if needed)");
  }

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      try {
        await client.close();
      } catch {}
      process.exit(0);
    });
  }
}

async function bumpRev() {
  await mongoDb.collection("meta").updateOne({ _id: "rev" }, { $inc: { value: 1 } }, { upsert: true });
  const doc = await mongoDb.collection("meta").findOne({ _id: "rev" });
  return doc.value;
}

async function getRev() {
  const doc = await mongoDb.collection("meta").findOne({ _id: "rev" });
  return doc ? doc.value : 0;
}

async function getState() {
  const data = {};
  for (const c of COLLECTIONS) {
    data[c] = await mongoDb.collection(c).find({}, { projection: { _id: 0 } }).toArray();
  }
  // Password hashes must never leave the server, even to an authenticated
  // browser — /api/state is otherwise a full generic dump of every collection.
  if (data.users) {
    data.users = data.users.map((u) => {
      const { passwordHash, passwordSalt, legacyPasswordHash, ...rest } = u;
      return rest;
    });
  }
  const progressDocs = await mongoDb.collection("progress").find({}).toArray();
  data.progress = {};
  for (const p of progressDocs) {
    const { _id, ...rest } = p;
    data.progress[_id] = rest;
  }
  data.events = await mongoDb
    .collection("events")
    .find({}, { projection: { _id: 0 } })
    .sort({ ts: -1 })
    .limit(MAX_EVENTS)
    .toArray();
  const rev = await getRev();
  return { rev, data };
}

/*
 * Ops are small, record-level and idempotent, so two engineers editing
 * different units never clobber each other (last-write-wins per record only).
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSetUnset(fields) {
  const set = {}, unset = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) unset[k] = "";
    else set[k] = v;
  }
  return { set, unset };
}

/* Deletes, and any write to the `users` collection (Masters ▸ User Master
   is Admin-only, everything else in Masters is open to every signed-in
   board member), need a real logged-in admin session.

   Anonymous access is intentionally narrow — ONLY creating a brand-new
   dpr/drawingRequests record (what the public no-login submission forms
   do) is allowed with no session. Every other write — progress ops, event
   log inserts, upserts to any other collection, and editing an EXISTING
   dpr/drawingRequests row — needs a real signed-in session (any role, not
   necessarily admin). Previously only `delete` and `users`-upsert were
   gated at all, which left the entire rest of the data model (QC stage
   progress, snags, assignments, projects, …) writable by anyone who could
   reach this endpoint, logged in or not.

   Bootstrap exception: if the users collection is genuinely empty (fresh
   board, or recovering from a reset), the very first user upsert is let
   through unauthenticated — otherwise nobody could ever create the first
   admin account to log in and authorize anything else. Throws a tagged
   error so the route handler can turn it into a clean 401/403. */
async function assertOpAllowed(op, session) {
  const needsAdmin = op.op === "delete" || (op.op === "upsert" && op.coll === "users");
  if (needsAdmin) {
    if (op.op === "upsert" && op.coll === "users") {
      const userCount = await mongoDb.collection("users").countDocuments();
      if (userCount === 0) return;
    }
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    if (!session.isAdmin) { const e = new Error("Admin access required"); e.status = 403; throw e; }
    return;
  }

  if (op.op === "upsert" && op.coll === "drawingRequests" && op.rec && op.rec.id) {
    const existing = await mongoDb.collection("drawingRequests").findOne({ id: op.rec.id });
    // Editing a ticket that already exists is never anonymous, regardless
    // of which fields are being changed — closes the gap where a client
    // could set priority/planningVerified/projectAcknowledged/assignedTo
    // etc. on an existing ticket without ever touching reviewStatus (the
    // only field the old check looked at).
    if (existing && !session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    if (op.rec.reviewStatus) {
      const from = existing ? existing.reviewStatus : "stage-1-screen";
      if (op.rec.reviewStatus !== from) {
        const allowed = DRAWING_TRANSITIONS[from] || [];
        if (!allowed.includes(op.rec.reviewStatus)) {
          const e = new Error(`Invalid drawing request transition: ${from} -> ${op.rec.reviewStatus}`);
          e.status = 400;
          throw e;
        }
      }
    }
    return;
  }

  if (op.op === "upsert" && op.coll === "dpr" && op.rec && op.rec.id) {
    const existing = await mongoDb.collection("dpr").findOne({ id: op.rec.id });
    if (existing && !session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    return;
  }

  if (op.op === "upsert" && !PUBLIC_CREATE_ONLY.includes(op.coll)) {
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    return;
  }

  if (op.op === "progress" || op.op === "event") {
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
  }
}

async function applyOps(ops, session) {
  // Validate the ENTIRE batch before writing anything — otherwise an
  // allowed op earlier in the array would already be persisted to Mongo by
  // the time a later, disallowed op in the same batch throws and aborts.
  for (const op of ops || []) {
    if (!op || typeof op !== "object") continue;
    await assertOpAllowed(op, session);
  }

  for (const op of ops || []) {
    if (!op || typeof op !== "object") continue;

    if (op.op === "upsert" && COLLECTIONS.includes(op.coll) && op.rec && op.rec.id) {
      const rec = Object.assign({}, op.rec);
      // A plaintext "password" field on a users upsert (e.g. set via Masters
      // ▸ User Master) is hashed here and never stored/echoed back raw.
      if (op.coll === "users" && typeof rec.password === "string" && rec.password) {
        const salt = crypto.randomBytes(16).toString("hex");
        rec.passwordHash = hashPassword(rec.password, salt);
        rec.passwordSalt = salt;
      }
      delete rec.password;
      const { set, unset } = splitSetUnset(rec);
      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;

      if (op.coll === "drawingRequests" && rec.reviewStatus) {
        // Compare-and-swap on the stage the client thought it was
        // transitioning FROM, instead of a plain updateOne — two concurrent
        // approvals reading the same "current stage" used to both pass
        // assertOpAllowed's check and then both write, silently losing one
        // transition to last-write-wins. filter.reviewStatus below makes
        // the second writer's update simply match nothing instead.
        const existing = await mongoDb.collection("drawingRequests").findOne({ id: op.rec.id }, { projection: { reviewStatus: 1 } });
        const from = existing ? existing.reviewStatus : undefined;
        const filter = existing ? { id: op.rec.id, reviewStatus: from } : { id: op.rec.id };
        const result = await mongoDb.collection(op.coll).updateOne(filter, update, { upsert: !existing });
        if (existing && result.matchedCount === 0) {
          const e = new Error(`${op.rec.id} was already moved to a different stage by someone else — reload and retry`);
          e.status = 409;
          throw e;
        }
        if (rec.reviewStatus !== from) {
          const saved = await mongoDb.collection("drawingRequests").findOne({ id: op.rec.id }, { projection: { _id: 0 } });
          if (saved) notifyDrawingRequestStageChange(saved);
        }
      } else {
        await mongoDb.collection(op.coll).updateOne({ id: op.rec.id }, update, { upsert: true });
      }
    } else if (op.op === "delete" && COLLECTIONS.includes(op.coll) && op.id) {
      if (op.coll === "projects") {
        // Project delete + its full cascade (scoped collections, plus the
        // progress records keyed by the floor/unit ids it owns) is one
        // transaction — a crash halfway used to leave the project gone but
        // some of its floors/units/snags/progress still behind, or vice
        // versa, rather than either all-gone or all-untouched.
        await withOptionalTransaction(async (session) => {
          const floorIds = (await mongoDb.collection("floors").find({ projectId: op.id }, { projection: { id: 1 }, session }).toArray()).map((f) => f.id);
          const unitIds = (await mongoDb.collection("units").find({ projectId: op.id }, { projection: { id: 1 }, session }).toArray()).map((u) => u.id);
          await mongoDb.collection(op.coll).deleteOne({ id: op.id }, { session });
          // A deleted project would otherwise leave its floors/units/snags/
          // assignments/dpr/drawingRequests/stagemap rows behind with a
          // projectId that no longer resolves to anything — every page that
          // joins on projectId assumes it always does.
          for (const c of PROJECT_SCOPED_COLLECTIONS) {
            await mongoDb.collection(c).deleteMany({ projectId: op.id }, { session });
          }
          // progress documents are keyed `${targetId}::${stageId}` (see
          // frontend shared/rules.ts's pkey) — projectId isn't one of their
          // own fields, so they're only reachable via the floor/unit ids
          // gathered above, before those rows were deleted.
          const targetIds = [...floorIds, ...unitIds];
          if (targetIds.length) {
            const pattern = "^(" + targetIds.map(escapeRegExp).join("|") + ")::";
            await mongoDb.collection("progress").deleteMany({ _id: { $regex: pattern } }, { session });
          }
        });
      } else {
        await mongoDb.collection(op.coll).deleteOne({ id: op.id });
      }
    } else if (op.op === "progress" && op.key && op.patch) {
      const { set, unset } = splitSetUnset(op.patch);
      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      await mongoDb.collection("progress").updateOne({ _id: op.key }, update, { upsert: true });
    } else if (op.op === "event" && op.ev) {
      await mongoDb.collection("events").insertOne(Object.assign({}, op.ev));
    }
  }
  await trimEvents();
  return bumpRev();
}

/* Server-side counterpart to hooks/useDrawingRequestActions.ts, used only by
   the /api/automation/drawing-requests/:id/decision route below — an
   unattended caller (n8n, after a Slack button click) has no user session to
   drive the normal /api/ops path with, and needs its transitions validated
   here rather than trusted from the client. Mirrors the same 4 real actions
   the frontend offers; "resubmit" is the one action available from
   "returned" instead of a stage-scoped approve/return. */
const DRAWING_PRIORITIES = ["low", "medium", "high", "urgent"];

async function performDrawingRequestDecision(id, action, opts, actorName) {
  const dr = await mongoDb.collection("drawingRequests").findOne({ id });
  if (!dr) { const e = new Error("Drawing request not found"); e.status = 404; throw e; }
  if (opts.priority && !DRAWING_PRIORITIES.includes(opts.priority)) {
    const e = new Error(`priority must be one of: ${DRAWING_PRIORITIES.join(", ")}`);
    e.status = 400;
    throw e;
  }

  const historyEntry = (stage, historyAction, remarks) => ({
    stage, action: historyAction, remarks: remarks || "", by: null, byName: actorName || "Automation (n8n)", at: Date.now()
  });

  let patch;
  if (dr.reviewStatus === "stage-1-screen" && action === "approve") {
    patch = {
      reviewStatus: "stage-2-produce", assignedTo: opts.assignedTo || null, committedDate: opts.committedDate || null,
      reviewHistory: [...dr.reviewHistory, historyEntry("stage-1-screen", "forwarded", opts.remarks)]
    };
  } else if (dr.reviewStatus === "stage-1-screen" && action === "return") {
    patch = { reviewStatus: "returned", reviewHistory: [...dr.reviewHistory, historyEntry("stage-1-screen", "returned", opts.remarks)] };
  } else if (dr.reviewStatus === "stage-3-crosscheck" && action === "approve") {
    patch = { reviewStatus: "stage-4-final-approve", reviewHistory: [...dr.reviewHistory, historyEntry("stage-3-crosscheck", "forwarded", opts.remarks)] };
  } else if (dr.reviewStatus === "stage-3-crosscheck" && action === "return") {
    patch = { reviewStatus: "stage-2-produce", reviewHistory: [...dr.reviewHistory, historyEntry("stage-3-crosscheck", "returned", opts.remarks)] };
  } else if (dr.reviewStatus === "stage-4-final-approve" && action === "approve") {
    patch = {
      reviewStatus: "approved", priority: opts.priority || "",
      reviewHistory: [...dr.reviewHistory, historyEntry("stage-4-final-approve", "approved", opts.remarks)]
    };
  } else if (dr.reviewStatus === "stage-4-final-approve" && action === "return") {
    patch = { reviewStatus: "stage-2-produce", reviewHistory: [...dr.reviewHistory, historyEntry("stage-4-final-approve", "returned", opts.remarks)] };
  } else if (dr.reviewStatus === "returned" && action === "resubmit") {
    patch = { reviewStatus: "stage-1-screen", reviewHistory: [...dr.reviewHistory, historyEntry("returned", "resubmitted", opts.remarks)] };
  } else {
    const e = new Error(`"${action}" isn't a valid action from stage "${dr.reviewStatus}"`);
    e.status = 400;
    throw e;
  }

  // Re-checked against the same table the generic /api/ops path uses, so
  // this function can never grant a transition assertOpAllowed wouldn't.
  const allowed = DRAWING_TRANSITIONS[dr.reviewStatus] || [];
  if (!allowed.includes(patch.reviewStatus)) {
    const e = new Error(`Invalid drawing request transition: ${dr.reviewStatus} -> ${patch.reviewStatus}`);
    e.status = 400;
    throw e;
  }

  // Compare-and-swap on the stage read at the top of this function — closes
  // the same race the generic /api/ops path guards against (two callers
  // deciding on the same ticket at once shouldn't silently let the second
  // one overwrite the first's transition).
  const result = await mongoDb.collection("drawingRequests").updateOne({ id, reviewStatus: dr.reviewStatus }, { $set: patch });
  if (result.matchedCount === 0) {
    const e = new Error(`${id} was already moved to a different stage by someone else — reload and retry`);
    e.status = 409;
    throw e;
  }
  await bumpRev();
  const saved = await mongoDb.collection("drawingRequests").findOne({ id }, { projection: { _id: 0 } });
  notifyDrawingRequestStageChange(saved);
  return saved;
}

async function trimEvents() {
  const count = await mongoDb.collection("events").countDocuments();
  if (count <= MAX_EVENTS) return;
  const excess = count - MAX_EVENTS;
  const oldest = await mongoDb
    .collection("events")
    .find({}, { projection: { _id: 1 } })
    .sort({ ts: 1 })
    .limit(excess)
    .toArray();
  if (oldest.length) await mongoDb.collection("events").deleteMany({ _id: { $in: oldest.map((o) => o._id) } });
}

/* Wraps a multi-collection delete+insert (resetDb, restoreBackup) in a real
   Mongo transaction — previously a crash or dropped connection partway
   through the collection loop left the board in a half-wiped, half-restored
   state with no way back (exactly the scenario the whole Backups feature
   exists to protect against, undermined by its own restore path not being
   atomic). Atlas is always a replica set, so transactions are available;
   falls back to running `work` without one only if the driver reports
   transactions aren't supported (e.g. a standalone mongod in local dev),
   rather than hard-failing reset/restore entirely in that case. */
async function withOptionalTransaction(work) {
  const session = mongoClient.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (e) {
    if (/Transaction numbers are only allowed|IllegalOperation/i.test(e.message || "")) {
      console.warn("  ! Mongo transactions unsupported on this deployment — falling back to non-atomic writes:", e.message);
      return work(null);
    }
    throw e;
  } finally {
    await session.endSession();
  }
}

async function resetDb(mode, actorUserId) {
  const seed = mode === "blank" ? blankData() : seedData();
  return withOptionalTransaction(async (session) => {
    for (const c of COLLECTIONS) {
      await mongoDb.collection(c).deleteMany({}, { session });
      if (seed[c].length) await mongoDb.collection(c).insertMany(seed[c], { session });
    }
    await mongoDb.collection("progress").deleteMany({}, { session });
    const progressEntries = Object.entries(seed.progress || {});
    if (progressEntries.length) {
      await mongoDb.collection("progress").insertMany(progressEntries.map(([key, patch]) => Object.assign({ _id: key }, patch)), { session });
    }
    await mongoDb.collection("events").deleteMany({}, { session });
    if ((seed.events || []).length) await mongoDb.collection("events").insertMany(seed.events, { session });

    const rev = (await getRev()) + 1;
    await mongoDb.collection("meta").updateOne({ _id: "rev" }, { $set: { value: rev } }, { upsert: true, session });
    // Recorded AFTER the seed events above are inserted (that insert wipes
    // the whole events collection first) — a reset/restore wiping the
    // board with no trace of who did it, or when, was the exact forensic
    // gap that made past accidental resets so hard to piece together.
    await mongoDb.collection("events").insertOne(
      { ts: Date.now(), userId: actorUserId || "", action: "RESET_DB", targetId: mode, stageId: "", detail: `Board reset (${mode})` },
      { session }
    );
    return rev;
  });
}

/* ----------------------------------------------------------------- backups
   A `backups` document is a full point-in-time copy of every real
   collection's raw documents — including passwordHash/passwordSalt, so a
   restore brings logins back working too. Kept in Mongo only; never sent to
   a browser in that raw form (list/download strip password fields, same as
   getState()). This exists because a demo-reset or bad op has genuinely
   wiped this shared board multiple times this session with no way back. */
async function createBackup(createdBy) {
  const collections = {};
  for (const c of COLLECTIONS) {
    collections[c] = await mongoDb.collection(c).find({}, { projection: { _id: 0 } }).toArray();
  }
  const progressDocs = await mongoDb.collection("progress").find({}).toArray();
  const progress = {};
  for (const p of progressDocs) { const { _id, ...rest } = p; progress[_id] = rest; }

  const doc = {
    id: "BK-" + Date.now().toString(36).toUpperCase(),
    createdAt: Date.now(),
    createdBy: createdBy || null,
    collections,
    progress
  };
  await mongoDb.collection("backups").insertOne(doc);
  return doc;
}

function summarizeBackup(doc) {
  const counts = {};
  for (const c of Object.keys(doc.collections || {})) counts[c] = doc.collections[c].length;
  return { id: doc.id, createdAt: doc.createdAt, createdBy: doc.createdBy, counts };
}

function stripBackupPasswords(doc) {
  const collections = Object.assign({}, doc.collections);
  if (collections.users) {
    collections.users = collections.users.map((u) => {
      const { passwordHash, passwordSalt, legacyPasswordHash, ...rest } = u;
      return rest;
    });
  }
  return Object.assign({}, doc, { collections });
}

async function restoreBackup(id, actorUserId) {
  const doc = await mongoDb.collection("backups").findOne({ id });
  if (!doc) { const e = new Error("Backup not found"); e.status = 404; throw e; }
  return withOptionalTransaction(async (session) => {
    for (const c of COLLECTIONS) {
      await mongoDb.collection(c).deleteMany({}, { session });
      const rows = doc.collections[c] || [];
      if (rows.length) await mongoDb.collection(c).insertMany(rows, { session });
    }
    await mongoDb.collection("progress").deleteMany({}, { session });
    const progressEntries = Object.entries(doc.progress || {});
    if (progressEntries.length) {
      await mongoDb.collection("progress").insertMany(progressEntries.map(([key, patch]) => Object.assign({ _id: key }, patch)), { session });
    }
    const rev = (await getRev()) + 1;
    await mongoDb.collection("meta").updateOne({ _id: "rev" }, { $set: { value: rev } }, { upsert: true, session });
    // "events" isn't in COLLECTIONS (it's managed separately from the rest
    // of the board), so the loop above never touches it — this insert
    // survives the restore, recording who restored which backup and when.
    await mongoDb.collection("events").insertOne(
      { ts: Date.now(), userId: actorUserId || "", action: "RESTORE_BACKUP", targetId: id, stageId: "", detail: `Restored backup ${id}` },
      { session }
    );
    return rev;
  });
}

/* ------------------------------------------------------------------ http */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, code, msg) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(msg);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, urlPath) {
  if (req.method === "GET" && urlPath === "/api/rev") {
    return sendJson(res, 200, { rev: await getRev() });
  }
  if (req.method === "GET" && urlPath === "/api/state") {
    const state = await getState();
    return sendJson(res, 200, state);
  }
  if (req.method === "POST" && urlPath === "/api/login") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return sendJson(res, 400, { error: "Email and password are required" });

    const lockedFor = loginLockoutRemaining(email);
    if (lockedFor > 0) {
      return sendJson(res, 429, { error: `Too many failed attempts — try again in ${Math.ceil(lockedFor / 1000)}s` });
    }

    const user = await mongoDb.collection("users").findOne({ email: new RegExp("^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
    if (!user) { recordFailedLogin(email); return sendJson(res, 401, { error: "Invalid email or password" }); }
    if (user.active === false) return sendJson(res, 401, { error: "This account is inactive" });

    if (user.passwordHash && user.passwordSalt) {
      if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        recordFailedLogin(email);
        return sendJson(res, 401, { error: "Invalid email or password" });
      }
    } else if (user.legacyPasswordHash) {
      if (!bcrypt.compareSync(password, user.legacyPasswordHash)) {
        recordFailedLogin(email);
        return sendJson(res, 401, { error: "Invalid email or password" });
      }
      // First successful login on a legacy account — migrate to our own
      // scrypt hash and drop the bcrypt one, so this branch never runs again.
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = hashPassword(password, salt);
      await mongoDb.collection("users").updateOne(
        { id: user.id },
        { $set: { passwordHash, passwordSalt: salt }, $unset: { legacyPasswordHash: "" } }
      );
    } else {
      recordFailedLogin(email);
      return sendJson(res, 401, { error: "Invalid email or password" });
    }

    clearLoginAttempts(email);
    const { _id, passwordHash, passwordSalt, legacyPasswordHash, ...safeUser } = user;
    const token = issueSession(user);
    return sendJson(res, 200, { user: safeUser, token });
  }
  if (req.method === "POST" && urlPath === "/api/ops") {
    const body = await readBody(req);
    if (!Array.isArray(body.ops)) return sendJson(res, 400, { error: "ops[] required" });
    try {
      await applyOps(body.ops, getSession(req));
    } catch (e) {
      if (e.status) return sendJson(res, e.status, { error: e.message });
      throw e;
    }
    const state = await getState();
    return sendJson(res, 200, state);
  }
  const automationDecisionMatch = /^\/api\/automation\/drawing-requests\/([^/]+)\/decision$/.exec(urlPath);
  if (req.method === "POST" && automationDecisionMatch) {
    // No user session — this is for an unattended caller (an n8n workflow
    // reacting to a Slack button click), authorized via a shared secret
    // header instead, same pattern as /api/backup/scheduled.
    if (!AUTOMATION_SECRET) return sendJson(res, 501, { error: "AUTOMATION_SECRET is not configured" });
    if (!timingSafeStringEqual(req.headers["x-automation-secret"], AUTOMATION_SECRET)) return sendJson(res, 401, { error: "Invalid automation secret" });
    const body = await readBody(req);
    if (!["approve", "return", "resubmit"].includes(body.action)) {
      return sendJson(res, 400, { error: "action must be one of: approve, return, resubmit" });
    }
    try {
      const saved = await performDrawingRequestDecision(automationDecisionMatch[1], body.action, {
        remarks: body.remarks, assignedTo: body.assignedTo, committedDate: body.committedDate, priority: body.priority
      }, body.actorName);
      return sendJson(res, 200, { request: saved });
    } catch (e) {
      if (e.status) return sendJson(res, e.status, { error: e.message });
      throw e;
    }
  }
  if (req.method === "POST" && urlPath === "/api/photo") {
    const body = await readBody(req);
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || "");
    if (!m) return sendJson(res, 400, { error: "dataUrl must be a base64 png/jpeg/webp" });
    if (!PHOTO_TYPES.includes(body.type)) {
      return sendJson(res, 400, { error: "type must be one of: " + PHOTO_TYPES.join(", ") });
    }
    try {
      const result = await cloudinary.uploader.upload(body.dataUrl, {
        folder: CLOUDINARY_ROOT + "/" + body.type,
        resource_type: "image"
      });
      return sendJson(res, 200, { url: result.secure_url, publicId: result.public_id });
    } catch (e) {
      return sendJson(res, 502, { error: "Photo upload failed: " + e.message });
    }
  }
  if (req.method === "POST" && urlPath === "/api/reset") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const body = await readBody(req);
    await resetDb(body.mode === "blank" ? "blank" : "demo", session.userId);
    const state = await getState();
    return sendJson(res, 200, state);
  }
  if (req.method === "POST" && urlPath === "/api/backups") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const doc = await createBackup(session.userId);
    return sendJson(res, 200, summarizeBackup(doc));
  }
  if (req.method === "GET" && urlPath === "/api/backups") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const docs = await mongoDb.collection("backups").find({}).sort({ createdAt: -1 }).toArray();
    return sendJson(res, 200, { backups: docs.map(summarizeBackup) });
  }
  const backupIdMatch = /^\/api\/backups\/([^/]+)$/.exec(urlPath);
  if (req.method === "GET" && backupIdMatch) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const doc = await mongoDb.collection("backups").findOne({ id: backupIdMatch[1] });
    if (!doc) return sendJson(res, 404, { error: "Backup not found" });
    const { _id, ...safe } = stripBackupPasswords(doc);
    return sendJson(res, 200, safe);
  }
  const restoreMatch = /^\/api\/backups\/([^/]+)\/restore$/.exec(urlPath);
  if (req.method === "POST" && restoreMatch) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    try {
      await restoreBackup(restoreMatch[1], session.userId);
    } catch (e) {
      if (e.status) return sendJson(res, e.status, { error: e.message });
      throw e;
    }
    const state = await getState();
    return sendJson(res, 200, state);
  }
  if (req.method === "DELETE" && backupIdMatch) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const result = await mongoDb.collection("backups").deleteOne({ id: backupIdMatch[1] });
    if (result.deletedCount === 0) return sendJson(res, 404, { error: "Backup not found" });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "GET" && urlPath === "/api/backup/scheduled") {
    // No login required — this is for an external cron pinger (Render's
    // free tier sleeps, so an in-process setInterval can't be relied on).
    // Authorized via a shared secret header instead of a user session.
    const secret = process.env.BACKUP_CRON_SECRET;
    if (!secret) return sendJson(res, 501, { error: "BACKUP_CRON_SECRET is not configured" });
    if (!timingSafeStringEqual(req.headers["x-cron-secret"], secret)) return sendJson(res, 401, { error: "Invalid cron secret" });
    const doc = await createBackup("scheduled");
    return sendJson(res, 200, summarizeBackup(doc));
  }
  return sendJson(res, 404, { error: "Unknown endpoint " + urlPath });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (ALLOWED_ORIGIN !== "*") res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return sendText(res, 400, "Bad request");
  }

  if (urlPath.startsWith("/api/")) {
    try {
      return await handleApi(req, res, urlPath);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(STATIC_ROOT, urlPath);
  if (!filePath.startsWith(STATIC_ROOT + path.sep)) return sendText(res, 403, "Forbidden");

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: a path with no file extension (e.g. /dpr/new, one of
      // the public no-login routes) is a client-side route, not a missing
      // file — serve index.html so React can render it, same as vercel.json's
      // rewrite for production.
      if (!path.extname(urlPath)) {
        const indexPath = path.join(STATIC_ROOT, "index.html");
        return fs.stat(indexPath, (err2, stat2) => {
          if (err2 || !stat2.isFile()) return sendText(res, 404, "Not found: " + urlPath);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": stat2.size, "Cache-Control": "no-store" });
          fs.createReadStream(indexPath).pipe(res);
        });
      }
      return sendText(res, 404, "Not found: " + urlPath);
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) if (net.family === "IPv4" && !net.internal) out.push(net.address);
  }
  return out;
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: node server.js --port ${PORT + 1}`);
    process.exit(1);
  }
  throw err;
});

// Surface the full error for any crash that would otherwise exit silently
// (e.g. an unhandled rejection from a driver internal that isn't routed
// through connectMongo()'s own .catch below).
process.on("unhandledRejection", (err) => {
  console.error("  ! unhandled rejection:", err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("  ! uncaught exception:", err && err.stack ? err.stack : err);
  process.exit(1);
});

console.log(`\n  Neoteric Tower Quality Board`);
connectMongo()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`\n  Local:   http://localhost:${PORT}`);
      for (const ip of lanAddresses()) console.log(`  Network: http://${ip}:${PORT}`);
      console.log(`\n  Shared store: MongoDB   ·   Ctrl+C to stop.\n`);
    });
  })
  .catch((e) => {
    console.error("  ! failed to connect to MongoDB:", e && e.stack ? e.stack : e);
    process.exit(1);
  });

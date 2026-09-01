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
 *   MONGODB_URI, MONGODB_DB, CLOUDINARY_URL, ALLOWED_ORIGIN
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
   Minimal in-memory bearer-token auth. Not persisted across a restart —
   users just log in again, same as any other session cookie would need to
   after a server redeploy. Good enough to make "admin only" a real,
   server-enforced boundary instead of a client-side convenience.

   ADMIN_USER_ID names the one account whose session is trusted for
   admin-gated ops (deletes, and any write to the users collection) —
   matches the frontend's existing "U-ADMIN" convention. */
const ADMIN_USER_ID = "U-ADMIN";
const sessions = new Map(); // token -> { userId, isAdmin, expiresAt }
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function issueSession(user) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    userId: user.id,
    isAdmin: user.id === ADMIN_USER_ID,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function getSession(req) {
  const header = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return null;
  const session = sessions.get(m[1]);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(m[1]); return null; }
  return session;
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

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");
  const client = new MongoClient(uri);
  await client.connect();
  mongoDb = client.db(process.env.MONGODB_DB || undefined);

  for (const c of COLLECTIONS) {
    await mongoDb.collection(c).createIndex({ id: 1 }, { unique: true });
  }
  await mongoDb.collection("events").createIndex({ ts: -1 });
  // sparse: users created before email-based login existed (or without an
  // email) don't collide with each other on a shared "" value.
  await mongoDb.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true });

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
   board member), need a real logged-in admin session. Anonymous upsert to
   `dpr`/`drawingRequests` — the two collections the public no-login
   submission forms write to — stays open by design.

   Bootstrap exception: if the users collection is genuinely empty (fresh
   board, or recovering from a reset), the very first user upsert is let
   through unauthenticated — otherwise nobody could ever create the first
   admin account to log in and authorize anything else. Throws a tagged
   error so the route handler can turn it into a clean 401/403. */
async function assertOpAllowed(op, session) {
  const needsAdmin = op.op === "delete" || (op.op === "upsert" && op.coll === "users");
  if (!needsAdmin) return;
  if (op.op === "upsert" && op.coll === "users") {
    const userCount = await mongoDb.collection("users").countDocuments();
    if (userCount === 0) return;
  }
  if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
  if (!session.isAdmin) { const e = new Error("Admin access required"); e.status = 403; throw e; }
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
      await mongoDb.collection(op.coll).updateOne({ id: op.rec.id }, update, { upsert: true });
    } else if (op.op === "delete" && COLLECTIONS.includes(op.coll) && op.id) {
      await mongoDb.collection(op.coll).deleteOne({ id: op.id });
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

async function resetDb(mode) {
  const seed = mode === "blank" ? blankData() : seedData();
  for (const c of COLLECTIONS) {
    await mongoDb.collection(c).deleteMany({});
    if (seed[c].length) await mongoDb.collection(c).insertMany(seed[c]);
  }
  await mongoDb.collection("progress").deleteMany({});
  const progressEntries = Object.entries(seed.progress || {});
  if (progressEntries.length) {
    await mongoDb.collection("progress").insertMany(progressEntries.map(([key, patch]) => Object.assign({ _id: key }, patch)));
  }
  await mongoDb.collection("events").deleteMany({});
  if ((seed.events || []).length) await mongoDb.collection("events").insertMany(seed.events);

  const rev = (await getRev()) + 1;
  await mongoDb.collection("meta").updateOne({ _id: "rev" }, { $set: { value: rev } }, { upsert: true });
  return rev;
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

    const user = await mongoDb.collection("users").findOne({ email: new RegExp("^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
    if (!user) return sendJson(res, 401, { error: "Invalid email or password" });
    if (user.active === false) return sendJson(res, 401, { error: "This account is inactive" });

    if (user.passwordHash && user.passwordSalt) {
      if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        return sendJson(res, 401, { error: "Invalid email or password" });
      }
    } else if (user.legacyPasswordHash) {
      if (!bcrypt.compareSync(password, user.legacyPasswordHash)) {
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
      return sendJson(res, 401, { error: "Invalid email or password" });
    }

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
    await resetDb(body.mode === "blank" ? "blank" : "demo");
    const state = await getState();
    return sendJson(res, 200, state);
  }
  return sendJson(res, 404, { error: "Unknown endpoint " + urlPath });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

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
 *   GET  /api/state         -> {rev, data}                     full snapshot
 *   POST /api/ops           -> {rev, data}                     apply ops, bump rev
 *   POST /api/photo         -> {url, publicId}                 upload to Cloudinary
 *   POST /api/reset         -> {rev, data}                     reseed or blank
 */

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { MongoClient } = require("mongodb");
const cloudinary = require("cloudinary").v2;
const { seedData, blankData, COLLECTIONS } = require("./seed.js");

const ROOT = __dirname;
const STATIC_ROOT = path.join(ROOT, "..", "frontend");
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
const PHOTO_TYPES = ["snags", "qc", "progress", "drawings"];

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

async function applyOps(ops) {
  for (const op of ops || []) {
    if (!op || typeof op !== "object") continue;

    if (op.op === "upsert" && COLLECTIONS.includes(op.coll) && op.rec && op.rec.id) {
      const { set, unset } = splitSetUnset(op.rec);
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
  if (req.method === "POST" && urlPath === "/api/ops") {
    const body = await readBody(req);
    if (!Array.isArray(body.ops)) return sendJson(res, 400, { error: "ops[] required" });
    await applyOps(body.ops);
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
    if (err || !stat.isFile()) return sendText(res, 404, "Not found: " + urlPath);
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

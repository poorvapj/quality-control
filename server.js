#!/usr/bin/env node
/*
 * Neoteric Tower Quality Board — local server + shared data API.
 * Zero dependencies. Node 18+.
 *
 *   node server.js              # http://localhost:5173
 *   node server.js --port 8080
 *
 * Serves this folder AND hosts the shared board state in ./data.json, so every
 * device on the Network URL reads and writes ONE board. Photos land in ./photos.
 *
 * API
 *   GET  /api/rev           -> {rev}                  cheap poll
 *   GET  /api/state         -> {rev, data}            full snapshot
 *   POST /api/ops           -> {rev, data}            apply ops, bump rev
 *   POST /api/photo         -> {url}                  store a data-URL image
 *   POST /api/reset         -> {rev, data}            reseed or blank
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { seedData, blankData, COLLECTIONS } = require("./seed.js");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");
const PHOTO_DIR = path.join(ROOT, "photos");
const MAX_BODY = 16 * 1024 * 1024; // 16MB — photo uploads

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
let PORT = portArg !== -1 ? parseInt(args[portArg + 1], 10) : 5173;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) PORT = 5173;

/* ---------------------------------------------------------------- storage */

let db = null;
let writeTimer = null;

function load() {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!db || typeof db !== "object" || !db.projects) throw new Error("shape");
    console.log(`  loaded data.json (rev ${db.rev})`);
  } catch {
    db = seedData();
    db.rev = 1;
    persistNow();
    console.log("  data.json missing/invalid — seeded fresh demo data");
  }
  // Forward-compat: make sure every known collection exists.
  for (const c of COLLECTIONS) if (!db[c]) db[c] = [];
  if (!db.progress) db.progress = {};
  if (!db.events) db.events = [];
}

function persistNow() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DATA_FILE); // atomic — never leaves a half-written file
}

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      persistNow();
    } catch (e) {
      console.error("  ! failed to write data.json:", e.message);
    }
  }, 150);
}

/* -------------------------------------------------------------------- ops */

/*
 * Ops are small, record-level and idempotent, so two engineers editing
 * different units never clobber each other (last-write-wins per record only).
 */
function applyOps(ops) {
  for (const op of ops || []) {
    if (!op || typeof op !== "object") continue;

    if (op.op === "upsert" && COLLECTIONS.includes(op.coll) && op.rec && op.rec.id) {
      const list = db[op.coll];
      const i = list.findIndex((r) => r.id === op.rec.id);
      const merged = i === -1 ? op.rec : Object.assign({}, list[i], op.rec);
      // null clears a field — otherwise a merge could never unset one.
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (i === -1) list.push(merged);
      else list[i] = merged;
    } else if (op.op === "delete" && COLLECTIONS.includes(op.coll) && op.id) {
      db[op.coll] = db[op.coll].filter((r) => r.id !== op.id);
    } else if (op.op === "progress" && op.key && op.patch) {
      const cur = db.progress[op.key] || {};
      const next = Object.assign({}, cur, op.patch);
      for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
      db.progress[op.key] = next;
    } else if (op.op === "event" && op.ev) {
      db.events.unshift(op.ev);
      if (db.events.length > 5000) db.events.length = 5000;
    }
  }
  db.rev = (db.rev || 0) + 1;
  persist();
  return db;
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
    return sendJson(res, 200, { rev: db.rev });
  }
  if (req.method === "GET" && urlPath === "/api/state") {
    return sendJson(res, 200, { rev: db.rev, data: db });
  }
  if (req.method === "POST" && urlPath === "/api/ops") {
    const body = await readBody(req);
    if (!Array.isArray(body.ops)) return sendJson(res, 400, { error: "ops[] required" });
    applyOps(body.ops);
    return sendJson(res, 200, { rev: db.rev, data: db });
  }
  if (req.method === "POST" && urlPath === "/api/photo") {
    const body = await readBody(req);
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || "");
    if (!m) return sendJson(res, 400, { error: "dataUrl must be a base64 png/jpeg/webp" });
    const ext = m[1] === "png" ? ".png" : m[1] === "webp" ? ".webp" : ".jpg";
    const name = crypto.randomUUID() + ext;
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(path.join(PHOTO_DIR, name), Buffer.from(m[2], "base64"));
    return sendJson(res, 200, { url: "/photos/" + name });
  }
  if (req.method === "POST" && urlPath === "/api/reset") {
    const body = await readBody(req);
    const rev = db.rev || 0;
    db = body.mode === "blank" ? blankData() : seedData();
    db.rev = rev + 1;
    persist();
    return sendJson(res, 200, { rev: db.rev, data: db });
  }
  return sendJson(res, 404, { error: "Unknown endpoint " + urlPath });
}

const server = http.createServer(async (req, res) => {
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

  // Never serve the raw store; the API is the only way in.
  if (urlPath === "/data.json") return sendText(res, 403, "Forbidden");

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT + path.sep)) return sendText(res, 403, "Forbidden");

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, "Not found: " + urlPath);
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      // Photos are immutable once written; app code must never be cached.
      "Cache-Control": urlPath.startsWith("/photos/") ? "public, max-age=31536000" : "no-store"
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

console.log(`\n  Neoteric Tower Quality Board`);
load();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Local:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Network: http://${ip}:${PORT}`);
  console.log(`\n  Shared store: data.json   ·   Ctrl+C to stop.\n`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      persistNow();
    } catch {}
    process.exit(0);
  });
}

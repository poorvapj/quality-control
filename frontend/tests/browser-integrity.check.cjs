// LOCAL ONLY (not run by CI, needs dev tools outside the repo): real Edge against the REAL built frontend + backend of THIS
// worktree, in-memory MongoDB, invented data. Reproduces the "two admins create a user at the same time" collision through
// the actual Add User screen and shows what each person sees. No production, Render, Vercel or Slack involved.
//   node tests/browser-integrity.check.cjs <path to backend/server.js>     (frontend/dist must be built next to it; port 5000 is fixed by the app)
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const puppeteer = require("puppeteer-core");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const SECRET = "s".repeat(32);
let PORT, base;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
let fails = 0; const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) fails++; };
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
const login = async (email, password) => (await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).status;

(async () => {
  PORT = await freePort(); base = "http://127.0.0.1:" + PORT;
  const mms = await MongoMemoryServer.create();
  const uri = mms.getUri(); if (!uri.startsWith("mongodb://127.0.0.1")) throw new Error("not the local in-memory database");
  const client = await new MongoClient(uri).connect(); const db = client.db("t");
  const salt = "ab".repeat(8);
  await db.collection("projects").insertOne({ id: "P1", code: "TWR", name: "Tower One", active: true });
  await db.collection("users").insertOne({ id: "U-ADMIN", name: "Site Admin", role: "ADMIN", email: "admin@neoteric.test", passwordHash: hashPw("pw-admin-1", salt), passwordSalt: salt, active: true });
  const env = { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI: uri, MONGODB_DB: "t", JWT_SECRET: SECRET, PORT: String(PORT), DISABLE_VMS_DPR_POLL: "1" };
  const server = path.resolve(process.argv[2]);
  const srv = spawn(process.execPath, [server], { cwd: path.dirname(server), env, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/rev"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox"] });

  async function openApp(label, { freeze } = {}) {
    const page = await (await browser.createBrowserContext()).newPage();
    // the app is hard-wired to http://localhost:5000 when served from a local port; this run must never touch whatever
    // else is listening there, so every API call is pointed at this test's own server instead
    await page.evaluateOnNewDocument(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => f(typeof u === "string" ? u.replace("http://localhost:5000", "") : u, o); });
    page.on("pageerror", (e) => console.log(`   [${label} pageerror]`, e.message.slice(0, 160)));
    await page.goto(base + "/", { waitUntil: "networkidle0" }); await settle();
    await page.type("input[type=email]", "admin@neoteric.test"); await page.type("input[type=password]", "pw-admin-1"); await page.keyboard.press("Enter"); await settle(2500);
    if (freeze) {   // this browser stops seeing other people's changes: /api/rev keeps answering the OLD revision, so its board
                    // copy stays old while it is still online and can still save (the situation of someone who has not polled yet)
      const rev = (await (await fetch(base + "/api/rev")).json()).rev;
      await page.setRequestInterception(true);
      page.on("request", (r) => { if (r.url().endsWith("/api/rev")) r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ rev }) }); else r.continue(); });
    }
    return page;
  }
  const clickText = (page, txt) => page.evaluate((t) => { const els = [...document.querySelectorAll("body *")].filter((e) => !e.children.length && e.textContent.trim() === t); const el = els[els.length - 1]; if (!el) return false; el.click(); return true; }, txt);
  const toastText = (page) => page.evaluate(() => document.body.innerText);
  async function addUser(page, name, email, pw) {
    await clickText(page, "Masters"); await settle(800);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /User Master/.test(x.textContent)); if (b) b.click(); }); await settle(600);
    await clickText(page, "＋ New"); await settle(800);
    await page.type("input[placeholder='e.g. Rahul Gupta']", name); await page.type("input[type=email]", email); await page.type("input[placeholder='Set initial password']", pw);
    await page.select("select", "CIVIL");
    const posts = []; const onReq = (r) => { if (r.method() === "POST" && r.url().endsWith("/api/ops")) posts.push(r.postData()); }; page.on("request", onReq);
    const responses = []; const onRes = (r) => { if (r.request().method() === "POST" && r.url().endsWith("/api/ops")) responses.push(r.status()); }; page.on("response", onRes);
    await clickText(page, "Create User"); await settle(1500);
    const text = await toastText(page);
    page.off("request", onReq); page.off("response", onRes);
    return { posts, responses, text };
  }

  const p1 = await openApp("admin 1");
  const p2 = await openApp("admin 2 (stale)", { freeze: true });   // loads the board, then stops refreshing

  const a1 = await addUser(p1, "First Person", "first@neoteric.test", "First-Pw-1111");
  const body1 = JSON.parse(a1.posts[0] || "{}");
  check("1. admin 1's Add User sends the user as a CREATE (create:true) with a batch id", !!body1.batchId && body1.ops && body1.ops[0].create === true && body1.ops[0].coll === "users", JSON.stringify(body1.ops && body1.ops[0] && { create: body1.ops[0].create, coll: body1.ops[0].coll, id: body1.ops[0].rec.id }));
  check("2. admin 1's save succeeded (HTTP 200) and the user exists", a1.responses[0] === 200 && (await db.collection("users").countDocuments({ email: "first@neoteric.test" })) === 1);
  const takenId = (await db.collection("users").findOne({ email: "first@neoteric.test" })).id;

  const a2 = await addUser(p2, "Second Person", "second@neoteric.test", "Second-Pw-2222");
  const body2 = JSON.parse(a2.posts[0] || "{}");
  check("3. admin 2 (stale copy) picked the SAME id as admin 1", body2.ops && body2.ops[0].rec.id === takenId, "id=" + (body2.ops && body2.ops[0].rec.id) + " taken=" + takenId);
  check("4. the server REFUSED it with 409 instead of overwriting admin 1's user", a2.responses[0] === 409, "status=" + a2.responses.join(","));
  const stillFirst = await db.collection("users").findOne({ id: takenId });
  check("5. admin 1's user (name, e-mail, password) is intact", stillFirst.email === "first@neoteric.test" && stillFirst.name === "First Person" && (await login("first@neoteric.test", "First-Pw-1111")) === 200 && (await login("second@neoteric.test", "Second-Pw-2222")) === 401);
  check("6. admin 2 sees the explanation on screen, NOT a 'User created' success message", /already exists/i.test(a2.text) && !/User created/.test(a2.text), JSON.stringify(a2.text.match(/[^\n]*(already exists|User created)[^\n]*/)));
  const kept = await p2.evaluate(() => localStorage.getItem("neoteric_rejected_ops"));
  check("7. the refused change was kept in the browser (neoteric_rejected_ops) so it can be re-entered", !!kept && JSON.parse(kept).length === 1 && JSON.parse(kept)[0].ops[0].rec.email === "second@neoteric.test");
  check("8. and that kept copy contains NO plaintext password", !!kept && !kept.includes("Second-Pw-2222") && !kept.includes('"password"'));
  const stored = await p2.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o); });
  check("9. no plaintext password anywhere in admin 2's browser storage", !stored.includes("Second-Pw-2222"));
  check("10. the offline queue is empty (the refused change is not retried forever)", JSON.parse(await p2.evaluate(() => localStorage.getItem("neoteric_pending_ops") || "[]")).length === 0);

  const badge = await p2.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).find((t) => /change.*refused/.test(t)) || null);
  check("10b. a visible badge tells admin 2 that 1 change was refused", badge && /^1 change refused/.test(badge), String(badge));
  await p2.evaluate(() => [...document.querySelectorAll("button")].find((b) => /change.*refused/.test(b.textContent)).click()); await settle(600);
  const modalText = await p2.evaluate(() => document.body.innerText);
  check("10c. opening it lists the refused change with the server's reason and what it was (no password)", /Changes the server refused/.test(modalText) && /already exists/.test(modalText) && /create users/.test(modalText) && !/Second-Pw-2222/.test(modalText));
  await clickText(p2, "Dismiss all"); await settle(600);
  check("10d. 'Dismiss all' clears the list and the badge", (await p2.evaluate(() => localStorage.getItem("neoteric_rejected_ops"))) === null && !(await p2.evaluate(() => /change.*refused/.test(document.body.innerText))));
  // admin 2 un-freezes (reload = fresh board) and simply tries again: now a free id is picked
  p2.removeAllListeners("request"); await p2.setRequestInterception(false); await p2.reload({ waitUntil: "networkidle0" }); await settle(2500);
  const a3 = await addUser(p2, "Second Person", "second@neoteric.test", "Second-Pw-2222");
  check("11. after the board refreshes, the same person can be created normally (new id, 200)", a3.responses[0] === 200 && (await login("second@neoteric.test", "Second-Pw-2222")) === 200 && (await db.collection("users").countDocuments({ email: { $in: ["first@neoteric.test", "second@neoteric.test"] } })) === 2);

  await browser.close(); srv.kill(); await client.close(); await mms.stop();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

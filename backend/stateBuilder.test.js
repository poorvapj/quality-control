/* Tests for stateBuilder.js (shared, revision-checked state rebuild).
   Run with: node stateBuilder.test.js */
const assert = require("assert");
const { createStateBuilder } = require("./stateBuilder.js");

let passed = 0, started = 0;
const unhandled = [];
// a test that never settles (a hung promise) would otherwise let node exit 0 silently
process.on("exit", (code) => { if (code === 0 && passed !== started) { console.error(`FAIL - ${started - passed} test(s) never finished (hung) or failed`); process.exitCode = 1; } });
process.on("unhandledRejection", (e) => unhandled.push(e));
function test(name, fn) {
  started++;
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* A tiny in-memory "database": `data` is the board, `rev` the revision. write() mimics the server's order:
   data first, THEN the revision bump. readState has an optional delay so builds can overlap with writes. */
function fakeDb({ readDelay = 0, readHook } = {}) {
  const db = { data: { v: 0 }, rev: 1, reads: 0, builds: 0, revReads: 0, now: 1000 };
  db.getRev = async () => { db.revReads++; await tick(); return db.rev; };
  db.readState = async (rev) => {
    db.builds++;
    const snapshotStart = { ...db.data };
    if (readHook) await readHook(db);
    if (readDelay) await tick(readDelay);
    return { rev, data: readDelay || readHook ? snapshotStart : { ...db.data } }; // data as of when the read STARTED if slow
  };
  db.serialize = async (s) => Buffer.from(JSON.stringify(s));
  db.write = async () => { db.data = { v: db.data.v + 1 }; const v = db.data.v; await tick(); db.rev++; return { rev: db.rev, v }; };
  db.builder = createStateBuilder({ getRev: db.getRev, readState: db.readState, serialize: db.serialize, ttlMs: 3000, now: () => db.now });
  return db;
}
const parse = (r) => JSON.parse(r.body.toString());

async function main() {
  await test("50 concurrent requests for the same revision share ONE rebuild and get identical bodies", async () => {
    const db = fakeDb({ readDelay: 20 });
    const rs = await Promise.all(Array.from({ length: 50 }, () => db.builder.get()));
    assert.strictEqual(db.builds, 1, "builds=" + db.builds);
    assert.ok(rs.every((r) => r.rev === 1 && r.body.equals(rs[0].body)));
  });

  await test("requests after the build use the cache without rebuilding (revision still checked every time)", async () => {
    const db = fakeDb();
    await db.builder.get(); const before = db.revReads;
    for (let i = 0; i < 5; i++) await db.builder.get();
    assert.strictEqual(db.builds, 1);
    assert.strictEqual(db.revReads - before, 5, "the revision is read from the database on every call");
  });

  await test("a revision change invalidates the cache: the next request rebuilds and sees the new data", async () => {
    const db = fakeDb();
    assert.strictEqual(parse(await db.builder.get()).data.v, 0);
    await db.write();
    const r = await db.builder.get();
    assert.strictEqual(r.rev, 2); assert.strictEqual(parse(r).data.v, 1); assert.strictEqual(db.builds, 2);
  });

  await test("READ-YOUR-WRITES: a caller that has seen the new revision never gets the result of an older in-flight build", async () => {
    const db = fakeDb({ readDelay: 40 });
    const slowOld = db.builder.get();               // build for rev 1 starts, takes 40 ms, reads data v0
    await tick(10);
    await db.write();                               // data v1, then rev 2 (this is the writer's own save)
    const mine = await db.builder.get();            // writer asks for state right after its write
    assert.strictEqual(mine.rev, 2);
    assert.strictEqual(parse(mine).data.v, 1, "the writer must see its own write");
    const old = await slowOld;
    assert.strictEqual(old.rev, 1);                 // the older caller still gets its (older, correctly stamped) result
    assert.strictEqual(db.builds, 2, "two revisions => two builds, not shared across revisions");
  });

  await test("stamp is never newer than the data: a write landing mid-read leaves the snapshot stamped with the OLD revision", async () => {
    let wrote = false;
    const db = fakeDb({ readHook: async (d) => { if (!wrote) { wrote = true; await d.write(); } } });
    const r = await db.builder.get();               // revision read first (=1); a write happens while data is read
    assert.strictEqual(r.rev, 1, "stamped with the revision read BEFORE the data");
    const next = await db.builder.get();            // next poll sees rev 2 != 1 -> rebuilds -> picks up the write
    assert.strictEqual(next.rev, 2); assert.strictEqual(parse(next).data.v, 1);
  });

  await test("concurrent writers + readers: EVERY writer's reply contains its own write (read-your-writes), and the final state has them all", async () => {
    const db = fakeDb({ readDelay: 5 });
    const results = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
      await tick(i % 7);
      const w = await db.write();                   // data first, then the revision (the server's order)
      const r = await db.builder.get();             // the reply to that writer
      return { w, r };
    }));
    for (const { w, r } of results) {
      assert.ok(r.rev >= w.rev, "reply rev " + r.rev + " must be >= the writer's own bump " + w.rev);
      assert.ok(parse(r).data.v >= w.v, "reply data v" + parse(r).data.v + " is missing the writer's own write v" + w.v);
    }
    const final = await db.builder.get();
    assert.strictEqual(parse(final).data.v, 40); assert.strictEqual(final.rev, db.rev);
  });

  await test("a failed rebuild rejects all waiting requests, is NOT cached, and the next request retries cleanly", async () => {
    const db = fakeDb({ readDelay: 10 });
    let fail = true; const orig = db.readState;
    const builder = createStateBuilder({ getRev: db.getRev, readState: async (rev) => { if (fail) { await tick(5); throw new Error("mongo down"); } return orig(rev); }, serialize: db.serialize, now: () => db.now });
    const rs = await Promise.allSettled([builder.get(), builder.get(), builder.get()]);
    assert.ok(rs.every((x) => x.status === "rejected" && /mongo down/.test(x.reason.message)));
    assert.strictEqual(builder._peek().inflight, null, "the in-flight slot is cleared after a failure");
    assert.strictEqual(builder._peek().cache, null, "nothing cached from a failure");
    fail = false;
    const ok = await builder.get(); assert.strictEqual(ok.rev, 1);
    await tick(5); assert.deepStrictEqual(unhandled, [], "no unhandled rejection (the server exits on one)");
  });

  await test("a serialization failure behaves the same way", async () => {
    const db = fakeDb(); let bad = true;
    const builder = createStateBuilder({ getRev: db.getRev, readState: db.readState, serialize: async (s) => { if (bad) throw new Error("gzip failed"); return Buffer.from("ok"); }, now: () => db.now });
    await assert.rejects(() => builder.get(), /gzip failed/);
    bad = false; assert.strictEqual((await builder.get()).body.toString(), "ok");
  });

  await test("a failure reading the revision rejects and leaves nothing stuck", async () => {
    const db = fakeDb(); let down = true;
    const builder = createStateBuilder({ getRev: async () => { if (down) throw new Error("rev read failed"); return db.rev; }, readState: db.readState, serialize: db.serialize, now: () => db.now });
    await assert.rejects(() => builder.get(), /rev read failed/);
    down = false; assert.strictEqual((await builder.get()).rev, 1);
  });

  await test("TTL safety net: an out-of-band change with NO revision bump is picked up once the cache expires", async () => {
    const db = fakeDb();
    await db.builder.get();
    db.data = { v: 99 };                            // changed behind the server's back, rev unchanged
    db.now += 1000; assert.strictEqual(parse(await db.builder.get()).data.v, 0, "within the TTL the cached state is served (as before)");
    db.now += 3000; assert.strictEqual(parse(await db.builder.get()).data.v, 99, "after the TTL it is rebuilt (as before)");
  });

  await test("a slow older build finishing late never overwrites a newer cache entry", async () => {
    const db = fakeDb();
    let release; const gate = new Promise((r) => { release = r; });
    let first = true;
    const builder = createStateBuilder({
      getRev: db.getRev, serialize: db.serialize, now: () => db.now,
      readState: async (rev) => { if (first) { first = false; await gate; } return { rev, data: { v: db.data.v } }; }
    });
    const slow = builder.get();                      // rev 1, blocked
    await tick(5); await db.write();                 // rev 2
    const fresh = await builder.get(); assert.strictEqual(fresh.rev, 2);
    release(); await slow;                           // the old build completes AFTER the newer one
    assert.strictEqual(builder._peek().cache.rev, 2, "cache still holds the newer revision");
    assert.strictEqual((await builder.get()).rev, 2);
  });

  await test("each revision builds at most once even under repeated bursts", async () => {
    const db = fakeDb({ readDelay: 5 });
    for (let burst = 0; burst < 5; burst++) { await Promise.all(Array.from({ length: 20 }, () => db.builder.get())); await db.write(); }
    assert.strictEqual(db.builds, 5, "builds=" + db.builds);
  });

  await test("a HUNG build does not trap later requests: after maxJoinMs a request starts its own, and the late old build never overwrites it", async () => {
    const clock = { t: 1000 }; let calls = 0; let releaseHung;
    const builder = createStateBuilder({
      getRev: async () => 7, serialize: async (s) => Buffer.from(JSON.stringify(s)), maxJoinMs: 30000, now: () => clock.t,
      readState: async (rev) => {
        const n = ++calls;
        if (n === 1) { await new Promise((r) => { releaseHung = r; }); return { rev, data: { who: "old-hung-build" } }; }
        return { rev, data: { who: "fresh-build" } };
      }
    });
    const hung = builder.get();                         // never completes until released
    await tick(5);
    clock.t += 10000;
    const joiner = builder.get();                       // 10 s old: still joins the (hung) build
    clock.t += 21000;                                   // now 31 s old
    const fresh = await builder.get();                  // too old to join -> starts a new build and succeeds
    assert.strictEqual(calls, 2); assert.strictEqual(JSON.parse(fresh.body).data.who, "fresh-build");
    releaseHung(); await hung; await joiner;            // the old build finally completes
    assert.strictEqual(JSON.parse(builder._peek().cache.body).data.who, "fresh-build", "older build did not replace the newer same-revision cache entry");
  });

  await test("requests within maxJoinMs still share the build (no extra rebuilds)", async () => {
    const clock = { t: 0 }; let calls = 0;
    const builder = createStateBuilder({ getRev: async () => 1, serialize: async (s) => Buffer.from("x"), now: () => clock.t,
      readState: async (rev) => { calls++; await tick(15); return { rev, data: {} }; } });
    const rs = await Promise.all(Array.from({ length: 25 }, () => { clock.t += 1; return builder.get(); }));
    assert.strictEqual(calls, 1); assert.strictEqual(rs.length, 25);
  });

  assert.deepStrictEqual(unhandled, [], "no unhandled rejections anywhere");
  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();

/* Plain-Node tests for opsBatch.js (retry idempotency for POST /api/ops).
   No framework, no real Mongo: a tiny in-memory `meta` collection that honours
   _id uniqueness and the filter fields the module uses.
   Run with: node opsBatch.test.js */
const assert = require("assert");
const { createOpsBatchStore, isValidBatchId, STALE_MS } = require("./opsBatch.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

function fakeDb() {
  const docs = new Map();
  const matches = (d, f) => Object.keys(f).every((k) => d[k] === f[k]);
  const meta = {
    insertOne: async (doc) => {
      if (docs.has(doc._id)) { const e = new Error("dup"); e.code = 11000; throw e; }
      docs.set(doc._id, { ...doc });
    },
    findOne: async ({ _id }) => (docs.has(_id) ? { ...docs.get(_id) } : null),
    updateOne: async (f, u) => {
      const d = docs.get(f._id);
      if (!d || !matches(d, f)) return { matchedCount: 0 };
      Object.assign(d, u.$set);
      return { matchedCount: 1 };
    },
    deleteOne: async (f) => {
      const d = docs.get(f._id);
      if (d && matches(d, f)) docs.delete(f._id);
    }
  };
  return { _docs: docs, collection: (n) => { assert.strictEqual(n, "meta"); return meta; } };
}

async function main() {
  await test("batchId validation accepts uuid-like ids and rejects junk", () => {
    assert.ok(isValidBatchId("3f2b8c1e-7a4d-4e0b-9a55-0c2f5e6d7a81"));
    assert.ok(isValidBatchId("legacy-1a2b3c-0"));
    for (const bad of ["", "a b", "x".repeat(81), "../etc", "a$b", "id\n"]) assert.ok(!isValidBatchId(bad), JSON.stringify(bad));
  });

  await test("first claim is new; once completed, a replay is 'done' (so it is NOT applied again)", async () => {
    const db = fakeDb(); const store = createOpsBatchStore(() => db);
    assert.strictEqual(await store.claim("b1"), "new");
    await store.complete("b1");
    assert.strictEqual(await store.claim("b1"), "done");
    assert.strictEqual(await store.claim("b1"), "done");
    assert.strictEqual(await store.claim("b2"), "new", "a different batch is independent");
  });

  await test("a second request for a batch still being applied is 'busy', never 'new'", async () => {
    const db = fakeDb(); const store = createOpsBatchStore(() => db);
    assert.strictEqual(await store.claim("b1"), "new");
    assert.strictEqual(await store.claim("b1"), "busy");
  });

  await test("5 concurrent identical requests: exactly one is 'new'", async () => {
    const db = fakeDb(); const store = createOpsBatchStore(() => db);
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => store.claim("same")));
    assert.strictEqual(r.filter((x) => x === "new").length, 1);
    assert.strictEqual(r.filter((x) => x === "busy").length, 4);
  });

  await test("a failed batch is released so the retry applies it (a failure never becomes 'done')", async () => {
    const db = fakeDb(); const store = createOpsBatchStore(() => db);
    assert.strictEqual(await store.claim("b1"), "new");
    await store.release("b1");
    assert.strictEqual(await store.claim("b1"), "new");
  });

  await test("release never removes a batch that has completed", async () => {
    const db = fakeDb(); const store = createOpsBatchStore(() => db);
    await store.claim("b1"); await store.complete("b1");
    await store.release("b1");
    assert.strictEqual(await store.claim("b1"), "done");
  });

  await test("a stale pending marker (process died mid-apply) can be taken over by exactly one retry", async () => {
    const db = fakeDb(); const store = createOpsBatchStore(() => db);
    const t0 = 1_000_000;
    assert.strictEqual(await store.claim("b1", t0), "new");
    assert.strictEqual(await store.claim("b1", t0 + STALE_MS - 1), "busy", "not stale yet");
    const r = await Promise.all([store.claim("b1", t0 + STALE_MS + 1), store.claim("b1", t0 + STALE_MS + 1)]);
    assert.deepStrictEqual(r.slice().sort(), ["busy", "new"]);
  });

  await test("markers carry expireAt (TTL) so they clean themselves up", async () => {
    const db = fakeDb(); const store = createOpsBatchStore(() => db);
    await store.claim("b1");
    const d = db._docs.get("opb:b1");
    assert.ok(d.expireAt instanceof Date && d.expireAt.getTime() > Date.now());
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();

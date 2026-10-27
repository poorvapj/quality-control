// Regression tests for the offline/retry queue rules (src/shared/opQueue.ts).
// The frontend has no test runner; this uses Node's built-in one and Node's
// native TypeScript support (Node >= 22.18 / 23.6+):
//   cd frontend && node --test tests/opQueue.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { classifyStatus, flushQueue, normalizeQueue, canSendNow, tokenUserId, newBatchId } from "../src/shared/opQueue.ts";

const op = (id) => ({ op: "upsert", coll: "snags", rec: { id } });
const batch = (id, extra = {}) => ({ id, ops: [op(id)], ...extra });

// a fake persisted queue + fake server
function harness(initial, responder, user = "U-1") {
  let queue = initial.slice();
  const sent = [];
  const rejected = [];
  const run = () => flushQueue({
    getQueue: () => queue,
    remove: (id) => { queue = queue.filter((b) => b.id !== id); },
    send: async (b) => { sent.push(b.id); return responder(b, sent.length); },
    currentTokenUser: user,
    onRejected: (b, err) => rejected.push([b.id, err])
  });
  return { run, sent, rejected, ids: () => queue.map((b) => b.id) };
}

test("classifyStatus: only definitive refusals drop a batch", () => {
  for (const s of [200, 201, 204]) assert.equal(classifyStatus(s), "sent");
  for (const s of [401, 408, 425, 429, 500, 502, 503, 504]) assert.equal(classifyStatus(s), "retry-later", String(s));
  for (const s of [400, 403, 404, 409, 413, 422]) assert.equal(classifyStatus(s), "rejected", String(s));
});

test("401 (expired session): the batch is KEPT, not discarded", async () => {
  const h = harness([batch("a")], () => ({ status: 401, error: "Sign-in required" }));
  assert.equal(await h.run(), false);
  assert.deepEqual(h.ids(), ["a"]);
  assert.deepEqual(h.rejected, []);
});

test("401 for a batch made SIGNED OUT (public form) is final — it must not block the queue forever", async () => {
  // e.g. two anonymous DPR submissions picked the same client-side id: the second gets 401 "sign-in required"
  const h = harness([batch("pub", { by: null }), batch("next", { by: null })],
    (b) => (b.id === "pub" ? { status: 401, error: "Sign-in required" } : { status: 200 }), null);
  assert.equal(await h.run(), true);
  assert.deepEqual(h.ids(), []);
  assert.deepEqual(h.rejected, [["pub", "Sign-in required"]]);
});

test("401 for a legacy entry with no token stored is final too; with a (stale) token stored it is kept", async () => {
  const signedOut = harness([batch("old")], () => ({ status: 401 }), null);
  assert.equal(await signedOut.run(), true);
  assert.deepEqual(signedOut.ids(), []);
  const expiredToken = harness([batch("old")], () => ({ status: 401 }), "U-1");
  assert.equal(await expiredToken.run(), false);
  assert.deepEqual(expiredToken.ids(), ["old"]);
});

test("5xx / 429 / 503: kept, and nothing queued behind it is sent out of order", async () => {
  for (const status of [500, 502, 503, 429]) {
    const h = harness([batch("a"), batch("b")], () => ({ status }));
    assert.equal(await h.run(), false);
    assert.deepEqual(h.ids(), ["a", "b"], String(status));
    assert.deepEqual(h.sent, ["a"], "stops at the first undeliverable batch");
  }
});

test("network failure (fetch throws): kept, flush stops", async () => {
  const h = harness([batch("a"), batch("b")], () => { throw new TypeError("Failed to fetch"); });
  assert.equal(await h.run(), false);
  assert.deepEqual(h.ids(), ["a", "b"]);
});

test("a later retry after 401 succeeds and then drains the whole queue in order", async () => {
  let fail = true;
  const h = harness([batch("a"), batch("b")], () => ({ status: fail ? 401 : 200 }));
  assert.equal(await h.run(), false);
  fail = false;
  assert.equal(await h.run(), true);
  assert.deepEqual(h.ids(), []);
  assert.deepEqual(h.sent, ["a", "a", "b"]);
});

test("a definitive rejection (400/403/409) drops only that batch, reports it, and continues", async () => {
  const h = harness([batch("a"), batch("b"), batch("c")], (b) => (b.id === "b" ? { status: 403, error: "not allowed" } : { status: 200 }));
  assert.equal(await h.run(), true);
  assert.deepEqual(h.ids(), []);
  assert.deepEqual(h.rejected, [["b", "not allowed"]]);
});

test("every attempt reuses the SAME batch id (what makes a server-side retry idempotent)", async () => {
  const seen = [];
  let n = 0;
  const h = harness([batch("stable-id")], (b) => { seen.push(b.id); return { status: ++n < 3 ? 503 : 200 }; });
  await h.run(); await h.run(); await h.run();
  assert.deepEqual(seen, ["stable-id", "stable-id", "stable-id"]);
  assert.deepEqual(h.ids(), []);
});

test("a batch made by another signed-in user is never replayed under this user's token, and doesn't block this user's", async () => {
  const h = harness([batch("theirs", { by: "U-2" }), batch("mine", { by: "U-1" })], () => ({ status: 200 }), "U-1");
  assert.equal(await h.run(), false, "foreign batch still waiting");
  assert.deepEqual(h.sent, ["mine"]);
  assert.deepEqual(h.ids(), ["theirs"]);
  assert.equal(canSendNow(batch("x", { by: "U-2" }), null), false, "signed out can't send a user's batch");
  assert.equal(canSendNow(batch("x", { by: null }), null), true, "public-form batch stays sendable");
  assert.equal(canSendNow(batch("x"), "U-9"), true, "legacy entry keeps today's behaviour");
});

test("legacy queue format (array of bare ops arrays) is upgraded, deterministically, without losing ops", () => {
  const legacy = [[op("s1")], [op("s2"), op("s3")]];
  const a = normalizeQueue(legacy);
  const b = normalizeQueue(JSON.parse(JSON.stringify(legacy)));
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((x) => x.ops.length), [1, 2]);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id), "two tabs derive the same ids");
  assert.equal(new Set(a.map((x) => x.id)).size, 2);
  // new shape passes through; garbage is ignored, never throws
  assert.deepEqual(normalizeQueue([batch("n1")]), [batch("n1")]);
  assert.deepEqual(normalizeQueue("junk"), []);
  assert.deepEqual(normalizeQueue([null, 5, [], {}]), []);
});

test("tokenUserId reads the owner out of a JWT payload and tolerates junk", () => {
  const payload = Buffer.from(JSON.stringify({ userId: "U-42", isAdmin: false })).toString("base64url");
  assert.equal(tokenUserId("h." + payload + ".s"), "U-42");
  for (const bad of [null, "", "abc", "a.b.c", "a.!!!.c"]) assert.equal(tokenUserId(bad), null);
});

test("newBatchId is unique and server-valid", () => {
  const ids = new Set(Array.from({ length: 1000 }, newBatchId));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,80}$/);
});

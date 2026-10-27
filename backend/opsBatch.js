/* /api/ops idempotency — makes a client's retry of a batch safe.

   A client retries a batch when it never saw the reply (dropped signal,
   sleeping dyno, 5xx) — but the server may already have applied it. The client
   sends a unique `batchId`; the server records it in `meta`
   (`_id: "opb:<batchId>"`) so a repeat is acknowledged without being applied
   again (no duplicate audit events, no repeat Slack notifications).

   States: pending (being applied) -> done. A batch that fails is released so a
   retry applies it normally. A `pending` marker older than STALE_MS (the
   process died mid-apply) may be taken over. Markers carry `expireAt` and are
   removed by a TTL index after TTL_DAYS (index created in server.js). Clients
   that send no batchId (older versions) never touch any of this. */

const STALE_MS = 60 * 1000;
const TTL_DAYS = 30;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function createOpsBatchStore(getMongoDb) {
  const meta = () => getMongoDb().collection("meta");
  const idOf = (batchId) => "opb:" + batchId;

  // -> "new" (caller applies the batch) | "done" (already applied) | "busy" (another request is applying it now)
  async function claim(batchId, now = Date.now()) {
    const _id = idOf(batchId);
    try {
      await meta().insertOne({ _id, status: "pending", at: now, expireAt: new Date(now + TTL_DAYS * 86400000) });
      return "new";
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
    const existing = await meta().findOne({ _id });
    if (!existing) return claim(batchId, now); // released between our insert and read — try again
    if (existing.status === "done") return "done";
    if (now - existing.at > STALE_MS) {
      const r = await meta().updateOne({ _id, status: "pending", at: existing.at }, { $set: { at: now } });
      return r.matchedCount === 1 ? "new" : "busy";
    }
    return "busy";
  }
  async function complete(batchId) {
    await meta().updateOne({ _id: idOf(batchId) }, { $set: { status: "done", at: Date.now() } });
  }
  async function release(batchId) {
    await meta().deleteOne({ _id: idOf(batchId), status: "pending" }).catch(() => {});
  }
  return { claim, complete, release };
}

module.exports = { createOpsBatchStore, isValidBatchId: (s) => ID_RE.test(s), STALE_MS, TTL_DAYS };

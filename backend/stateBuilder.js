/* Shared, revision-checked rebuild of the serialized board state.

   Problem this solves (measured, docs/performance-baseline.md): after a write,
   every connected client sees the new revision and requests /api/state within
   the same moment. Each request that missed the cache rebuilt (JSON + gzip) the
   WHOLE board on its own, serially on the single Node thread — 40 clients at 10x
   data took ~11 s and ~2 GB. Now concurrent requests for the same revision share
   ONE rebuild.

   Correctness rules (each one is covered by stateBuilder.test.js):
   1. The current revision is read FROM THE DATABASE on every call, before anything
      is served from the cache or from an in-flight build. A stale cache can never
      be served as "current".
   2. A caller may only join an in-flight build that was started for the SAME
      revision it just read. A caller that has seen a newer revision (e.g. it just
      wrote) never receives the result of an older build, so read-your-writes
      holds. Data for revision R is committed before R is published (every writer
      writes first, bumps the revision after), so a build started after R was read
      contains every write <= R.
   3. The snapshot is stamped with the revision read BEFORE its data, never a later
      one. If a write lands mid-build the stamp is merely old (the client then
      refetches on its next poll) — it can never claim to be newer than its data.
   4. Failures are never cached or shared beyond the requests that were waiting on
      that very build: the in-flight slot is cleared whether the build resolves or
      rejects, and the next request starts a fresh one.
   5. A slow, older build finishing after a newer one never overwrites the newer
      cache entry.
   6. A request only joins an in-flight build younger than maxJoinMs. If a build hangs (e.g. a stuck database read) later requests start their own
      instead of all waiting behind it — the same isolation separate requests had before sharing.
   7. The short TTL stays as a safety net for out-of-band writes that bypass the
      revision counter (unchanged behaviour). */

function createStateBuilder({ getRev, readState, serialize, ttlMs = 3000, maxJoinMs = 30000, now = () => Date.now() }) {
  let cache = null;    // { rev, body, builtAt }
  let inflight = null; // { rev, promise }

  async function get() {
    const rev = await getRev();                                         // rule 1
    if (cache && cache.rev === rev && now() - cache.builtAt < ttlMs) return { rev, body: cache.body };
    if (inflight && inflight.rev === rev && now() - inflight.startedAt < maxJoinMs) return inflight.promise; // rules 2 and 6
    const entry = { rev, startedAt: now(), promise: null };
    entry.promise = (async () => {
      const state = await readState(rev);                               // rule 3: stamped with `rev`, read first
      const body = await serialize(state);
      const newer = !cache || cache.rev < rev || (cache.rev === rev && cache.startedAt <= entry.startedAt) || now() - cache.builtAt >= ttlMs;
      if (newer) cache = { rev, body, builtAt: now(), startedAt: entry.startedAt }; // rule 5: never replace newer data with older
      return { rev, body };
    })();
    const clear = () => { if (inflight === entry) inflight = null; };  // rule 4 (also marks the rejection handled)
    entry.promise.then(clear, clear);
    inflight = entry;
    return entry.promise;
  }

  return { get, _peek: () => ({ cache, inflight }) };
}

module.exports = { createStateBuilder };

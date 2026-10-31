/* Server-side atomic sequential ids (SNG-0097, DPR-0123, …), replacing the
   client-computed timestamp+random scheme for the collections that used to
   show it in the UI. WHY: nextId() (client-side, scanning the in-memory
   collection for the highest existing number) let two people acting around
   the same moment compute the SAME next id — this caused real production
   data loss for DPR, and the fix (a client-generated "PREFIX-<timestamp>-
   <random>" id) closed the collision but is unreadable. The real fix is to
   never let the CLIENT decide the final id at all: it sends a placeholder
   (see TEMP_ID_RE below), and the server exchanges every occurrence of that
   placeholder in the whole batch (the record's own id AND any OTHER op in
   the same batch that references it as a foreign key — e.g. a Quality
   Inspection's `linkedSnagId` pointing at the snag created in the same
   submission) for one atomically-issued sequential id, before anything is
   validated or written. Collision-proof AND readable.

   The counter itself is a single findOneAndUpdate($inc) per prefix — MongoDB
   serializes concurrent writes to the same document, so two simultaneous
   requests for the same prefix can never receive the same number. */

// U+2063 INVISIBLE SEPARATOR — not a JSON control character (JSON.stringify only escapes
// U+0000-U+001F, " and \, so this survives a stringify/parse round trip unchanged, unlike a
// NUL byte which JSON.stringify would turn into the 6-character text "\u0000"), and not a
// character anyone can type from a keyboard, so a real remarks/description field colliding
// with it is not a realistic concern.
const TEMP_PREFIX = "⁣TEMPID:";
const TEMP_ID_RE = new RegExp(TEMP_PREFIX + "[A-Z]+:[A-Za-z0-9]*", "g");

/** What the client sends in place of a real id: makeTempId("SNG") -> "⁣TEMPID:SNG:<random>".
 *  The trailing random part is only to keep multiple temp ids for the SAME prefix in one batch
 *  distinct from each other (so each still gets its OWN sequential number); it is never itself
 *  used as or shown as the real id. */
function makeTempId(prefix) {
  return `${TEMP_PREFIX}${prefix}:${Math.random().toString(36).slice(2, 8)}`;
}

/** db.collection("counters") holds one doc per prefix: { _id: "SNG", seq: 97 }. */
async function nextSeqId(db, prefix) {
  const res = await db.collection("counters").findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  // Driver v6 returns the document directly by default; older drivers/mocks wrap it in `.value`.
  const doc = res && typeof res === "object" && "value" in res ? res.value : res;
  const seq = doc && typeof doc.seq === "number" ? doc.seq : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** Finds every distinct temp-id placeholder anywhere in `ops` (JSON-walked, so it
 *  catches an id used as a foreign key in a SIBLING op, not just as a record's own
 *  id), issues one real sequential id per placeholder, and returns `{ ops, resolved }`
 *  — `ops` with every occurrence swapped (a new array; the input is never mutated),
 *  `resolved` the {placeholder: realId} map so the caller (server.js) can hand it
 *  back to the browser, which uses it to update the SAME rec objects it already
 *  built (see AppContext.tsx's apply()) — otherwise a caller showing "Ticket
 *  {rec.ticketNo} created" right after a successful save would show the raw
 *  placeholder forever, since nothing else would ever tell it what the real id
 *  turned out to be. No-op (`resolved` empty, `ops` the same reference) when
 *  nothing in the batch uses a temp id. */
async function resolveTempIds(db, ops) {
  const json = JSON.stringify(ops);
  if (!json.includes(TEMP_PREFIX)) return { ops, resolved: {} };
  const found = new Set();
  let m;
  TEMP_ID_RE.lastIndex = 0;
  while ((m = TEMP_ID_RE.exec(json))) found.add(m[0]);
  const replacements = new Map();
  for (const temp of found) {
    const prefix = temp.slice(TEMP_PREFIX.length).split(":")[0];
    replacements.set(temp, await nextSeqId(db, prefix));
  }
  let out = json;
  const resolved = {};
  for (const [temp, real] of replacements) { out = out.split(temp).join(real); resolved[temp] = real; }
  return { ops: JSON.parse(out), resolved };
}

module.exports = { makeTempId, nextSeqId, resolveTempIds, TEMP_PREFIX };

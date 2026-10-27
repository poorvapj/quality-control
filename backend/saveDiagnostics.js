/* LOG-ONLY diagnostics for the proposed "minimal save reply" (docs/save-response-design.md).

   It changes NOTHING about saving: no response body, no write, no ordering. For each POST /api/ops batch it
   compares two things and logs the comparison:
     PREDICTED  - the static rule the future client switch would use to call a save "clean" (nothing on the server
                  rewrites the data after the client sent it);
     OBSERVED   - what the server ACTUALLY did: any op record whose fields differ after the server's rules ran
                  (fingerprints taken before and after), the password hashing of a users save, a project-delete
                  cascade (counts), and a passing re-inspection closing another record.
   Outcomes:
     agree-clean            predicted clean, observed clean
     agree-not-clean        predicted not clean, observed a transformation        (the rule is right)
     MISMATCH-unsafe        predicted CLEAN but the server changed something       (a minimal reply would have left the
                                                                                   writer's copy WRONG - must be 0 before use)
     mismatch-conservative  predicted not clean but nothing changed                (only a missed optimisation)

   Privacy / bounds (enforced by tests): never logs passwords, tokens, ids, emails, record values or board contents -
   only collection names (checked against the known list), op kinds, counts, and field NAMES from a fixed allow-list of
   fields the server is known to write (anything else is counted as "other"). Examples per outcome+reason are capped,
   MISMATCH-unsafe lines are rate-limited, every line is a COMPLETE JSON object no longer than MAX_LINE (lines are
   shrunk by dropping detail, never cut mid-JSON), and a summary is printed every N batches and once at shutdown.

   Counters: `batchOutcomes` counts each applied batch exactly ONCE (its four values add up to `batches`), so the
   clean-save share is batchOutcomes["agree-clean"] / batches. `perCollection` ("outcome|collection") counts a batch
   once under EACH collection it touches, so it is NOT a batch total. A summary is split into numbered parts (each
   its own valid JSON line, sharing boot id + seq); a summary is complete only when all its parts are present.
   Every entry point swallows its own errors so it can never throw into the save path. Disabled unless
   SAVE_DIAGNOSTICS=1 (decided once at startup by the caller via isEnabled()). */

const crypto = require("crypto");

const KNOWN_SERVER_FIELDS = new Set([
  "approval", "result", "linkStatus", "linkedWorkOrderNo", "linkedItemId", "linkedItemType", "linkedItemDescription",
  "linkedItemUnit", "linkNote", "reviewStatus", "reviewHistory", "files", "assignedTo", "committedDate", "priority",
  "trackingStatus", "actualCompletionDate", "planningVerified", "projectAcknowledged", "submittedByUserId", "isPublic",
  "submittedAt", "status", "approvedByUserId", "approvedByName", "approvedAt", "members", "totals", "date", "teamId"
]);
// Collections whose saves the server rewrites (always, or for anonymous creates): the static "not clean" rule.
const ALWAYS_TRANSFORMING = new Set(["users", "qualityInspections", "materialMeasurements", "workMeasurements", "teamDailyReports", "formSubmissions"]);
const ANON_TRANSFORMING = new Set(["drawingRequests", "dpr"]);
const MAX_OPS_LISTED = 20, MAX_FIELDS_PER_OP = 8, MAX_LINE = 700;
const OUTCOMES = ["agree-clean", "agree-not-clean", "MISMATCH-unsafe", "mismatch-conservative"];

function isEnabled(env = process.env) { return env.SAVE_DIAGNOSTICS === "1"; }

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
const hash = (v) => crypto.createHash("sha1").update(String(stable(v))).digest("hex").slice(0, 12);
function fieldHashes(rec) {
  const out = {};
  if (rec && typeof rec === "object") for (const k of Object.keys(rec)) out[k] = hash(rec[k]);
  return out;
}

/* The static prediction. `ops` are the raw client ops; `anonymous` = no valid session. */
function predictClean(ops, { anonymous }) {
  const reasons = [];
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    if (op.op === "upsert") {
      if (ALWAYS_TRANSFORMING.has(op.coll) || (anonymous && ANON_TRANSFORMING.has(op.coll))) reasons.push("predicted:" + op.coll);
    } else if (op.op === "delete" && op.coll === "projects") reasons.push("predicted:project-delete-cascade");
  }
  return { clean: reasons.length === 0, reasons };
}

function createSaveDiagnostics({ collections, log = console, examplesPerKey = 3, summaryEvery = 25, unsafePerWindow = 20, windowMs = 10 * 60 * 1000, now = () => Date.now() }) {
  const known = new Set(collections || []);
  const counts = new Map();      // `${outcome}|${coll}` -> n (a batch is counted under EACH collection it touches)
  const batchOutcomes = new Map(OUTCOMES.map((o) => [o, 0])); // outcome -> n, exactly one per batch
  const bootId = crypto.randomBytes(4).toString("hex");
  let seq = 0, lastSummarised = "0/0/0"; // nothing yet = nothing to report at shutdown
  const reasonCounts = new Map(); // reason -> n
  const seenExamples = new Map(); // `${outcome}|${reason}` -> n
  let batches = 0, aborted = 0, unsafeWindowStart = now(), unsafeInWindow = 0, suppressedUnsafe = 0;
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const safeColl = (c) => (c === undefined || c === null ? "<n/a>" : known.has(c) ? c : "<unknown>"); // events/progress ops have no collection
  const safeField = (k) => (KNOWN_SERVER_FIELDS.has(k) ? k : "<other>");
  const json = (obj) => "[save-diag] " + JSON.stringify(obj);
  // Always valid JSON within MAX_LINE: when an example is too long, drop detail step by step (never slice the text).
  const line = (obj) => {
    for (const cap of [MAX_OPS_LISTED, 10, 5, 2]) {
      const o = { ...obj }; if (o.ops) o.ops = o.ops.slice(0, cap); if (o.changed) o.changed = o.changed.slice(0, cap);
      if (cap < MAX_OPS_LISTED) o.truncated = true;
      const s = json(o); if (s.length <= MAX_LINE) return s;
    }
    const { ops, changed, cascadeCounts, ...rest } = obj; return json({ ...rest, truncated: true });
  };

  /* Cumulative counters since this process started, as numbered parts (each a complete JSON line <= MAX_LINE).
     Called every summaryEvery batches and once at shutdown (final=true); a final summary with nothing new since the
     previous one is skipped, so the same totals are never reported twice. */
  function summary({ final = false } = {}) {
    try {
      const sig = batches + "/" + aborted + "/" + suppressedUnsafe;
      if (final && sig === lastSummarised) return;
      lastSummarised = sig; seq++;
      const head = { summary: true, boot: bootId, seq, final: final || undefined, batches, aborted, suppressedUnsafe, batchOutcomes: Object.fromEntries(batchOutcomes) };
      const groups = [["reasons", [...reasonCounts]], ["perCollection", [...counts]]];
      const bodies = [];
      for (const [name, entries] of groups) {
        let cur = {};
        for (const [k, v] of entries) {
          if (Object.keys(cur).length && json({ summary: true, boot: bootId, seq, part: 99, parts: 99, [name]: { ...cur, [k]: v } }).length > MAX_LINE) { bodies.push({ [name]: cur }); cur = {}; }
          cur[k] = v;
        }
        if (Object.keys(cur).length) bodies.push({ [name]: cur });
      }
      const parts = [head, ...bodies];
      parts.forEach((p, i) => log.log(json({ ...(i === 0 ? {} : { summary: true, boot: bootId, seq }), ...p, part: i + 1, parts: parts.length })));
    } catch { /* diagnostics must never affect saving */ }
  }

  function begin(ops, { anonymous = false } = {}) {
    try {
      if (!Array.isArray(ops)) return null;
      const list = ops.filter((o) => o && typeof o === "object");
      const before = list.map((o) => ({ kind: o.op, coll: o.coll, hasPassword: o.coll === "users" && o.op === "upsert" && !!o.rec && typeof o.rec.password === "string" && o.rec.password.length > 0, fields: o.op === "upsert" ? fieldHashes(o.rec) : null }));
      const predicted = predictClean(list, { anonymous });
      const trace = { cascade: null, snagClosed: 0 };

      function finish() {
        try {
          batches++;
          const reasons = [], fieldsByOp = [];
          list.forEach((o, i) => {
            const b = before[i];
            if (b.hasPassword) reasons.push("users-password");
            if (o.op === "upsert" && b.fields) {
              const after = fieldHashes(o.rec); const changed = [];
              for (const k of new Set([...Object.keys(b.fields), ...Object.keys(after)])) if (b.fields[k] !== after[k]) changed.push(safeField(k));
              if (changed.length) {
                reasons.push("server-modified:" + safeColl(o.coll));
                fieldsByOp.push({ coll: safeColl(o.coll), fields: [...new Set(changed)].slice(0, MAX_FIELDS_PER_OP) });
              }
            }
            if (o.op === "delete" && o.coll === "projects" && trace.cascade) reasons.push("project-delete-cascade");
          });
          if (trace.snagClosed > 0) reasons.push("re-inspection-closed-record");
          const observedClean = reasons.length === 0;
          const outcome = predicted.clean && observedClean ? "agree-clean" : !predicted.clean && !observedClean ? "agree-not-clean" : predicted.clean ? "MISMATCH-unsafe" : "mismatch-conservative";
          const colls = [...new Set(list.map((o) => safeColl(o.coll)))];
          bump(batchOutcomes, outcome);
          for (const c of colls.length ? colls : ["<none>"]) bump(counts, outcome + "|" + c);
          const uniqueReasons = [...new Set(reasons)];
          for (const r of uniqueReasons) bump(reasonCounts, r);

          const entry = {
            outcome, predictedClean: predicted.clean, observedClean,
            ops: list.slice(0, MAX_OPS_LISTED).map((o) => ({ kind: ["upsert", "delete", "progress", "event"].includes(o.op) ? o.op : "?", coll: safeColl(o.coll) })),
            reasons: uniqueReasons, changed: fieldsByOp.slice(0, MAX_OPS_LISTED),
            cascadeCounts: trace.cascade ? Object.fromEntries(Object.entries(trace.cascade).map(([k, v]) => [k, Number(v) || 0])) : undefined,
            anonymous: !!anonymous
          };
          if (outcome === "MISMATCH-unsafe") {
            if (now() - unsafeWindowStart > windowMs) { unsafeWindowStart = now(); unsafeInWindow = 0; }
            if (unsafeInWindow < unsafePerWindow) { unsafeInWindow++; log.warn(line(entry)); } else suppressedUnsafe++;
          } else {
            const key = outcome + "|" + (uniqueReasons[0] || colls[0] || "none");
            const n = seenExamples.get(key) || 0;
            if (n < examplesPerKey) { seenExamples.set(key, n + 1); log.log(line(entry)); }
          }
          if (batches % summaryEvery === 0) summary();
        } catch { /* diagnostics must never affect saving */ }
      }
      function abort() { try { aborted++; } catch {} }
      return { trace, finish, abort };
    } catch { return null; }
  }
  return { begin, summary, bootId, _stats: () => ({ batches, aborted, batchOutcomes: Object.fromEntries(batchOutcomes), counts: Object.fromEntries(counts), reasons: Object.fromEntries(reasonCounts), suppressedUnsafe }) };
}

module.exports = { createSaveDiagnostics, isEnabled, predictClean, KNOWN_SERVER_FIELDS, MAX_LINE };

#!/usr/bin/env node
/* Review tool for exported Render logs containing "[save-diag]" lines (format of commit 4474f8b and later).
   READ-ONLY, stdlib only, operator tool, not loaded by the server.
     node backend/reviewSaveDiag.js <exported-log-file> [--synthetic <file.json>] [--min-batches N] [--json]
   - Every summary is split in numbered parts sharing boot+seq. A summary is USED only if all its parts are present;
     per boot (process) the highest complete seq is used (counters are cumulative per process); boots are then summed.
   - Gates (all must pass, otherwise the verdict is FAIL or INSUFFICIENT EVIDENCE, never PASS):
       1 zero unsafe mismatches   2 all lines valid / every used summary complete   3 batchOutcomes add up to batches
       4 enough real batches (default >= 100)   5 all 10 rules seen in real traffic or listed in the synthetic file
   - --synthetic file: JSON array of rule reasons verified by documented LOCAL synthetic tests, e.g.
       ["project-delete-cascade", "re-inspection-closed-record"]   (never production data, never run against production)
   Exit codes: 0 PASS, 2 FAIL (a hard gate broke), 3 INSUFFICIENT EVIDENCE (no hard failure, but volume/coverage lacking). */
const fs = require("fs");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--synthetic" && args[args.indexOf(a) - 1] !== "--min-batches");
if (!file) { console.error("usage: node backend/reviewSaveDiag.js <log-file> [--synthetic f.json] [--min-batches N] [--json]"); process.exit(1); }
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const minBatches = Number(opt("--min-batches")) || 100;
const synthetic = opt("--synthetic") ? JSON.parse(fs.readFileSync(opt("--synthetic"), "utf8")) : [];

const REQUIRED = [
  ["approval / inspection result rewritten (inspections)", "server-modified:qualityInspections"],
  ["work-measurement link + approval", "server-modified:workMeasurements"],
  ["material-measurement approval", "server-modified:materialMeasurements"],
  ["user password hashing", "users-password"],
  ["project-delete cascade", "project-delete-cascade"],
  ["passing re-inspection closes the original's snag", "re-inspection-closed-record"],
  ["public drawing-request defaults (anonymous)", "server-modified:drawingRequests"],
  ["public DPR defaults (anonymous)", "server-modified:dpr"],
  ["public form-submission defaults (anonymous)", "server-modified:formSubmissions"],
  ["team daily report sign-off", "server-modified:teamDailyReports"]
];

let lineCount = 0, invalid = 0, tooLong = 0;
const examples = [], unsafeLines = [], summaries = new Map(); // boot -> seq -> {parts:Map, n}
for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const i = raw.indexOf("[save-diag] "); if (i < 0) continue;
  lineCount++;
  const text = raw.slice(i);
  if (text.length > 700) tooLong++;
  let o; try { o = JSON.parse(text.slice(12)); } catch { invalid++; if (raw.includes("MISMATCH-unsafe")) unsafeLines.push(text.slice(0, 300)); continue; }
  if (o.summary) {
    if (!summaries.has(o.boot)) summaries.set(o.boot, new Map());
    const b = summaries.get(o.boot); if (!b.has(o.seq)) b.set(o.seq, { n: o.parts, parts: new Map(), final: false });
    const s = b.get(o.seq); s.parts.set(o.part, o); if (o.final) s.final = true;
  } else { examples.push(o); if (o.outcome === "MISMATCH-unsafe") unsafeLines.push(text.slice(0, 400)); }
}

const total = { batches: 0, aborted: 0, suppressedUnsafe: 0, batchOutcomes: {}, reasons: {}, perCollection: {} };
const add = (acc, m) => { for (const [k, v] of Object.entries(m || {})) acc[k] = (acc[k] || 0) + v; };
let incompleteUsed = 0, badTotals = 0, bootsUsed = 0, incompleteSkipped = 0;
for (const [boot, bySeq] of summaries) {
  const seqs = [...bySeq.keys()].sort((a, b) => b - a);
  let chosen = null;
  for (const q of seqs) {
    const s = bySeq.get(q); const complete = s.n && [...Array(s.n).keys()].every((k) => s.parts.has(k + 1));
    if (complete) { chosen = s; break; } else if (!chosen) incompleteSkipped++;
  }
  if (!chosen) { incompleteUsed++; continue; }
  bootsUsed++;
  const merged = Object.assign({}, ...[...chosen.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p));
  const head = chosen.parts.get(1);
  const sum = Object.values(head.batchOutcomes || {}).reduce((a, b) => a + b, 0);
  if (sum !== head.batches) badTotals++;
  total.batches += head.batches || 0; total.aborted += head.aborted || 0; total.suppressedUnsafe += head.suppressedUnsafe || 0;
  add(total.batchOutcomes, head.batchOutcomes);
  for (const p of chosen.parts.values()) { add(total.reasons, p.reasons); add(total.perCollection, p.perCollection); }
}
const unsafeBatches = total.batchOutcomes["MISMATCH-unsafe"] || 0;
const seen = REQUIRED.filter(([, r]) => (total.reasons[r] || 0) > 0);
const viaSynthetic = REQUIRED.filter(([, r]) => !(total.reasons[r] > 0) && synthetic.includes(r));
const missing = REQUIRED.filter(([, r]) => !(total.reasons[r] > 0) && !synthetic.includes(r));

const hard = [], soft = [];
(unsafeBatches === 0 && unsafeLines.length === 0 && total.suppressedUnsafe === 0 ? [] : hard).push(`GATE 1 unsafe mismatches: counters=${unsafeBatches}, lines=${unsafeLines.length}, suppressed=${total.suppressedUnsafe}`);
(invalid === 0 && tooLong === 0 && incompleteUsed === 0 ? [] : hard).push(`GATE 2 invalid/oversized lines or boots with no complete summary: invalid=${invalid}, >700=${tooLong}, boots without complete summary=${incompleteUsed}`);
(badTotals === 0 ? [] : hard).push(`GATE 3 batchOutcomes do not add up to batches in ${badTotals} summary(ies)`);
if (total.batches < minBatches) soft.push(`GATE 4 volume: ${total.batches} compared batches < ${minBatches}`);
if (missing.length) soft.push(`GATE 5 coverage: ${missing.length} rule(s) neither seen in real traffic nor verified synthetically: ${missing.map((m) => m[1]).join(", ")}`);
const verdict = hard.length ? "FAIL" : soft.length ? "INSUFFICIENT EVIDENCE" : "PASS";
const cleanShare = total.batches ? Math.round((total.batchOutcomes["agree-clean"] || 0) / total.batches * 1000) / 10 : null;

const out = { file, lines: lineCount, invalid, tooLong, bootsUsed, incompleteSkipped, totals: total, cleanSharePct: cleanShare, rules: { seenReal: seen.map((m) => m[1]), synthetic: viaSynthetic.map((m) => m[1]), missing: missing.map((m) => m[1]) }, hardFailures: hard, insufficient: soft, unsafeLines: unsafeLines.slice(0, 10), verdict };
if (args.includes("--json")) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`Log: ${file}\n[save-diag] lines: ${lineCount} (invalid JSON: ${invalid}, longer than 700: ${tooLong})   process boots with a complete summary: ${bootsUsed}   superseded/incomplete summaries skipped: ${incompleteSkipped}`);
  console.log(`\nCompared batches: ${total.batches}   refused/failed (not compared): ${total.aborted}`);
  console.log("Batch outcomes (each batch once):", JSON.stringify(total.batchOutcomes));
  console.log(`Clean-save share (agree-clean / batches): ${cleanShare === null ? "n/a" : cleanShare + " %"}`);
  console.log("\nRule coverage (reason counts are per batch):");
  for (const [d, r] of REQUIRED) console.log(`  ${total.reasons[r] > 0 ? "REAL     " : synthetic.includes(r) ? "SYNTHETIC" : "MISSING  "} ${String(total.reasons[r] || 0).padStart(5)}  ${d}`);
  console.log("\nPer collection (a batch is counted under EACH collection it touches; NOT batch totals):");
  const pc = {}; for (const [k, v] of Object.entries(total.perCollection)) { const [o, c] = k.split("|"); (pc[c] ||= {})[o] = v; }
  for (const [c, o] of Object.entries(pc).sort()) console.log(`  ${c.padEnd(22)} ${JSON.stringify(o)}`);
  console.log("\nHard failures:", hard.length ? "" : "none"); hard.forEach((h) => console.log("  - " + h));
  console.log("Insufficient evidence:", soft.length ? "" : "none"); soft.forEach((h) => console.log("  - " + h));
  if (unsafeLines.length) { console.log("\nUNSAFE lines (names only):"); unsafeLines.slice(0, 10).forEach((l) => console.log("  " + l)); }
  console.log(`\nVERDICT: ${verdict}`);
}
process.exit(verdict === "PASS" ? 0 : verdict === "FAIL" ? 2 : 3);

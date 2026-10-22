/* Server-side mirror of frontend/src/pages/QualityInspection.tsx's own
 * generateReport() — builds the exact same QcInspectionPdfData shape, for
 * the Saturday-1pm-IST scheduled Slack send (see server.js). "All projects"
 * scope, same as generating it on the page with every filter left blank.
 */
const DAY_MS = 86400000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function parseYmd(s) {
  return new Date(s + "T00:00:00.000Z");
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** This week's Sunday-through-today (inclusive) in IST wall-clock terms —
 *  run on a Saturday, that's the full Sun-Sat week just finishing. */
function currentWeekBounds() {
  const now = istNow();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = to.getUTCDay(); // 0=Sun..6=Sat
  const from = new Date(to.getTime() - dow * DAY_MS);
  return { from: ymd(from), to: ymd(to) };
}

async function buildWeeklyQcReportData(mongoDb) {
  const bounds = currentWeekBounds();
  const periodLabel = `${fmtDate(parseYmd(bounds.from).getTime())} – ${fmtDate(parseYmd(bounds.to).getTime())}`;

  const [allInspections, allSnags] = await Promise.all([
    mongoDb.collection("qualityInspections").find({}).toArray(),
    mongoDb.collection("snags").find({}).toArray()
  ]);
  const snagById = new Map(allSnags.map((s) => [s.id, s]));

  const inRange = allInspections.filter((i) => {
    const d = (i.inspectionDate || "").slice(0, 10);
    return d >= bounds.from && d <= bounds.to;
  }).sort((a, b) => b.createdAt - a.createdAt);

  function linkedSnag(i) {
    return i.linkedSnagId ? snagById.get(i.linkedSnagId) || null : null;
  }

  const total = inRange.length;
  const pass = inRange.filter((i) => i.result === "Pass").length;
  const fail = inRange.filter((i) => i.result === "Fail").length;
  const rework = inRange.filter((i) => i.result === "Rework Required").length;
  const overdue = inRange.filter((i) => {
    const s = linkedSnag(i);
    return !!s && s.status !== "Closed" && s.dueAt && s.dueAt < Date.now();
  }).length;

  const rows = inRange.map((i) => {
    const snag = linkedSnag(i);
    const overdueRow = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
    return {
      date: i.inspectionDate,
      projectCode: i.projectCode,
      floor: i.floorName + (i.unitName ? ` / ${i.unitName}` : ""),
      workType: i.workType || "—",
      result: i.result,
      inspector: i.inspectorName,
      snagStatus: !snag ? "—" : snag.status === "Closed" ? "Resolved" : overdueRow ? "Overdue" : snag.status
    };
  });

  return {
    scopeLabel: "All projects",
    periodLabel,
    generatedAt: Date.now(),
    generatedBy: "Scheduled (Saturday 1pm IST)",
    kpis: { total, pass, fail, rework, passRate: total ? Math.round((pass / total) * 100) : 0, overdue },
    rows
  };
}

module.exports = { buildWeeklyQcReportData, currentWeekBounds };

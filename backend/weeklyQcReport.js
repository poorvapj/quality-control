/* Server-side mirror of frontend/src/pages/QualityInspection.tsx's own
 * generateReport() — builds the exact same QcInspectionPdfData shape, for
 * the daily-4pm-IST scheduled Slack send (see server.js). "All projects"
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
function fmtDateTime(ts) {
  const ist = new Date(ts + IST_OFFSET_MS);
  return `${fmtDate(ts)}, ${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}

/** Rolling 24h window ending now (the report runs once a day, at 4pm IST,
 *  so this is "yesterday 4pm IST -> today 4pm IST"). `to`/`from` here are
 *  still plain dates (used only as the once-a-day send marker key); the
 *  actual filtering below uses the precise `toTs`/`fromTs` timestamps. */
function currentWeekBounds() {
  const now = istNow();
  const toTs = Date.now();
  const fromTs = toTs - DAY_MS;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: ymd(to), to: ymd(to), fromTs, toTs };
}

async function buildWeeklyQcReportData(mongoDb) {
  const bounds = currentWeekBounds();
  const periodLabel = `${fmtDateTime(bounds.fromTs)} – ${fmtDateTime(bounds.toTs)}`;

  const [allInspections, allSnags] = await Promise.all([
    mongoDb.collection("qualityInspections").find({}).toArray(),
    mongoDb.collection("snags").find({}).toArray()
  ]);
  const snagById = new Map(allSnags.map((s) => [s.id, s]));

  const inRange = allInspections.filter((i) => {
    return i.createdAt >= bounds.fromTs && i.createdAt <= bounds.toTs;
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
  const resolved = inRange.filter((i) => {
    const s = linkedSnag(i);
    return !!s && s.status === "Closed";
  }).length;

  const rows = inRange.map((i) => {
    const snag = linkedSnag(i);
    const overdueRow = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
    return {
      date: i.inspectionDate,
      projectName: i.projectName || i.projectCode,
      floor: i.floorName + (i.unitName ? ` / ${i.unitName}` : ""),
      workType: i.workType || "—",
      result: i.result,
      inspector: i.inspectorName,
      snagStatus: !snag ? "—" : snag.status === "Closed" ? "Resolved" : overdueRow ? "Overdue" : snag.status,
      // The record's own last-decided status — not recomputed against the
      // author's CURRENT team leader (effectiveApproval() on the frontend
      // does that for the live app's own display), good enough for a
      // point-in-time weekly snapshot.
      approvalStatus: !i.approval ? "—" : i.approval.status === "approved" ? "Approved" : i.approval.status === "rejected" ? "Rejected" : "Pending"
    };
  });

  return {
    scopeLabel: "All projects",
    periodLabel,
    generatedAt: Date.now(),
    generatedBy: "Scheduled (daily 4pm IST)",
    kpis: { total, pass, fail, rework, passRate: total ? Math.round((pass / total) * 100) : 0, overdue, resolved },
    rows
  };
}

module.exports = { buildWeeklyQcReportData, currentWeekBounds };

/* Daily Team Report — one record per Team per date, summarizing what each
 * member of that team did that day (assignments completed, snags closed,
 * quality inspections run, measurements recorded). Generated server-side
 * once a day (server.js's /api/team-reports/generate, an external-cron-
 * pinged endpoint — see /api/backup/scheduled for why an in-process timer
 * can't be relied on against Render's free-tier sleep). The team's own
 * leader then signs it off from their dashboard — that approval is a
 * record only, it doesn't gate or block anything else (confirmed with the
 * person who asked for this feature).
 *
 * Pure, dependency-free logic lives here so it's unit-testable without a
 * running server or a real Mongo connection, same pattern as
 * materialMeasurementRules.js / qualityInspectionRules.js.
 */

// Same "does this user belong to this team" rule the frontend already
// enforces in Team.tsx/DriDashboard.tsx/RoleDashboard.tsx — a team
// optionally restricted to one Role can never pick up a mismatched member.
function teamMembers(users, team) {
  return (users || []).filter(
    (u) => u.teamId === team.id && u.active !== false && (!team.role || u.role === team.role)
  );
}

// `ts` is a epoch-ms timestamp; `dateStr` is "YYYY-MM-DD" in IST (UTC+5:30).
function istDateStrOf(ts) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const d = new Date(ts + IST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

function isOnDate(ts, dateStr) {
  return typeof ts === "number" && istDateStrOf(ts) === dateStr;
}

/* Builds one Team's report for one date from the full board-data blob (the
 * same shape getState() returns) — null when the team has no members (no
 * point generating an empty report nobody can sign off). */
function buildTeamDailyReport(data, team, dateStr) {
  const members = teamMembers(data.users || [], team);
  if (members.length === 0) return null;

  const assignments = data.assignments || [];
  const snags = data.snags || [];
  const qualityInspections = data.qualityInspections || [];
  const materialMeasurements = data.materialMeasurements || [];
  const workMeasurements = data.workMeasurements || [];

  const memberRows = members.map((u) => {
    const assignmentsDone = assignments.filter((a) => a.doneBy === u.id && isOnDate(a.doneAt, dateStr)).length;
    const snagsClosed = snags.filter((s) => s.closedBy === u.id && isOnDate(s.closedAt, dateStr)).length;
    const inspections = qualityInspections.filter((i) => i.inspectorUserId === u.id && i.inspectionDate === dateStr).length;
    const measurements =
      materialMeasurements.filter((m) => m.recordedByUserId === u.id && m.measurementDate === dateStr).length +
      workMeasurements.filter((m) => m.recordedByUserId === u.id && m.measurementDate === dateStr).length;
    return {
      userId: u.id,
      userName: u.name,
      assignmentsDone,
      snagsClosed,
      qualityInspections: inspections,
      measurementsRecorded: measurements
    };
  });

  const totals = memberRows.reduce(
    (t, m) => ({
      assignmentsDone: t.assignmentsDone + m.assignmentsDone,
      snagsClosed: t.snagsClosed + m.snagsClosed,
      qualityInspections: t.qualityInspections + m.qualityInspections,
      measurementsRecorded: t.measurementsRecorded + m.measurementsRecorded
    }),
    { assignmentsDone: 0, snagsClosed: 0, qualityInspections: 0, measurementsRecorded: 0 }
  );

  return {
    id: `TDR-${team.id}-${dateStr}`,
    teamId: team.id,
    teamName: team.name,
    date: dateStr,
    generatedAt: Date.now(),
    members: memberRows,
    totals,
    status: "Pending"
  };
}

function slackSummaryFor(report) {
  const t = report.totals;
  return (
    `📋 *${report.teamName}* — Daily Report for ${report.date}\n` +
    `${t.assignmentsDone} assignment(s) done · ${t.snagsClosed} snag(s) closed · ` +
    `${t.qualityInspections} inspection(s) · ${t.measurementsRecorded} measurement(s)\n` +
    `Open the app to review and approve.`
  );
}

module.exports = { teamMembers, istDateStrOf, isOnDate, buildTeamDailyReport, slackSummaryFor };

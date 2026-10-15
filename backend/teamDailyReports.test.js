const assert = require("assert");
const { teamMembers, istDateStrOf, isOnDate, buildTeamDailyReport, slackSummaryFor } = require("./teamDailyReports");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS:", name); }
  catch (e) { failed++; console.error("FAIL:", name, "-", e.message); }
}

test("teamMembers: filters to this team, active, and matching role when set", () => {
  const users = [
    { id: "U1", teamId: "T1", active: true, role: "Execution" },
    { id: "U2", teamId: "T1", active: false, role: "Execution" }, // inactive, excluded
    { id: "U3", teamId: "T1", active: true, role: "Quality" }, // wrong role, excluded
    { id: "U4", teamId: "T2", active: true, role: "Execution" } // wrong team, excluded
  ];
  const members = teamMembers(users, { id: "T1", role: "Execution" });
  assert.deepStrictEqual(members.map((u) => u.id), ["U1"]);
});

test("teamMembers: unrestricted team (no role set) admits any role", () => {
  const users = [
    { id: "U1", teamId: "T1", active: true, role: "Execution" },
    { id: "U2", teamId: "T1", active: true, role: "Quality" }
  ];
  const members = teamMembers(users, { id: "T1" });
  assert.strictEqual(members.length, 2);
});

test("istDateStrOf: converts a UTC timestamp to its IST calendar date", () => {
  // 2026-01-01 19:00 UTC == 2026-01-02 00:30 IST — crosses midnight.
  const ts = Date.UTC(2026, 0, 1, 19, 0, 0);
  assert.strictEqual(istDateStrOf(ts), "2026-01-02");
});

test("isOnDate: true only for a timestamp whose IST date matches", () => {
  const ts = Date.UTC(2026, 0, 1, 10, 0, 0); // 2026-01-01 15:30 IST
  assert.strictEqual(isOnDate(ts, "2026-01-01"), true);
  assert.strictEqual(isOnDate(ts, "2026-01-02"), false);
  assert.strictEqual(isOnDate(undefined, "2026-01-01"), false);
  assert.strictEqual(isOnDate(null, "2026-01-01"), false);
});

test("buildTeamDailyReport: null when the team has no members", () => {
  const data = { users: [], assignments: [], snags: [], qualityInspections: [], materialMeasurements: [], workMeasurements: [] };
  assert.strictEqual(buildTeamDailyReport(data, { id: "T1", name: "Quality" }, "2026-10-15"), null);
});

test("buildTeamDailyReport: aggregates each member's day across all four activity kinds", () => {
  const data = {
    users: [
      { id: "U1", name: "Alice", teamId: "T1", active: true },
      { id: "U2", name: "Bob", teamId: "T1", active: true }
    ],
    assignments: [
      { doneBy: "U1", doneAt: Date.UTC(2026, 9, 15, 5, 0) }, // 10:30 IST same day
      { doneBy: "U1", doneAt: Date.UTC(2026, 9, 14, 5, 0) }, // different day, excluded
      { doneBy: "U2", doneAt: Date.UTC(2026, 9, 15, 5, 0) }
    ],
    snags: [{ closedBy: "U1", closedAt: Date.UTC(2026, 9, 15, 5, 0) }],
    qualityInspections: [
      { inspectorUserId: "U2", inspectionDate: "2026-10-15" },
      { inspectorUserId: "U2", inspectionDate: "2026-10-14" } // excluded
    ],
    materialMeasurements: [{ recordedByUserId: "U1", measurementDate: "2026-10-15" }],
    workMeasurements: [{ recordedByUserId: "U2", measurementDate: "2026-10-15" }]
  };
  const report = buildTeamDailyReport(data, { id: "T1", name: "Quality" }, "2026-10-15");
  assert.strictEqual(report.teamId, "T1");
  assert.strictEqual(report.date, "2026-10-15");
  assert.strictEqual(report.status, "Pending");
  const alice = report.members.find((m) => m.userId === "U1");
  const bob = report.members.find((m) => m.userId === "U2");
  assert.strictEqual(alice.assignmentsDone, 1);
  assert.strictEqual(alice.snagsClosed, 1);
  assert.strictEqual(alice.measurementsRecorded, 1);
  assert.strictEqual(bob.assignmentsDone, 1);
  assert.strictEqual(bob.qualityInspections, 1);
  assert.strictEqual(bob.measurementsRecorded, 1);
  assert.deepStrictEqual(report.totals, { assignmentsDone: 2, snagsClosed: 1, qualityInspections: 1, measurementsRecorded: 2 });
});

test("buildTeamDailyReport: respects the team's role restriction", () => {
  const data = {
    users: [
      { id: "U1", name: "Alice", teamId: "T1", active: true, role: "Execution" },
      { id: "U2", name: "Carol", teamId: "T1", active: true, role: "Quality" }
    ],
    assignments: [], snags: [], qualityInspections: [], materialMeasurements: [], workMeasurements: []
  };
  const report = buildTeamDailyReport(data, { id: "T1", name: "Execution", role: "Execution" }, "2026-10-15");
  assert.strictEqual(report.members.length, 1);
  assert.strictEqual(report.members[0].userId, "U1");
});

test("slackSummaryFor: includes team name, date and all four totals", () => {
  const report = {
    teamName: "Quality",
    date: "2026-10-15",
    totals: { assignmentsDone: 3, snagsClosed: 1, qualityInspections: 5, measurementsRecorded: 0 }
  };
  const text = slackSummaryFor(report);
  assert.ok(text.includes("Quality"));
  assert.ok(text.includes("2026-10-15"));
  assert.ok(text.includes("3 assignment"));
  assert.ok(text.includes("5 inspection"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

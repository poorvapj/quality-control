import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import Card from "../ui/tw/Card";
import Table, { TableRow, TableCell } from "../ui/tw/Table";

/* Per-user activity MIS — one row per active user, across every module
 * that already tracks "who did this" (assignments, snags, quality
 * inspections, measurements, case studies), so management can see
 * productivity/activity by PERSON rather than having to open Team.tsx,
 * DriDashboard, Quality Inspection etc. separately for each one. Granted
 * per-user/per-role via Permission Matrix (module "userMis"), same as
 * Quality MIS — not hardcoded admin-only. */
export default function UserMIS() {
  const { data, currentUserId } = useApp();
  const projectIds = myProjects(data, currentUserId).map((p) => p.id);
  const allUsers = coll(data, "users").filter((u) => u.active !== false);
  const teams = coll(data, "teams");

  const [fRole, setFRole] = useState("");
  const [q, setQ] = useState("");

  const roleOptions = Array.from(new Set(allUsers.map((u) => u.role))).sort().map((r) => ({ value: r, label: r }));

  const rows = useMemo(() => {
    return allUsers
      .filter((u) => !fRole || u.role === fRole)
      .filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()))
      .map((u) => {
        const team = teams.find((t) => t.id === u.teamId) || teams.find((t) => t.leaderId === u.id) || null;
        const assignmentsDone = coll(data, "assignments").filter((a) => a.assignedTo === u.id && a.status === "Done" && projectIds.includes(a.projectId)).length;
        const openAssignments = coll(data, "assignments").filter((a) => a.assignedTo === u.id && a.status !== "Done" && projectIds.includes(a.projectId));
        const snagsRaised = coll(data, "snags").filter((s) => s.raisedBy === u.id && projectIds.includes(s.projectId)).length;
        const snagsClosed = coll(data, "snags").filter((s) => s.closedBy === u.id && projectIds.includes(s.projectId)).length;
        const openSnags = coll(data, "snags").filter((s) => s.assignedTo === u.id && s.status !== "Closed" && projectIds.includes(s.projectId));
        const inspections = coll(data, "qualityInspections").filter((i) => i.inspectorUserId === u.id);
        const fails = inspections.filter((i) => i.result !== "Pass").length;
        const measurements = coll(data, "materialMeasurements").filter((m) => m.recordedByUserId === u.id).length
          + coll(data, "workMeasurements").filter((m) => m.recordedByUserId === u.id).length;
        const caseStudies = coll(data, "caseStudies").filter((c) => c.createdByUserId === u.id).length;
        const overdue = [...openAssignments, ...openSnags].filter((x) => x.dueAt && x.dueAt < Date.now()).length;
        return {
          user: u, teamName: team?.name || "—",
          assignmentsDone, openAssignments: openAssignments.length,
          snagsRaised, snagsClosed, openSnags: openSnags.length,
          inspections: inspections.length, fails,
          measurements, caseStudies, overdue
        };
      })
      .sort((a, b) => (b.assignmentsDone + b.snagsClosed + b.inspections + b.measurements) - (a.assignmentsDone + a.snagsClosed + a.inspections + a.measurements));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers, fRole, q, data, projectIds]);

  return (
    <div>
      <div className="flex items-start gap-3 mt-0.5 mb-5">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="trend" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">Users MIS</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            Activity by person, across assignments, snags, quality inspections, measurements, and case studies.
          </div>
        </div>
      </div>

      <div className="flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[260px] grow">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Search</div>
          <input className="input" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-w-[180px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Role</div>
          <SearchDropdown value={fRole} onChange={setFRole} options={[{ value: "", label: "All roles" }, ...roleOptions]} neutralActive />
        </div>
      </div>

      <Card padded={false} className="p-[18px]">
        <Table
          columns={["Name", "Role", "Team", "Done", "Open", "Overdue", "Snags Raised", "Snags Closed", "Inspections", "Fails", "Measurements", "Case Studies"]}
          colWidths={["150px", "110px", "140px", "70px", "70px", "80px", "100px", "100px", "90px", "70px", "100px", "100px"]}
          maxHeight="600px"
        >
          {rows.map((r) => (
            <TableRow key={r.user.id}>
              <TableCell strong className="whitespace-nowrap">{r.user.name}</TableCell>
              <TableCell muted className="whitespace-nowrap">{r.user.role}</TableCell>
              <TableCell muted className="whitespace-nowrap">{r.teamName}</TableCell>
              <TableCell>{r.assignmentsDone}</TableCell>
              <TableCell>{r.openAssignments}</TableCell>
              <TableCell className={r.overdue > 0 ? "text-[var(--color-fail)] font-bold" : ""}>{r.overdue}</TableCell>
              <TableCell>{r.snagsRaised}</TableCell>
              <TableCell>{r.snagsClosed}</TableCell>
              <TableCell>{r.inspections}</TableCell>
              <TableCell className={r.fails > 0 ? "text-[var(--color-fail)]" : ""}>{r.fails}</TableCell>
              <TableCell>{r.measurements}</TableCell>
              <TableCell>{r.caseStudies}</TableCell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </div>
  );
}

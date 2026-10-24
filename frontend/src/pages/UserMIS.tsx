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

      <Card padded={false} className="p-3 md:p-[18px]">
        {/* phones: one card per person instead of a 12-column table squeezed sideways */}
        <div className="md:hidden flex flex-col gap-2.5 max-h-[600px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.user.id} className="border border-[var(--border)] rounded-radius-md p-3.5 bg-[var(--bg-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-bold leading-snug">{r.user.name}</div>
                  <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{r.user.role} · {r.teamName}</div>
                </div>
                {r.overdue > 0 && <span className="text-[11.5px] font-bold text-[var(--color-fail)] whitespace-nowrap">{r.overdue} overdue</span>}
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
                <div><span className="text-[var(--text-muted)]">Done: </span><span className="font-semibold tabular-nums">{r.assignmentsDone}</span></div>
                <div><span className="text-[var(--text-muted)]">Open: </span><span className="font-semibold tabular-nums">{r.openAssignments}</span></div>
                <div><span className="text-[var(--text-muted)]">Snags raised: </span><span className="font-semibold tabular-nums">{r.snagsRaised}</span></div>
                <div><span className="text-[var(--text-muted)]">Snags closed: </span><span className="font-semibold tabular-nums">{r.snagsClosed}</span></div>
                <div><span className="text-[var(--text-muted)]">Inspections: </span><span className="font-semibold tabular-nums">{r.inspections}</span></div>
                <div><span className="text-[var(--text-muted)]">Fails: </span><span className={"font-semibold tabular-nums" + (r.fails > 0 ? " text-[var(--color-fail)]" : "")}>{r.fails}</span></div>
                <div><span className="text-[var(--text-muted)]">Measurements: </span><span className="font-semibold tabular-nums">{r.measurements}</span></div>
                <div><span className="text-[var(--text-muted)]">Case Studies: </span><span className="font-semibold tabular-nums">{r.caseStudies}</span></div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden md:block">
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
        </div>
      </Card>
    </div>
  );
}

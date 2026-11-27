import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import MobileFilterBar from "../components/MobileFilterBar";
import Card from "../ui/tw/Card";
import Table, { TableRow, TableCell } from "../ui/tw/Table";

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1m";
  const d = Math.floor(mins / (60 * 24));
  const h = Math.floor((mins % (60 * 24)) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Per-user "planned vs actual" MIS — one row per active user, over
 *  assignments + snags due in the selected period (default: this week).
 *  "Planned" = items due in the window; SLA breakdown and avg delay/TAT
 *  are derived straight from each item's own dueAt/doneAt-or-closedAt, the
 *  same fields every other overdue/SLA computation in the app already
 *  reads — no new tracking, nothing stored, purely a read-time rollup.
 *  Granted per-user/per-role via Permission Matrix (module "userMis"). */
export default function UserMIS() {
  const { data, currentUserId, ensureHeavy } = useApp();
  useEffect(() => { ensureHeavy(["qualityInspections"]); }, [ensureHeavy]);
  const projectIds = myProjects(data, currentUserId).map((p) => p.id);
  const allUsers = coll(data, "users").filter((u) => u.active !== false);
  const teams = coll(data, "teams");

  const [fRole, setFRole] = useState("");
  const [q, setQ] = useState("");
  const defaultFrom = fmtDate(startOfWeek(new Date()));
  const defaultTo = fmtDate(new Date());
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  const roleOptions = Array.from(new Set(allUsers.map((u) => u.role))).sort().map((r) => ({ value: r, label: r }));
  const fromTs = new Date(fromDate).getTime();
  const toTs = new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1;
  const now = Date.now();

  const rows = useMemo(() => {
    return allUsers
      .filter((u) => !fRole || u.role === fRole)
      .filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()))
      .map((u) => {
        const team = teams.find((t) => t.id === u.teamId) || teams.find((t) => t.leaderId === u.id) || null;

        // "Planned" work for this person in the window: assignments + snags
        // whose due date falls inside it (an item with no due date was never
        // on a schedule, so it can't be planned/overdue either way).
        const allAssignments = coll(data, "assignments").filter((a) => a.assignedTo === u.id && projectIds.includes(a.projectId) && a.dueAt && a.dueAt >= fromTs && a.dueAt <= toTs);
        const allSnags = coll(data, "snags").filter((s) => s.assignedTo === u.id && projectIds.includes(s.projectId) && s.dueAt && s.dueAt >= fromTs && s.dueAt <= toTs);
        const planned = [
          ...allAssignments.map((a) => ({ dueAt: a.dueAt as number, assignedAt: a.assignedAt, doneAt: a.status === "Done" ? a.doneAt : null })),
          ...allSnags.map((s) => ({ dueAt: s.dueAt as number, assignedAt: s.raisedAt, doneAt: s.status === "Closed" ? (s.closedAt || s.resolvedAt) : null }))
        ];

        const done = planned.filter((x) => x.doneAt);
        const notDone = planned.filter((x) => !x.doneAt);
        const doneOnTime = done.filter((x) => (x.doneAt as number) <= x.dueAt);
        const doneNotOnTime = done.filter((x) => (x.doneAt as number) > x.dueAt);
        const slaBreached = notDone.filter((x) => x.dueAt < now);

        const avgDelayMs = slaBreached.length ? slaBreached.reduce((sum, x) => sum + (now - x.dueAt), 0) / slaBreached.length : 0;
        const tatSamples = done.filter((x) => x.assignedAt);
        const avgTatMs = tatSamples.length ? tatSamples.reduce((sum, x) => sum + ((x.doneAt as number) - (x.assignedAt as number)), 0) / tatSamples.length : 0;
        const ratePct = planned.length ? Math.round(-(notDone.length / planned.length) * 1000) / 10 : 0;

        const pct = (n: number) => planned.length ? Math.round((n / planned.length) * 1000) / 10 : 0;

        return {
          user: u, teamName: team?.name || "—",
          planned: planned.length, done: done.length, notDone: notDone.length, notDonePct: pct(notDone.length),
          doneOnTime: doneOnTime.length, doneOnTimePct: pct(doneOnTime.length),
          doneNotOnTime: doneNotOnTime.length, doneNotOnTimePct: pct(doneNotOnTime.length),
          slaBreached: slaBreached.length,
          avgDelayMs, avgTatMs, ratePct
        };
      })
      .sort((a, b) => b.planned - a.planned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers, fRole, q, data, projectIds, fromTs, toTs]);

  return (
    <div>
      <div className="flex items-start gap-3 mt-0.5 mb-5">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="trend" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">Users MIS</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            Planned vs actual per user, for the selected period — assignments + snags due in that window.
          </div>
        </div>
      </div>

      <div className="hidden md:flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[260px] grow">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Search</div>
          <input className="input" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-w-[180px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Role</div>
          <SearchDropdown value={fRole} onChange={setFRole} options={[{ value: "", label: "All roles" }, ...roleOptions]} neutralActive />
        </div>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">From</div>
          <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">To</div>
          <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      <MobileFilterBar activeCount={(fRole ? 1 : 0) + (fromDate !== defaultFrom ? 1 : 0) + (toDate !== defaultTo ? 1 : 0)} search={{ value: q, onChange: setQ, placeholder: "Search by name…" }}>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Role</div>
          <SearchDropdown value={fRole} onChange={setFRole} options={[{ value: "", label: "All roles" }, ...roleOptions]} neutralActive />
        </div>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">From</div>
          <input type="date" className="input w-full" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">To</div>
          <input type="date" className="input w-full" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </MobileFilterBar>

      <Card padded={false} className="p-3 md:p-[18px]">
        {/* phones: one card per person instead of a wide table squeezed sideways */}
        <div className="md:hidden flex flex-col gap-2.5 max-h-[600px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.user.id} className="border border-[var(--border)] rounded-radius-md p-3.5 bg-[var(--bg-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-bold leading-snug">{r.user.name}</div>
                  <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{r.user.role} · {r.teamName}</div>
                </div>
                <span className={"text-[11.5px] font-bold whitespace-nowrap" + (r.ratePct < 0 ? " text-[var(--color-fail)]" : " text-[var(--color-pass)]")}>{r.ratePct > 0 ? "+" : ""}{r.ratePct}%</span>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
                <div><span className="text-[var(--text-muted)]">Planned: </span><span className="font-semibold tabular-nums">{r.planned}</span></div>
                <div><span className="text-[var(--text-muted)]">Done: </span><span className="font-semibold tabular-nums">{r.done}</span></div>
                <div><span className="text-[var(--text-muted)]">Not done: </span><span className={"font-semibold tabular-nums" + (r.notDone > 0 ? " text-[var(--color-fail)]" : "")}>{r.notDone} ({r.notDonePct}%)</span></div>
                <div><span className="text-[var(--text-muted)]">On time: </span><span className="font-semibold tabular-nums">{r.doneOnTime} ({r.doneOnTimePct}%)</span></div>
                <div><span className="text-[var(--text-muted)]">Late: </span><span className="font-semibold tabular-nums">{r.doneNotOnTime} ({r.doneNotOnTimePct}%)</span></div>
                <div><span className="text-[var(--text-muted)]">SLA breach: </span><span className={"font-semibold tabular-nums" + (r.slaBreached > 0 ? " text-[var(--color-fail)]" : "")}>{r.slaBreached}</span></div>
                <div><span className="text-[var(--text-muted)]">Avg delay: </span><span className="font-semibold tabular-nums">{fmtDuration(r.avgDelayMs)}</span></div>
                <div><span className="text-[var(--text-muted)]">Avg TAT: </span><span className="font-semibold tabular-nums">{fmtDuration(r.avgTatMs)}</span></div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden md:block">
          <Table
            columns={["Name", "Role", "Team", "Planned", "Done", "Not Done", "Done On Time", "Done Not On Time", "SLA Breached", "Avg Delay", "Avg TAT", "Rate %"]}
            colWidths={["150px", "110px", "140px", "80px", "80px", "100px", "120px", "130px", "100px", "100px", "90px", "80px"]}
            maxHeight="600px"
          >
            {rows.map((r) => (
              <TableRow key={r.user.id}>
                <TableCell strong className="whitespace-nowrap">{r.user.name}</TableCell>
                <TableCell muted className="whitespace-nowrap">{r.user.role}</TableCell>
                <TableCell muted className="whitespace-nowrap">{r.teamName}</TableCell>
                <TableCell>{r.planned}</TableCell>
                <TableCell>{r.done}</TableCell>
                <TableCell className={r.notDone > 0 ? "text-[var(--color-fail)] font-bold" : ""}>{r.notDone > 0 ? `${r.notDone} (${r.notDonePct}%)` : "—"}</TableCell>
                <TableCell>{r.doneOnTime > 0 ? `${r.doneOnTime} (${r.doneOnTimePct}%)` : "—"}</TableCell>
                <TableCell>{r.doneNotOnTime > 0 ? `${r.doneNotOnTime} (${r.doneNotOnTimePct}%)` : "—"}</TableCell>
                <TableCell className={r.slaBreached > 0 ? "text-[var(--color-fail)] font-bold" : ""}>{r.slaBreached || "—"}</TableCell>
                <TableCell>{fmtDuration(r.avgDelayMs)}</TableCell>
                <TableCell>{fmtDuration(r.avgTatMs)}</TableCell>
                <TableCell className={r.ratePct < 0 ? "text-[var(--color-fail)] font-bold" : r.ratePct > 0 ? "text-[var(--color-pass)] font-bold" : ""}>{r.ratePct > 0 ? "+" : ""}{r.ratePct}%</TableCell>
              </TableRow>
            ))}
          </Table>
        </div>
      </Card>
    </div>
  );
}

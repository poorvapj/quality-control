import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel } from "../shared/rules";
import { fmtDT, ago } from "../shared/helpers";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { EventLog } from "../types";

export const ACTION_LABEL: Record<string, string> = {
  ACK: "Release acknowledged",
  START: "Work started",
  COMPLETE: "Stage completed",
  QC_FAIL: "QC gate failed",
  QC_PASS: "QC gate passed",
  MEASURE: "Hidden work measured",
  ASSIGN: "Work assigned",
  ASSIGN_ASSIGNED: "Reassigned",
  ASSIGN_ACCEPTED: "Assignment accepted",
  ASSIGN_DONE: "Assignment marked done",
  SNAG_RAISE: "Snag raised",
  SNAG_REOPEN: "Snag reopened",
  SNAG_REASSIGN: "Snag reassigned",
  SNAG_OPEN: "Snag reopened as Open",
  SNAG_IN_PROGRESS: "Snag marked In Progress",
  SNAG_CLOSED: "Snag closed",
  DPR_SUBMIT: "Daily Progress Report submitted",
  DR_CREATE: "Drawing request created",
  DR_FORWARD_STAGE2: "Forwarded to production (Stage 2)",
  DR_RETURN_STAGE1: "Returned at Stage 1",
  DR_SUBMIT_STAGE2: "Submitted for cross-check (Stage 3)",
  DR_STAGE3_APPROVE: "Cross-check passed (Stage 4)",
  DR_STAGE3_REJECT: "Sent back to Stage 2 (Stage 3)",
  DR_STAGE4_APPROVE: "Final approval granted",
  DR_STAGE4_REJECT: "Sent back to Stage 2 (Stage 4)",
  DR_RESUBMIT: "Ticket resubmitted",
  DR_TRACKING_UPDATE: "Tracking updated",
  MASTER_SAVE: "Master record saved",
  MASTER_DELETE: "Master record deleted",
  PERMISSION_UPDATE: "Permission matrix updated",
  BACKUP_CREATE: "Backup created",
  BACKUP_RESTORE: "Backup restored",
  BACKUP_DELETE: "Backup deleted"
};

/* Modules with an empty `actions` list have no corresponding entry in the
   `events` collection at all yet (nothing in the app currently calls
   logEvent() for them) — shown honestly as "0 logs" rather than inventing
   activity, same as the reference layout's genuinely-unused modules.

   Every action string this list covers must match exactly what
   hooks/useActions.ts's logEvent() calls actually emit — a few were found
   missing from this list during an audit (SNAG_REASSIGN, the
   SNAG_OPEN/IN_PROGRESS/CLOSED status-change events, ASSIGN_ASSIGNED, and
   MEASURE), which meant those real, already-logged events were simply
   unreachable from every module card. Keep this in sync if useActions.ts
   ever adds a new logEvent() action. */
interface ModuleDef { key: string; label: string; desc: string; icon: string; actions: string[] }
const MODULES: ModuleDef[] = [
  { key: "workProgress", label: "Work Progress", desc: "Stage acknowledgements, starts, completions, QC gates, and hidden-work measurements", icon: "board", actions: ["ACK", "START", "COMPLETE", "QC_FAIL", "QC_PASS", "MEASURE"] },
  { key: "assignments", label: "Assignments", desc: "Work handed off, accepted, reassigned, and marked done", icon: "work", actions: ["ASSIGN", "ASSIGN_ASSIGNED", "ASSIGN_ACCEPTED", "ASSIGN_DONE"] },
  { key: "snags", label: "Snags", desc: "Quality defects raised, reassigned, reopened, and status changes", icon: "snags", actions: ["SNAG_RAISE", "SNAG_REOPEN", "SNAG_REASSIGN", "SNAG_OPEN", "SNAG_IN_PROGRESS", "SNAG_CLOSED"] },
  {
    key: "drawingRequests", label: "Drawing Requests", desc: "Drawing request review chain", icon: "drawing",
    actions: ["DR_CREATE", "DR_FORWARD_STAGE2", "DR_RETURN_STAGE1", "DR_SUBMIT_STAGE2", "DR_STAGE3_APPROVE", "DR_STAGE3_REJECT", "DR_STAGE4_APPROVE", "DR_STAGE4_REJECT", "DR_RESUBMIT", "DR_TRACKING_UPDATE"]
  },
  { key: "dpr", label: "Daily Progress Reports", desc: "Site DPR submissions", icon: "dpr", actions: ["DPR_SUBMIT"] },
  { key: "masters", label: "Masters", desc: "Project/Floor/Unit/Stage configuration", icon: "masters", actions: ["MASTER_SAVE", "MASTER_DELETE"] },
  { key: "users", label: "Users", desc: "User accounts and roles", icon: "team", actions: [] },
  { key: "permissionMatrix", label: "Permission Matrix", desc: "Admin-managed per-user, per-module access grants", icon: "permissions", actions: ["PERMISSION_UPDATE"] },
  { key: "backups", label: "Backups", desc: "Board backups and restores", icon: "database", actions: ["BACKUP_CREATE", "BACKUP_RESTORE", "BACKUP_DELETE"] }
];

function moduleEvents(events: EventLog[], mod: ModuleDef): EventLog[] {
  return events.filter((e) => mod.actions.includes(e.action));
}

export default function AuditLog() {
  const { data, currentUserId } = useApp();
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fAction, setFAction] = useState("");
  const [fUser, setFUser] = useState("");

  const users = coll(data, "users");
  const allEvents = (data?.events || []).slice().sort((a, b) => b.ts - a.ts);

  if (!moduleKey) {
    return (
      <div>
        <PageHeader icon="clock" title="Audit Logs" desc="Complete record of who did what, and when — pick a module to see its activity." />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MODULES.map((mod) => {
            const evs = moduleEvents(allEvents, mod);
            const last = evs[0]?.ts;
            return (
              <Card
                key={mod.key}
                className="cursor-pointer transition-shadow hover:shadow-[var(--shadow-drawer)] hover:border-[var(--border-strong)] flex flex-col h-[158px]"
                onClick={() => setModuleKey(mod.key)}
              >
                <div className="w-8 h-8 shrink-0 rounded-radius-sm bg-primary-light text-primary flex items-center justify-center mb-2.5">
                  <NavIcon name={mod.icon} size={15} />
                </div>
                <div className="text-[13.5px] font-bold">{mod.label}</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug line-clamp-3 flex-1">{mod.desc}</div>
                <div className="flex items-center justify-between text-[11.5px] pt-2.5 mt-2.5 border-t border-[var(--border)]">
                  <span className="font-bold text-[var(--text-main)]">{evs.length} log{evs.length === 1 ? "" : "s"}</span>
                  <span className="text-[var(--text-muted)]">{last ? fmtDT(last) : "—"}</span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  const mod = MODULES.find((m) => m.key === moduleKey)!;
  const scoped = moduleEvents(allEvents, mod);
  const actionOptions = Array.from(new Set(scoped.map((e) => e.action))).sort();

  let rows = scoped;
  if (fAction) rows = rows.filter((e) => e.action === fAction);
  if (fUser) rows = rows.filter((e) => e.userId === fUser);
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter((e) =>
      (e.detail + " " + e.action + " " + refLabel(data, "users", e.userId)).toLowerCase().includes(ql)
    );
  }

  const ROW_CAP = 300;
  const shown = rows.slice(0, ROW_CAP);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <PageHeader icon={mod.icon} title={mod.label} desc={mod.desc} bare />
        <Btn label="‹ All modules" color="secondary" size="sm" onClick={() => { setModuleKey(null); setQ(""); setFAction(""); setFUser(""); }} />
      </div>

      {scoped.length === 0 ? (
        <Card className="text-center text-[13px] text-[var(--text-muted)]">No activity logged for this module yet.</Card>
      ) : (
        <>
          <Card className="flex gap-3 flex-wrap mb-5">
            <input className="input flex-1 min-w-[180px]" placeholder="Search by detail, action, or user…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="w-[190px]">
              <SearchDropdown
                value={fAction}
                onChange={setFAction}
                options={[{ value: "", label: "All actions" }, ...actionOptions.map((a) => ({ value: a, label: ACTION_LABEL[a] || a }))]}
                neutralActive
              />
            </div>
            <div className="w-[190px]">
              <SearchDropdown
                value={fUser}
                onChange={setFUser}
                options={[{ value: "", label: "Everyone" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
                neutralActive
              />
            </div>
          </Card>

          <Card padded={false} className="p-[18px]">
            {shown.length === 0 ? (
              <div className="py-6 text-center text-[var(--text-muted)] text-[13px]">No events match these filters.</div>
            ) : (
              <Table columns={["Date & Time", "User", "Action", "Details"]}>
                {shown.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell muted className="whitespace-nowrap" >
                      <span title={fmtDT(e.ts)}>{ago(e.ts)}</span>
                    </TableCell>
                    <TableCell strong>{e.userId === currentUserId ? "You" : refLabel(data, "users", e.userId)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                        {ACTION_LABEL[e.action] || e.action}
                      </span>
                    </TableCell>
                    <TableCell muted>{e.detail}</TableCell>
                  </TableRow>
                ))}
              </Table>
            )}
            {rows.length > ROW_CAP && (
              <div className="text-[11px] text-[var(--text-muted)] pt-3 mt-1">
                Showing the {ROW_CAP} most recent of {rows.length} matching events — narrow the filters above to see older ones.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function PageHeader({ icon, title, desc, bare }: { icon: string; title: string; desc: string; bare?: boolean }) {
  return (
    <div className={"flex gap-3.5 items-start min-w-0" + (bare ? "" : " mt-0.5 mb-6")}>
      <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
        <NavIcon name={icon} size={20} />
      </div>
      <div>
        <div className="text-xl font-semibold tracking-tight leading-tight">{title}</div>
        <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">{desc}</div>
      </div>
    </div>
  );
}

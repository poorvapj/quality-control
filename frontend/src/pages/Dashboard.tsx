import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { SEVERITIES } from "../services/config";
import {
  coll, projectUnits, projectFloors, floorUnits, unitSummary, slowHandoffs, floorReleased,
  myAssignments, mySnags, refLabel, prog, trackStages
} from "../shared/rules";
import { type DateRange, DATE_RANGES, isoWeekBounds, dateRangeBounds, tsInBounds } from "../shared/dateRange";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import CalendarRangePicker from "../components/CalendarRangePicker";
import WeekPicker from "../components/WeekPicker";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import Field from "../ui/tw/Field";
import type { BoardData, Floor, TabKey } from "../types";

const FLOOR_LIST_CAP = 40;
const ALL_PROJECTS_VALUE = "__all__";

/** The timestamp a unit/floor's final stage was marked done — its real
 *  "handed over"/"cured" moment — or null if it isn't complete yet. */
function completionAt(data: BoardData | null, projectId: string | null, track: "unit" | "floor", targetId: string): number | null {
  const list = trackStages(data, projectId, track);
  const last = list[list.length - 1];
  if (!last) return null;
  const p = prog(data, targetId, last.stage.id);
  return p.status === "done" ? p.at ?? null : null;
}

/* This page has been converted to Tailwind utilities (+ ui/tw/ primitives)
   as the pilot for the app-wide migration — see the plan file for why
   `ui/tw/` exists as a separate subfolder from the pre-existing plain-CSS
   `ui/` components (Field/Btn/Card/Badge already live elsewhere, e.g.
   DrawingRequestForm.tsx). Every other page still uses the old
   index.css classes and is unaffected by this. */
export default function Dashboard() {
  const { data, currentProjectId, setCurrentProjectId, currentUserId, me, openDrawer, setActiveTab } = useApp();
  const slowSectionRef = useRef<HTMLDivElement>(null);
  const allProjects = coll(data, "projects").filter((p) => p.active !== false);
  // Dashboard-only "All Projects" view, owned entirely by this page.
  // Deliberately NOT stored on currentProjectId — that value is shared by
  // Tower Board/My Work/Snags, none of which have an "all projects" mode,
  // so it must always stay a real single project id for them regardless of
  // what this page is showing.
  const [viewAllProjects, setViewAllProjects] = useState(true);
  const [floorPage, setFloorPage] = useState(0);

  // Date-range filter — same preset set/logic as Daily Progress Report's
  // filter bar (frontend/src/shared/dateRange.ts), reused here so both
  // pages behave identically.
  const [fRange, setFRange] = useState<DateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  const nowForWeek = new Date();
  const [weekYear, setWeekYear] = useState(nowForWeek.getFullYear());
  const [weekNum, setWeekNum] = useState(1);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const weekWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!calendarOpen) return;
    function onDocClick(e: MouseEvent) {
      if (calendarWrapRef.current && !calendarWrapRef.current.contains(e.target as Node)) setCalendarOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [calendarOpen]);

  useEffect(() => {
    if (!weekPickerOpen) return;
    function onDocClick(e: MouseEvent) {
      if (weekWrapRef.current && !weekWrapRef.current.contains(e.target as Node)) setWeekPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [weekPickerOpen]);

  const bounds = fRange === "custom"
    ? (customFrom || customTo ? { from: customFrom || "0000-01-01", to: customTo || "9999-12-31" } : null)
    : fRange === "weekNumber"
    ? isoWeekBounds(weekYear, weekNum)
    : dateRangeBounds(fRange);

  // "All Projects" combines real per-project results — each helper below is
  // still called once per real project (never with a null/empty projectId),
  // so a floor's own project always drives its own stage list. No shared
  // rule function had to change to make this work.
  const projectIds = viewAllProjects ? allProjects.map((p) => p.id) : [currentProjectId];

  const units = projectIds.flatMap((pid) => projectUnits(data, pid));
  const unitEntries = projectIds.flatMap((pid) => projectUnits(data, pid).map((u) => ({ pid, u, s: unitSummary(data, pid, u.id) })));
  const handed = unitEntries.filter((e) => e.s.complete && tsInBounds(completionAt(data, e.pid, "unit", e.u.id), bounds)).length;
  const stagesTotal = unitEntries.reduce((a, e) => a + e.s.total, 0) || 1;
  const stagesDone = unitEntries.reduce((a, e) => a + e.s.done, 0);
  const pct = Math.round((stagesDone / stagesTotal) * 100);
  // How many not-yet-complete units have an open snag sitting on them right
  // now — surfaced on the KPI card so a stalled % has a visible reason
  // instead of looking like it's just not moving for no reason. The %
  // itself stays a pure done/total count — closing a snag still requires
  // the explicit "Mark complete" action on its gate stage, same as always.
  const snagBlockedUnits = unitEntries.filter((e) => !e.s.complete && e.s.snags > 0).length;
  const openSnags = (viewAllProjects
    ? coll(data, "snags").filter((s) => s.status !== "Closed")
    : coll(data, "snags").filter((s) => s.status !== "Closed" && s.projectId === currentProjectId)
  ).filter((s) => tsInBounds(s.raisedAt, bounds));
  const critical = openSnags.filter((s) => s.severity === "Critical").length;
  const slow = projectIds.flatMap((pid) => slowHandoffs(data, pid))
    .filter((s) => tsInBounds(prog(data, s.targetId, s.stage.id).rel, bounds))
    .sort((a, b) => b.hrs - a.hrs);
  const floors: Floor[] = projectIds.flatMap((pid) => projectFloors(data, pid));
  const castFloors = floors.filter((f) => floorReleased(data, f.projectId, f.id) && tsInBounds(completionAt(data, f.projectId, "floor", f.id), bounds)).length;

  // Each card navigates somewhere useful — Tower Board for unit/floor
  // status, Snags for the open-snag register, and Slow Handoffs smooth-
  // scrolls to that section further down this same page (there's no
  // separate page for it) rather than navigating away.
  const stats = [
    {
      label: "UNITS HANDED OVER", val: `${handed}/${units.length}`, tone: "ok" as const, icon: "award",
      foot: pct + "% of all stages complete" + (snagBlockedUnits > 0 ? ` · ${snagBlockedUnits} unit${snagBlockedUnits === 1 ? "" : "s"} blocked by open snags` : ""),
      onClick: () => setActiveTab("board" as TabKey)
    },
    { label: "OPEN SNAGS", val: openSnags.length, tone: openSnags.length > 0 ? "bad" as const : undefined, icon: "bug", foot: critical + " critical", onClick: () => setActiveTab("snags" as TabKey) },
    {
      label: "SLOW HANDOFFS", val: slow.length, tone: slow.length > 0 ? "warn" as const : undefined, icon: "clock", foot: "Released past SLA, not acknowledged",
      onClick: slow.length > 0 ? () => slowSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }) : undefined
    },
    { label: "FLOORS CURED", val: `${castFloors}/${floors.length}`, tone: undefined, icon: "board", foot: "Bottom-up casting enforced", onClick: () => setActiveTab("board" as TabKey) }
  ];
  const STAT_VAL_CLS: Record<string, string> = {
    ok: "text-[var(--text-main)]", bad: "text-[var(--color-fail)]", warn: "text-[var(--color-gate)]"
  };

  const asg = projectIds.flatMap((pid) => myAssignments(data, pid, currentUserId)).filter((a) => tsInBounds(a.assignedAt, bounds));
  const sng = projectIds.flatMap((pid) => mySnags(data, pid, currentUserId)).filter((s) => tsInBounds(s.raisedAt, bounds));
  const myOpen = asg.length + sng.length;
  const bySeverity = SEVERITIES.map((sev) => ({ sev, n: openSnags.filter((s) => s.severity === sev).length }));

  // Capping this list only matters in "All Projects" mode (290 floors is
  // too many to render). A plain slice() would just show every floor of
  // whichever project happens to sort last — not remotely "latest" activity
  // since floors have no timestamp. Instead, round-robin one floor per
  // project per pass (each project's own floors already ordered highest
  // first via projectFloors' seq sort + our own reverse), so every project
  // gets fair representation instead of one project dominating the list.
  // NOTE: this list itself is intentionally NOT date-filtered — a floor is a
  // long-lived record, not a dated event, so there's no "raised on"/"cast
  // on" moment on the record itself to filter by (unlike snags/assignments).
  // Full ordered list (no cap) — same "spread across every project, highest
  // floor first" ordering as before, just no longer truncated here. Paged
  // below instead, so every floor is reachable a page at a time rather than
  // the first 40 being the only ones ever shown.
  const orderedFloors: Floor[] = (() => {
    if (!viewAllProjects) return floors.slice().reverse();
    const byProject = new Map<string, Floor[]>();
    for (const f of floors) {
      const list = byProject.get(f.projectId) || [];
      list.push(f);
      byProject.set(f.projectId, list);
    }
    for (const list of byProject.values()) list.reverse(); // highest floor first, per project
    const lists = Array.from(byProject.values());
    const out: Floor[] = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) {
      for (const list of lists) {
        if (i < list.length) out.push(list[i]);
      }
    }
    return out;
  })();
  const floorPageCount = Math.max(1, Math.ceil(orderedFloors.length / FLOOR_LIST_CAP));
  const floorRows: Floor[] = orderedFloors.slice(floorPage * FLOOR_LIST_CAP, (floorPage + 1) * FLOOR_LIST_CAP);

  // Reset to page 1 whenever the underlying floor set changes shape (project
  // filter flipped, or a page became out of range) — never leave the user
  // staring at a blank page 5 after switching to a project with 2 floors.
  useEffect(() => {
    setFloorPage((p) => Math.min(p, floorPageCount - 1));
  }, [viewAllProjects, currentProjectId, floorPageCount]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-6">
        <div className="flex gap-3.5 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="dashboard" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Dashboard</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              {viewAllProjects
                ? "Combined KPIs, what needs you, and floor-by-floor progress across all projects."
                : "Site-wide KPIs, what needs you, and floor-by-floor progress."}
            </div>
          </div>
        </div>
      </div>

      <Card className="flex gap-3.5 flex-wrap mb-6">
        <div className="max-w-[220px]">
          <Field label="Active Project">
            <SearchDropdown
              value={viewAllProjects ? ALL_PROJECTS_VALUE : (currentProjectId ?? "")}
              onChange={(v) => {
                if (v === ALL_PROJECTS_VALUE) { setViewAllProjects(true); return; }
                setViewAllProjects(false);
                setCurrentProjectId(v);
              }}
              options={[{ value: ALL_PROJECTS_VALUE, label: "All Projects" }, ...allProjects.map((p) => ({ value: p.id, label: p.name }))]}
              neutralActive
            />
          </Field>
        </div>
        <div className="min-w-[150px]">
          <Field label="Date Range">
            <SearchDropdown
              icon="calendar"
              searchable={false}
              scrollable={false}
              value={fRange}
              onChange={(v) => setFRange(v as DateRange)}
              options={DATE_RANGES.map((r) => ({ value: r.key, label: r.label }))}
            />
          </Field>
        </div>
        {fRange === "custom" && (
          <div className="min-w-[190px] relative" ref={calendarWrapRef}>
            <Field label="Range">
              <button type="button" className="select text-left" onClick={() => setCalendarOpen((o) => !o)}>
                {customFrom && customTo ? customFrom + "  →  " + customTo : "Pick dates"}
              </button>
            </Field>
            {calendarOpen && (
              <CalendarRangePicker
                from={customFrom}
                to={customTo}
                onCancel={() => setCalendarOpen(false)}
                onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setCalendarOpen(false); }}
              />
            )}
          </div>
        )}
        {fRange === "weekNumber" && (
          <div className="min-w-[170px] relative" ref={weekWrapRef}>
            <Field label="Week">
              <button type="button" className="select text-left" onClick={() => setWeekPickerOpen((o) => !o)}>
                Wk {weekNum}, {weekYear}
              </button>
            </Field>
            {weekPickerOpen && (
              <WeekPicker
                year={weekYear}
                week={weekNum}
                onYearChange={setWeekYear}
                onPickWeek={(w) => { setWeekNum(w); setWeekPickerOpen(false); }}
                onBack={() => setWeekPickerOpen(false)}
              />
            )}
          </div>
        )}
      </Card>

      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-sub)] mb-1">KPI OVERVIEW</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-7">
        {stats.map((s) => (
          <Card
            key={s.label}
            className={"relative transition-shadow" + (s.onClick ? " cursor-pointer" : "")}
            onClick={s.onClick}
          >
            <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-sub)] mb-1">{s.label}</div>
            <div className={`text-[32px] font-extrabold mt-1.5 tracking-tight ${s.tone ? STAT_VAL_CLS[s.tone] : "text-[var(--text-main)]"}`}>{s.val}</div>
            <div className="text-[10px] text-[var(--text-sub)] mt-1 font-semibold">{s.foot}</div>
            <div className="absolute top-3.5 right-3.5 w-8 h-8 rounded-radius-sm bg-[var(--bg-subtle)] text-[var(--text-muted)] flex items-center justify-center">
              <NavIcon name={s.icon} size={15} />
            </div>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap my-7">
        <div className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-block grayscale opacity-70"><NavIcon name="pin" size={14} /></span> WHAT NEEDS ME
        </div>
        <div className="text-[11px] text-[var(--text-muted)] font-medium">{myOpen} open item{myOpen === 1 ? "" : "s"} for {me()?.name || ""}</div>
      </div>
      <Card padded={false}>
        {myOpen === 0
          ? <div className="py-7.5 px-5 text-center text-[var(--text-muted)] text-[13px]">🎉 Nothing assigned to you right now.</div>
          : <>{asg.slice(0, 4).map((a) => <AssignRow key={a.id} a={a} />)}{sng.slice(0, 4).map((s) => <SnagRow key={s.id} s={s} />)}</>}
      </Card>

      {slow.length > 0 && (
        <div ref={slowSectionRef}>
          <div className="flex items-center justify-between gap-3 flex-wrap my-7">
            <div className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block grayscale opacity-70"><NavIcon name="clock" size={14} /></span> SLOW HANDOFFS
            </div>
            <div className="text-[11px] text-[var(--text-muted)] font-medium">Released to a trade but never acknowledged — these are the huddle agenda</div>
          </div>
          <Card padded={false}>
            {slow.slice(0, 6).map((s, i) => {
              const name = s.targetType === "unit" ? refLabel(data, "units", s.targetId) : refLabel(data, "floors", s.targetId);
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 py-3.5 px-4 border-b border-[var(--border)] cursor-pointer transition-colors border-l-4 border-l-[var(--color-gate)] bg-[rgba(249,115,22,0.05)]"
                  onClick={() => openDrawer({ kind: s.targetType, id: s.targetId })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">{name} · {s.stage.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-normal">Waiting {Math.round(s.hrs)}h · SLA {s.sla}h · owner role {s.stage.role}</div>
                  </div>
                  <Badge color="amber">{Math.round(s.hrs - s.sla)}h OVER</Badge>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap my-7">
        <div className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-block grayscale opacity-70"><NavIcon name="trend" size={14} /></span> FLOOR PROGRESS
        </div>
        {orderedFloors.length > FLOOR_LIST_CAP && (
          <div className="flex items-center gap-2.5">
            <div className="text-[11px] text-[var(--text-muted)] font-medium">
              Floors {floorPage * FLOOR_LIST_CAP + 1}–{Math.min(orderedFloors.length, (floorPage + 1) * FLOOR_LIST_CAP)} of {orderedFloors.length}
              {viewAllProjects ? " — a spread across every project, not just one" : ""}
            </div>
            <div className="flex gap-1">
              <Btn color="secondary" size="sm" label="‹ Prev" disabled={floorPage === 0} onClick={() => setFloorPage((p) => Math.max(0, p - 1))} />
              <Btn color="secondary" size="sm" label="Next ›" disabled={floorPage >= floorPageCount - 1} onClick={() => setFloorPage((p) => Math.min(floorPageCount - 1, p + 1))} />
            </div>
          </div>
        )}
      </div>
      <Card>
        {floorRows.map((f) => {
          const us = floorUnits(data, f.projectId, f.id);
          const s = us.map((u) => unitSummary(data, f.projectId, u.id));
          const d = s.reduce((a, x) => a + x.done, 0);
          const t = s.reduce((a, x) => a + x.total, 0) || 1;
          const p = Math.round((d / t) * 100);
          const released = floorReleased(data, f.projectId, f.id);
          return (
            <div key={f.id} className="mb-2.5 last:mb-0">
              <div className="flex justify-between text-[11.5px] font-bold">
                <span>
                  {viewAllProjects ? refLabel(data, "projects", f.projectId) + " · " : ""}{f.name}{" "}
                  <span className="text-[var(--text-sub)] font-semibold">· {us.length} units{released ? "" : " · structure in progress"}</span>
                </span>
                <span className="text-[var(--text-muted)]">{p}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden mt-1.5">
                <div className="h-full rounded-full" style={{ width: p + "%", background: p === 100 ? "var(--color-pass)" : "var(--theme-primary)" }} />
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-3 mt-3.5 pt-3.5 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
          {bySeverity.map((b) => (
            <div key={b.sev} className="flex items-center gap-1.5">
              <Badge color={b.sev === "Critical" ? "red" : b.sev === "Major" ? "amber" : "gray"}>{b.n} {b.sev}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

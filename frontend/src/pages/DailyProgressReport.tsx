import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel, projectFloors, projectUnits, unitSummary } from "../lib/rules";
import { downloadCsv } from "../lib/csv";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import CalendarRangePicker from "../components/CalendarRangePicker";
import SidePanel from "../components/SidePanel";
import DprForm from "../components/DprForm";
import DrawingRequestForm from "../components/DrawingRequestForm";

type DprTab = "work" | "drawing" | "summary";
type DateRange = "all" | "today" | "yesterday" | "thisWeek" | "lastWeek" | "weekNumber" | "thisMonth" | "custom";

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "weekNumber", label: "Week Number" },
  { key: "thisMonth", label: "This Month" },
  { key: "custom", label: "Custom Range" }
];

/** Monday..Sunday bounds for ISO week `week` of `year`. */
function isoWeekBounds(year: number, week: number): { from: string; to: string } {
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7;
  const mon = new Date(jan4); mon.setDate(jan4.getDate() - jan4Dow + (week - 1) * 7);
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Real [from, to] (inclusive, YYYY-MM-DD) for each preset — Monday-start weeks. */
function dateRangeBounds(range: DateRange): { from: string; to: string } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (today.getDay() + 6) % 7; // 0 = Monday

  if (range === "all") return null;
  if (range === "today") return { from: ymd(today), to: ymd(today) };
  if (range === "yesterday") {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { from: ymd(y), to: ymd(y) };
  }
  if (range === "thisWeek") {
    const mon = new Date(today); mon.setDate(mon.getDate() - dow);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  }
  if (range === "lastWeek") {
    const mon = new Date(today); mon.setDate(mon.getDate() - dow - 7);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  }
  if (range === "thisMonth") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: ymd(first), to: ymd(last) };
  }
  return null; // "custom" and "weekNumber" are handled separately, with their own inputs
}

const STAGE_LABEL: Record<string, string> = {
  "stage-1-screen": "Screening (L1)",
  "stage-2-produce": "Producing drawing",
  "stage-3-crosscheck": "Cross-check",
  "stage-4-final-approve": "Final approval",
  approved: "Approved",
  returned: "Returned"
};

function daysSince(ts: number): number {
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DailyProgressReportPage() {
  const { data } = useApp();
  const [open, setOpen] = useState(false);
  const [drOpen, setDrOpen] = useState(false);
  const [tab, setTab] = useState<DprTab>("work");
  const [fProject, setFProject] = useState("");
  const [fUser, setFUser] = useState("");
  const [fRange, setFRange] = useState<DateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  const nowForWeek = new Date();
  const [weekYear, setWeekYear] = useState(nowForWeek.getFullYear());
  const [weekNum, setWeekNum] = useState(1);

  useEffect(() => {
    if (!calendarOpen) return;
    function onDocClick(e: MouseEvent) {
      if (calendarWrapRef.current && !calendarWrapRef.current.contains(e.target as Node)) setCalendarOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [calendarOpen]);

  const projects = coll(data, "projects").filter((p) => p.active !== false);
  const users = coll(data, "users").filter((u) => u.active !== false);
  const allDpr = coll(data, "dpr");

  const bounds = fRange === "custom"
    ? (customFrom || customTo ? { from: customFrom || "0000-01-01", to: customTo || "9999-12-31" } : null)
    : fRange === "weekNumber"
    ? isoWeekBounds(weekYear, weekNum)
    : dateRangeBounds(fRange);

  let rows = allDpr.slice();
  if (fProject) rows = rows.filter((r) => r.projectId === fProject);
  if (fUser) rows = rows.filter((r) => r.submittedByUserId === fUser);
  if (bounds) rows = rows.filter((r) => r.date >= bounds.from && r.date <= bounds.to);
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  function generateReport() {
    downloadCsv(
      "daily-progress-report.csv",
      [
        ["Date", "Project", "Contractor", "DRI", "Shift", "Labourers", "Categories"],
        ...rows.map((r) => [r.date, r.projectName, r.vendorName, r.submittedByName, r.shift, r.labourCount, r.workEntries.length])
      ]
    );
  }

  // KPI strip — purely read-only display stats, computed from this feature's
  // own data (+ a read-only glance at Drawing Requests' pending count). No
  // shared logic/model between the two features — just a summary glance.
  // Both figures respect the page's own Project filter (fProject) — not the
  // separate global currentProjectId — so "All Projects" in the dropdown
  // above genuinely means every project's data, not one hardcoded project.
  const totalLabour = rows.reduce((a, r) => a + (r.labourCount || 0), 0);
  const progressProjectIds = fProject ? [fProject] : projects.map((p) => p.id);
  const units = progressProjectIds.flatMap((pid) => projectUnits(data, pid));
  const summaries = progressProjectIds.flatMap((pid) => projectUnits(data, pid).map((u) => unitSummary(data, pid, u.id)));
  const stagesTotal = summaries.reduce((a, s) => a + s.total, 0) || 1;
  const stagesDone = summaries.reduce((a, s) => a + s.done, 0);
  const overallProgress = Math.round((stagesDone / stagesTotal) * 100);
  const allDrawingRequests = coll(data, "drawingRequests").filter((r) => !fProject || r.projectId === fProject);
  const pendingDrawingRequests = allDrawingRequests.filter((r) => r.reviewStatus !== "approved" && r.reviewStatus !== "returned").length;
  const activeProjects = projects.length;

  // Real per-project labour totals, aggregated from actual submitted reports (no invented figures).
  const labourByProject = projects
    .filter((p) => !fProject || p.id === fProject)
    .map((p) => ({ project: p, total: rows.filter((r) => r.projectId === p.id).reduce((a, r) => a + (r.labourCount || 0), 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  const labourGrandTotal = labourByProject.reduce((a, x) => a + x.total, 0) || 1;

  // Real work-category tallies from actual submitted entries (no invented planned/target figures).
  const categoryCounts = new Map<string, number>();
  rows.forEach((r) => r.workEntries.forEach((we) => categoryCounts.set(we.category, (categoryCounts.get(we.category) || 0) + 1)));
  const workItems = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]);
  const workItemsMax = workItems.reduce((a, [, n]) => Math.max(a, n), 0) || 1;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="dpr" size={20} /></div>
          <div>
            <div className="page-title">Daily Progress Report</div>
            <div className="page-desc">Track labour, work progress, and drawing requests across all your projects.</div>
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setDrOpen(true)}><NavIcon name="drawing" size={13} /> Drawing Request</button>
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>＋ New Report</button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="field" style={{ minWidth: 150 }}>
          <label>Date Range</label>
          <SearchDropdown
            icon="calendar"
            searchable={false}
            scrollable={false}
            value={fRange}
            onChange={(v) => setFRange(v as DateRange)}
            options={DATE_RANGES.map((r) => ({ value: r.key, label: r.label }))}
          />
        </div>
        {fRange === "custom" && (
          <div className="field" style={{ minWidth: 190, position: "relative" }} ref={calendarWrapRef}>
            <label>Range</label>
            <button type="button" className="select" style={{ textAlign: "left" }} onClick={() => setCalendarOpen((o) => !o)}>
              {customFrom && customTo ? customFrom + "  →  " + customTo : "Pick dates"}
            </button>
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
          <>
            <div className="field" style={{ minWidth: 90 }}>
              <label>Week</label>
              <input className="input" type="number" min={1} max={53} value={weekNum} onChange={(e) => setWeekNum(Math.min(53, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
            <div className="field" style={{ minWidth: 100 }}>
              <label>Year</label>
              <input className="input" type="number" value={weekYear} onChange={(e) => setWeekYear(Number(e.target.value) || nowForWeek.getFullYear())} />
            </div>
          </>
        )}
        <div className="field" style={{ minWidth: 170 }}>
          <label>Project</label>
          <SearchDropdown
            value={fProject}
            onChange={setFProject}
            options={[{ value: "", label: "All Projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        <div className="field" style={{ minWidth: 170 }}>
          <label>DRI / Site Engineer</label>
          <SearchDropdown
            value={fUser}
            onChange={setFUser}
            options={[{ value: "", label: "All DRI" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
        </div>
        <button className="btn btn-primary" onClick={generateReport}>⬇ Generate Report</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Total Labour (All Time)</div>
          <div className="stat-val">{totalLabour}</div>
          <div className="stat-icon"><NavIcon name="team" size={15} /></div>
        </div>
        <div className="stat-card ok">
          <div className="stat-label">Work Progress (Overall)</div>
          <div className="stat-val">{overallProgress}%</div>
          <div className="stat-icon"><NavIcon name="trend" size={15} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending Drawing Requests</div>
          <div className="stat-val">{pendingDrawingRequests}</div>
          <div className="stat-icon"><NavIcon name="drawing" size={15} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Projects (All Time)</div>
          <div className="stat-val">{activeProjects}</div>
          <div className="stat-icon"><NavIcon name="board" size={15} /></div>
        </div>
      </div>

      <div className="panel-card">
        <div className="tabs-underline">
          <button className={"tab-underline-btn" + (tab === "work" ? " active" : "")} onClick={() => setTab("work")}>Work Progress</button>
          <button className={"tab-underline-btn" + (tab === "drawing" ? " active" : "")} onClick={() => setTab("drawing")}>Drawing Requests</button>
          <button className={"tab-underline-btn" + (tab === "summary" ? " active" : "")} onClick={() => setTab("summary")}>Summary</button>
        </div>

        {tab === "work" && (
          <div className="two-col-cards">
            <div className="card">
              <div className="card-title-row">
                <div>
                  <div className="card-title">Work Items Logged</div>
                  <div className="card-subtitle">All projects · All time — tally of submitted work entries</div>
                </div>
              </div>
              <div className="table-scroll">
                {workItems.length === 0 ? (
                  <div className="empty">No work items logged yet.</div>
                ) : (
                  <table className="data">
                    <thead>
                      <tr><th>Work item</th><th>Logged</th><th>Progress</th></tr>
                    </thead>
                    <tbody>
                      {workItems.map(([cat, n]) => (
                        <tr key={cat}>
                          <td>{cat}</td>
                          <td className="num">{n}</td>
                          <td>
                            <div className="progress-track">
                              <div className="progress-fill" style={{ width: Math.round((n / workItemsMax) * 100) + "%" }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-title-row">
                <div>
                  <div className="card-title">Labour Count by Project</div>
                  <div className="card-subtitle">All Time</div>
                </div>
              </div>
              <div className="table-scroll">
                {labourByProject.length === 0 ? (
                  <div className="empty">No labour data yet.</div>
                ) : (
                  <table className="data">
                    <thead>
                      <tr><th>Project</th><th>Total labour</th><th>% of total</th></tr>
                    </thead>
                    <tbody>
                      {labourByProject.map(({ project, total }) => (
                        <tr key={project.id}>
                          <td>{project.name}</td>
                          <td className="num">{total}</td>
                          <td className="num">{Math.round((total / labourGrandTotal) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "drawing" && (
          <div className="card" style={{ margin: 16 }}>
            <div className="card-title-row">
              <div className="card-title">Drawing Request Status</div>
              <span className="badge-tag gate">{allDrawingRequests.length} total</span>
            </div>
            <div className="table-scroll">
              {allDrawingRequests.length === 0 ? (
                <div className="empty">No drawing requests yet.</div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Ticket</th><th>Description</th><th>Project</th><th>Requested by</th><th>Current stage</th><th>Requested on</th><th>Days since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allDrawingRequests.map((r) => (
                      <tr key={r.id}>
                        <td style={{ color: "var(--theme-primary)", fontWeight: 700 }}>{r.ticketNo}</td>
                        <td>{r.description}</td>
                        <td>{r.projectName || refLabel(data, "projects", r.projectId)}</td>
                        <td>{r.requesterName}</td>
                        <td>{r.reviewStatus !== "approved" && r.reviewStatus !== "returned" && <span className="badge-tag gate">{STAGE_LABEL[r.reviewStatus]}</span>}</td>
                        <td>{fmtDate(r.createdAt)}</td>
                        <td className="num">{daysSince(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "summary" && (
          <div className="card" style={{ margin: 16 }}>
            <div className="card-title-row">
              <div className="card-title">Recent Reports</div>
            </div>

            <div className="table-scroll">
              {rows.length === 0 ? (
                <div className="empty">No daily progress reports yet.</div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Date</th><th>Project</th><th>Contractor</th><th>DRI</th><th>Shift</th><th>Labourers</th><th>Categories</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.date}</td>
                        <td>{r.projectName || refLabel(data, "projects", r.projectId)}</td>
                        <td>{r.vendorName || r.vendorCode}</td>
                        <td>{r.submittedByName}</td>
                        <td><span className={"badge-tag " + (r.shift === "Night" ? "mute" : "wip")}>{r.shift}</span></td>
                        <td className="num">{r.labourCount}</td>
                        <td><span className="badge-tag wip">{r.workEntries.length} categor{r.workEntries.length === 1 ? "y" : "ies"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      <SidePanel open={open} icon={<NavIcon name="dpr" size={17} />} title="New Daily Progress Report" desc="Fill in today's site details, then check off what work happened." onClose={() => setOpen(false)}>
        <DprForm isPublic={false} onDone={() => setOpen(false)} />
      </SidePanel>

      <SidePanel open={drOpen} icon={<NavIcon name="drawing" size={17} />} title="Request a Drawing" desc="Ask Planning/Design for a drawing you need on site" onClose={() => setDrOpen(false)}>
        <DrawingRequestForm isPublic={false} onDone={() => setDrOpen(false)} />
      </SidePanel>
    </div>
  );
}

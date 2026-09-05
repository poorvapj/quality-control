import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel } from "../shared/rules";
import { downloadCsv } from "../shared/csv";
import { type DateRange, DATE_RANGES, isoWeekBounds, dateRangeBounds } from "../shared/dateRange";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import CalendarRangePicker from "../components/CalendarRangePicker";
import SidePanel from "../components/SidePanel";
import DprForm from "../components/DprForm";
import { WORK_CATEGORIES } from "../services/config";
import DrawingRequestForm from "../components/DrawingRequestForm";

type DprTab = "work" | "drawing" | "summary";

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
  const { data, currentUserId, myRole } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const isDri = !isAdmin && myRole() === "DRI";
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
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [remarks, setRemarks] = useState("");

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
  // A DRI isn't a reviewer here — see shared/permissions.ts — so this page
  // only shows the reports they personally submitted, not every DRI's.
  if (isDri) rows = rows.filter((r) => r.submittedByUserId === currentUserId);
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
  const allDrawingRequests = coll(data, "drawingRequests").filter((r) => !fProject || r.projectId === fProject);
  const pendingDrawingRequests = allDrawingRequests.filter((r) => r.reviewStatus !== "approved" && r.reviewStatus !== "returned").length;
  const activeProjects = projects.length;

  // Previous equal-length period, shifted back by the current window's own
  // span — only meaningful for a concrete date range, never "All Time"
  // (there's no "period before all time"). Used solely for the labour
  // summary's Up/Down/— indicator below.
  const prevBounds = bounds
    ? (() => {
        const spanDays = Math.round((new Date(bounds.to).getTime() - new Date(bounds.from).getTime()) / 86400000) + 1;
        const shift = (d: string) => {
          const dt = new Date(d);
          dt.setDate(dt.getDate() - spanDays);
          return dt.toISOString().slice(0, 10);
        };
        return { from: shift(bounds.from), to: shift(bounds.to) };
      })()
    : null;
  const prevRows = prevBounds
    ? allDpr.filter((r) => {
        if (isDri && r.submittedByUserId !== currentUserId) return false;
        if (fProject && r.projectId !== fProject) return false;
        if (fUser && r.submittedByUserId !== fUser) return false;
        return r.date >= prevBounds.from && r.date <= prevBounds.to;
      })
    : [];

  // Real per-project labour totals, aggregated from actual submitted
  // reports (no invented figures), each with a per-contractor breakdown
  // nested underneath and a vs-previous-period % change when a concrete
  // date range is selected.
  const labourByProject = projects
    .filter((p) => !fProject || p.id === fProject)
    .map((p) => {
      const projRows = rows.filter((r) => r.projectId === p.id);
      const total = projRows.reduce((a, r) => a + (r.labourCount || 0), 0);
      const byContractor = new Map<string, { vendorCode: string; vendorName: string; total: number; categories: Set<string> }>();
      for (const r of projRows) {
        const key = r.vendorCode || r.vendorName;
        if (!byContractor.has(key)) byContractor.set(key, { vendorCode: r.vendorCode, vendorName: r.vendorName, total: 0, categories: new Set() });
        const c = byContractor.get(key)!;
        c.total += r.labourCount || 0;
        r.workEntries.forEach((we) => c.categories.add(we.category));
      }
      const contractors = Array.from(byContractor.values()).sort((a, b) => b.total - a.total);
      const prevTotal = prevBounds
        ? prevRows.filter((r) => r.projectId === p.id).reduce((a, r) => a + (r.labourCount || 0), 0)
        : null;
      return { project: p, total, contractors, prevTotal };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  const labourGrandTotal = labourByProject.reduce((a, x) => a + x.total, 0) || 1;

  function toggleProjectExpanded(id: string) {
    setExpandedProjects((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Real work-category tallies from actual submitted entries (no invented planned/target figures).
  const categoryCounts = new Map<string, number>();
  rows.forEach((r) => r.workEntries.forEach((we) => categoryCounts.set(we.category, (categoryCounts.get(we.category) || 0) + 1)));
  const workItems = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]);
  const workItemsMax = workItems.reduce((a, [, n]) => Math.max(a, n), 0) || 1;

  // Planned vs Completed — planned comes from Work Targets (one row per
  // project+category, set once in Masters); completed sums this filter
  // window's `qty` entries for that same category. When "All Projects" is
  // selected, both sides sum across every project's target for that
  // category — a legitimate site-wide rollup here (unlike the reference
  // app's work-order bug) because there's exactly one target per
  // project+category, never multiple same-named items to collide.
  const allWorkTargets = coll(data, "workTargets").filter((t) => t.active !== false && (!fProject || t.projectId === fProject));
  const plannedProgress = WORK_CATEGORIES
    .map((cat) => {
      const targets = allWorkTargets.filter((t) => t.category === cat);
      if (targets.length === 0) return null;
      const planned = targets.reduce((a, t) => a + t.plannedQty, 0);
      const unit = targets[0].unit;
      const completed = rows.reduce(
        (a, r) => a + r.workEntries.filter((we) => we.category === cat && we.qty != null).reduce((b, we) => b + (we.qty || 0), 0),
        0
      );
      return { category: cat, unit, planned, completed };
    })
    .filter((x): x is { category: string; unit: string; planned: number; completed: number } => x !== null);

  // "Overall" progress here is deliberately DPR's own — how many of the
  // 16 work-type categories have been logged at least once in the current
  // filters — not Tower Board's stage-completion %. The two are explicitly
  // unrelated (DPR doesn't drive or read Tower Board progress).
  const overallProgress = Math.round((workItems.length / WORK_CATEGORIES.length) * 100);

  // Action Required — computed, not authored: nothing here is stored, it's
  // re-derived every render from data already loaded on this page.
  const OVERDUE_DRAWING_DAYS = 7;
  const reportedProjectIds = new Set(rows.map((r) => r.projectId));
  const zeroReportProjects = (fProject ? projects.filter((p) => p.id === fProject) : projects)
    .filter((p) => !reportedProjectIds.has(p.id));
  const entriesMissingPhotos = rows.reduce((a, r) => a + r.workEntries.filter((we) => we.generalPhotos.length === 0).length, 0);
  const overdueDrawingReqs = allDrawingRequests.filter(
    (r) => r.reviewStatus !== "approved" && r.reviewStatus !== "returned" && daysSince(r.createdAt) > OVERDUE_DRAWING_DAYS
  );
  const actionItems: string[] = [];
  if (zeroReportProjects.length) {
    const names = zeroReportProjects.slice(0, 5).map((p) => p.name).join(", ");
    actionItems.push(
      `No reports from ${zeroReportProjects.length} project${zeroReportProjects.length === 1 ? "" : "s"} this period — ${names}${zeroReportProjects.length > 5 ? ` +${zeroReportProjects.length - 5} more` : ""}`
    );
  }
  if (entriesMissingPhotos > 0) {
    actionItems.push(`${entriesMissingPhotos} work entr${entriesMissingPhotos === 1 ? "y has" : "ies have"} no photos attached`);
  }
  if (overdueDrawingReqs.length) {
    actionItems.push(`${overdueDrawingReqs.length} drawing request${overdueDrawingReqs.length === 1 ? "" : "s"} pending ${OVERDUE_DRAWING_DAYS}+ days — ${overdueDrawingReqs.slice(0, 5).map((r) => r.ticketNo).join(", ")}`);
  }

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
            neutralActive
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
            neutralActive
          />
        </div>
        <div className="field" style={{ minWidth: 170 }}>
          <label>DRI / Site Engineer</label>
          <SearchDropdown
            value={fUser}
            onChange={setFUser}
            options={[{ value: "", label: "All DRI" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
            neutralActive
          />
        </div>
        <button className="btn btn-primary" onClick={generateReport}>⬇ Generate Report</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {/* Each card jumps to wherever that number is actually broken down —
            all four live entirely on this page's own tabs. "Work Progress
            (Overall)" is DPR's own metric (% of the 16 work-type categories
            logged in the current filters), deliberately unrelated to Tower
            Board's stage-completion progress. */}
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setTab("work")}>
          <div className="stat-label">Total Labour (All Time)</div>
          <div className="stat-val">{totalLabour}</div>
          <div className="stat-icon"><NavIcon name="team" size={15} /></div>
        </div>
        <div className="stat-card ok" style={{ cursor: "pointer" }} onClick={() => setTab("work")}>
          <div className="stat-label">Work Progress (Overall)</div>
          <div className="stat-val">{overallProgress}%</div>
          <div className="stat-icon"><NavIcon name="trend" size={15} /></div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setTab("drawing")}>
          <div className="stat-label">Pending Drawing Requests</div>
          <div className="stat-val">{pendingDrawingRequests}</div>
          <div className="stat-icon"><NavIcon name="drawing" size={15} /></div>
        </div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setTab("work")}>
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
                  <div className="card-title">Work Progress — Planned vs Completed</div>
                  <div className="card-subtitle">{fProject ? projects.find((p) => p.id === fProject)?.name : "All projects"} — against Work Targets set in Masters</div>
                </div>
              </div>
              <div className="table-scroll">
                {plannedProgress.length === 0 ? (
                  <div className="empty">No Work Targets set for this filter yet — add one in Masters ▸ Work Target.</div>
                ) : (
                  <table className="data">
                    <thead>
                      <tr><th>Work item</th><th>Planned</th><th>Completed</th><th>Progress</th></tr>
                    </thead>
                    <tbody>
                      {plannedProgress.map((r) => {
                        const pct = r.planned > 0 ? Math.min(100, Math.round((r.completed / r.planned) * 100)) : 0;
                        return (
                          <tr key={r.category}>
                            <td>{r.category}</td>
                            <td className="num">{r.planned.toLocaleString("en-IN")} {r.unit}</td>
                            <td className="num">{r.completed.toLocaleString("en-IN")} {r.unit}</td>
                            <td>
                              <div className="progress-track">
                                <div className="progress-fill" style={{ width: pct + "%", background: pct >= 100 ? "var(--color-pass)" : pct >= 60 ? undefined : "var(--color-fail)" }} />
                              </div>
                              <div style={{ fontSize: 11, marginTop: 2 }}>{pct}%</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

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
                  <div className="card-title">Project-wise Labour Summary</div>
                  <div className="card-subtitle">Tap a project to see its per-contractor breakdown{bounds ? " · vs. the same-length period before this one" : ""}</div>
                </div>
              </div>
              <div className="table-scroll">
                {labourByProject.length === 0 ? (
                  <div className="empty">No labour data yet.</div>
                ) : (
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Project</th><th>Total labour</th><th>Contractors</th><th>Reports</th><th>% of total</th>
                        {bounds && <th>vs. previous</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {labourByProject.map(({ project, total, contractors, prevTotal }) => {
                        const expanded = expandedProjects.has(project.id);
                        const change = prevTotal != null ? total - prevTotal : null;
                        return (
                          <React.Fragment key={project.id}>
                            <tr className="clickable" onClick={() => toggleProjectExpanded(project.id)} style={{ cursor: "pointer" }}>
                              <td>{expanded ? "▾" : "▸"} {project.name}</td>
                              <td className="num">{total}</td>
                              <td className="num">{contractors.length}</td>
                              <td className="num">{rows.filter((r) => r.projectId === project.id).length}</td>
                              <td className="num">{Math.round((total / labourGrandTotal) * 100)}%</td>
                              {bounds && (
                                <td className="num">
                                  {change == null ? "—" : change === 0 ? (
                                    <span className="badge-tag mute">— no change</span>
                                  ) : change > 0 ? (
                                    <span className="badge-tag pass">▲ +{change}</span>
                                  ) : (
                                    <span className="badge-tag fail">▼ {change}</span>
                                  )}
                                </td>
                              )}
                            </tr>
                            {expanded && contractors.map((c) => (
                              <tr key={c.vendorCode} style={{ background: "var(--bg-subtle)" }}>
                                <td style={{ paddingLeft: 28 }}>
                                  <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{c.vendorCode}</span> · {c.vendorName}
                                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{Array.from(c.categories).join(", ") || "—"}</div>
                                </td>
                                <td className="num">{c.total}</td>
                                <td colSpan={bounds ? 4 : 3}></td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
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

      <div className="two-col-cards" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="card-title-row">
            <div className="card-title">Action Required</div>
          </div>
          {actionItems.length === 0 ? (
            <div className="empty">✓ All clear — nothing needs attention in this filter window.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              {actionItems.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card-title-row">
            <div className="card-title">Coordinator Remarks</div>
            <div className="card-subtitle">Not saved — for annotating before you circulate/print this view</div>
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 96 }}
            placeholder="Notes to add before sharing this report…"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>
      </div>

      <SidePanel wide open={open} icon={<NavIcon name="dpr" size={17} />} title="New Daily Progress Report" desc="Fill in today's site details, then check off what work happened." onClose={() => setOpen(false)}>
        <DprForm isPublic={false} onDone={() => setOpen(false)} />
      </SidePanel>

      <SidePanel open={drOpen} icon={<NavIcon name="drawing" size={17} />} title="Request a Drawing" desc="Ask Planning/Design for a drawing you need on site" onClose={() => setDrOpen(false)}>
        <DrawingRequestForm isPublic={false} onDone={() => setDrOpen(false)} />
      </SidePanel>
    </div>
  );
}

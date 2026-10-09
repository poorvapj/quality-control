import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel, myProjects, byId } from "../shared/rules";
import { type DateRange, DATE_RANGES, isoWeekBounds, dateRangeBounds, ymd, parseYmd } from "../shared/dateRange";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import CalendarRangePicker from "../components/CalendarRangePicker";
import SidePanel from "../components/SidePanel";
import DprForm from "../components/DprForm";
import { WORK_CATEGORIES } from "../services/config";
import DrawingRequestForm from "../components/DrawingRequestForm";

type DprTab = "work" | "drawing" | "summary";

const STAGE_LABEL: Record<string, string> = {
  "stage-1-screen": "GM Screening (L1)",
  "stage-2-produce": "Architect Drawing (L2)",
  "stage-3-crosscheck": "Cross-check",
  "stage-4-final-approve": "Final approval",
  approved: "Approved",
  returned: "Returned"
};
const STAGE_BADGE_CLASS: Record<string, string> = {
  "stage-1-screen": "gate",
  "stage-2-produce": "wip",
  "stage-3-crosscheck": "wip",
  "stage-4-final-approve": "wip",
  approved: "pass",
  returned: "fail"
};

function daysSince(ts: number): number {
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function PageControls({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  // Collapse long ranges to first/last + a window around the current page,
  // with "…" gaps — same shape as the reference app's page-number strip.
  const pages: (number | "…")[] = [];
  const windowSize = 1;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= windowSize) pages.push(p);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, padding: "14px 16px" }}>
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={"gap" + i} style={{ padding: "0 4px", color: "var(--text-muted)" }}>…</span>
        ) : (
          <button
            key={p}
            className={"btn btn-sm " + (p === page ? "btn-primary" : "btn-secondary")}
            style={{ minWidth: 30 }}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        )
      )}
      <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>›</button>
    </div>
  );
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DailyProgressReportPage() {
  const { data, currentUserId, myRole } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const isDri = !isAdmin && (myRole() === "ADMIN" || myRole() === "DRI");
  const [open, setOpen] = useState(false);
  const [drOpen, setDrOpen] = useState(false);
  const [tab, setTab] = useState<DprTab>("work");
  const [summaryPage, setSummaryPage] = useState(1);
  const SUMMARY_PAGE_SIZE = 10;
  const [viewReportId, setViewReportId] = useState<string | null>(null);
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

  useEffect(() => { setSummaryPage(1); }, [fProject, fUser, fRange, customFrom, customTo, weekNum, weekYear]);

  const projects = myProjects(data, currentUserId);
  const users = coll(data, "users").filter((u) => u.active !== false);
  const allDpr = coll(data, "dpr");

  const bounds = fRange === "custom"
    ? (customFrom || customTo ? { from: customFrom || "0000-01-01", to: customTo || "9999-12-31" } : null)
    : fRange === "weekNumber"
    ? isoWeekBounds(weekYear, weekNum)
    : dateRangeBounds(fRange);

  // Real resolved dates, not just the preset's name — matches VMS showing
  // "01 Oct 2026 – 31 Oct 2026" instead of a bare "This Month" everywhere
  // the range is displayed (stat cards, table subtitles, PDF period line).
  const rangeLabel = bounds
    ? bounds.from === bounds.to
      ? fmtDate(parseYmd(bounds.from).getTime())
      : `${fmtDate(parseYmd(bounds.from).getTime())} – ${fmtDate(parseYmd(bounds.to).getTime())}`
    : "All Time";

  let rows = allDpr.slice();
  // A DRI isn't a reviewer here — see shared/permissions.ts — so this page
  // only shows the reports they personally submitted, not every DRI's.
  if (isDri) rows = rows.filter((r) => r.submittedByUserId === currentUserId);
  if (fProject) rows = rows.filter((r) => r.projectId === fProject);
  if (fUser) rows = rows.filter((r) => r.submittedByUserId === fUser);
  // r.date is inconsistent in shape — new submissions store plain
  // "YYYY-MM-DD", but records migrated from VMS carry a full ISO datetime
  // ("2026-10-06T00:00:00.000Z"). Comparing that against a bare bound
  // string makes the ISO string sort as "greater" (it has extra trailing
  // characters), so the exact end-of-range day was silently excluded from
  // every filter — Today/Yesterday (a single-day range) always showed 0.
  // Normalize to just the date portion before comparing.
  if (bounds) rows = rows.filter((r) => { const d = r.date.slice(0, 10); return d >= bounds.from && d <= bounds.to; });
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const viewReport = viewReportId ? allDpr.find((r) => r.id === viewReportId) || null : null;

  async function generateReport() {
    const { downloadDprPdf } = await import("../components/DprPdfDocument");

    const contractorsActive = new Set(rows.map((r) => r.vendorCode).filter(Boolean)).size;
    const workTypesLogged = new Set(rows.flatMap((r) => r.workEntries.map((we) => we.category))).size;
    const reportingDays = new Set(rows.map((r) => r.date?.slice(0, 10)).filter(Boolean)).size;
    const reportedProjectIds = new Set(rows.map((r) => r.projectId));

    const categoryEntryCounts = new Map<string, number>();
    rows.forEach((r) => r.workEntries.forEach((we) => categoryEntryCounts.set(we.category, (categoryEntryCounts.get(we.category) || 0) + 1)));
    const totalEntries = Array.from(categoryEntryCounts.values()).reduce((a, n) => a + n, 0) || 1;

    // Same-length window immediately preceding the current one — only
    // meaningful for a concrete date range, never "All Time". PDF-only:
    // the on-screen labour table deliberately doesn't show this.
    const prevBounds = bounds
      ? (() => {
          const spanDays = Math.round((parseYmd(bounds.to).getTime() - parseYmd(bounds.from).getTime()) / 86400000) + 1;
          const shift = (d: string) => {
            const dt = parseYmd(d);
            dt.setDate(dt.getDate() - spanDays);
            return ymd(dt);
          };
          return { from: shift(bounds.from), to: shift(bounds.to) };
        })()
      : null;
    const prevRows = prevBounds
      ? allDpr.filter((r) => {
          if (isDri && r.submittedByUserId !== currentUserId) return false;
          if (fProject && r.projectId !== fProject) return false;
          if (fUser && r.submittedByUserId !== fUser) return false;
          const d = r.date.slice(0, 10);
          return d >= prevBounds.from && d <= prevBounds.to;
        })
      : [];

    const projectSummary = labourByProject.map(({ project, total }) => {
      const projRows = rows.filter((r) => r.projectId === project.id);
      const catCounts = new Map<string, number>();
      const byVendor = new Map<string, { vendorCode: string; vendorName: string; labourCount: number; categories: Set<string> }>();
      for (const r of projRows) {
        r.workEntries.forEach((we) => catCounts.set(we.category, (catCounts.get(we.category) || 0) + 1));
        const key = r.vendorCode || r.vendorName;
        if (!byVendor.has(key)) byVendor.set(key, { vendorCode: r.vendorCode, vendorName: r.vendorName, labourCount: 0, categories: new Set() });
        const v = byVendor.get(key)!;
        v.labourCount += r.labourCount || 0;
        r.workEntries.forEach((we) => v.categories.add(we.category));
      }
      const majorWorkType = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
      const prevTotal = prevBounds ? prevRows.filter((r) => r.projectId === project.id).reduce((a, r) => a + (r.labourCount || 0), 0) : null;
      const changePct = prevTotal != null && prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
      const vendorBreakdown = Array.from(byVendor.values())
        .sort((a, b) => b.labourCount - a.labourCount)
        .map((v) => ({ vendorCode: v.vendorCode, vendorName: v.vendorName, workType: Array.from(v.categories).join(", ") || "—", labourCount: v.labourCount }));
      return { projectName: project.name, labour: total, contractors: byVendor.size, reportsCount: projRows.length, majorWorkType, changePct, vendorBreakdown };
    });

    const workTypeSummary = Array.from(categoryEntryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([workType, entries]) => ({ workType, entries, pct: Math.round((entries / totalEntries) * 100) }));

    const workProgress = allWorkTargets.map((t) => {
      const completed = rows
        .filter((r) => r.projectId === t.projectId)
        .reduce((a, r) => a + r.workEntries.filter((we) => we.category === t.category && we.qty != null).reduce((b, we) => b + (we.qty || 0), 0), 0);
      return {
        workItem: t.category,
        projectName: byId(coll(data, "projects"), t.projectId)?.name || "—",
        unit: t.unit,
        planned: t.plannedQty,
        completed,
        pct: t.plannedQty > 0 ? Math.min(100, Math.round((completed / t.plannedQty) * 100)) : 0
      };
    }).filter((w) => w.planned > 0).sort((a, b) => b.planned - a.planned).slice(0, 15);

    const periodLabel = rangeLabel;
    const OVERDUE_DAYS = 3;
    const overdueDrawingReqs = allDrawingRequests.filter(
      (r) => r.reviewStatus !== "approved" && r.reviewStatus !== "returned" && daysSince(r.createdAt) > OVERDUE_DAYS
    );
    const totalProjectsInScope = fProject ? 1 : projects.length;
    const notReportedCount = (fProject ? projects.filter((p) => p.id === fProject) : projects).filter((p) => !reportedProjectIds.has(p.id)).length;
    const actionItems: { level: "critical" | "warning" | "good"; text: string }[] = [];
    if (overdueDrawingReqs.length) {
      actionItems.push({ level: "critical", text: `${overdueDrawingReqs.length} drawing request${overdueDrawingReqs.length === 1 ? "" : "s"} delayed more than ${OVERDUE_DAYS} days` });
    }
    if (notReportedCount > 0) {
      actionItems.push({ level: "warning", text: `${notReportedCount} project${notReportedCount === 1 ? "" : "s"} did not submit a progress report for ${periodLabel}` });
    }
    actionItems.push({ level: "good", text: `${labourByProject.length} / ${totalProjectsInScope} project${totalProjectsInScope === 1 ? "" : "s"} reported in this period` });

    downloadDprPdf({
      scopeLabel: fProject ? (projects.find((p) => p.id === fProject)?.name || "—") : "All Projects",
      periodLabel,
      generatedAt: Date.now(),
      generatedBy: byId(coll(data, "users"), currentUserId)?.name || "—",
      kpis: {
        totalLabour,
        projectsCovered: labourByProject.length,
        totalContractors: contractorsActive,
        workTypes: workTypesLogged,
        reportingDays,
        reportsSubmitted: rows.length,
        drawingRequests: allDrawingRequests.length
      },
      projectSummary,
      workTypeSummary,
      workProgress,
      drawingRequests: allDrawingRequests.map((r) => ({
        ticketNo: r.ticketNo,
        description: r.description,
        projectName: r.projectName || refLabel(data, "projects", r.projectId),
        driName: r.requesterName,
        stageLabel: STAGE_LABEL[r.reviewStatus] || r.reviewStatus,
        requestedOn: fmtDate(r.createdAt),
        daysSince: daysSince(r.createdAt)
      })),
      actionItems
    });
  }

  // KPI strip — purely read-only display stats, computed from this feature's
  // own data (+ a read-only glance at Drawing Requests' pending count). No
  // shared logic/model between the two features — just a summary glance.
  // Both figures respect the page's own Project filter (fProject) — not the
  // separate global currentProjectId — so "All Projects" in the dropdown
  // above genuinely means every project's data, not one hardcoded project.
  const totalLabour = rows.reduce((a, r) => a + (r.labourCount || 0), 0);
  // Same DRI scoping as the Drawing Requests page itself (DrawingRequests.tsx)
  // and this page's own DPR rows above — a DRI sees only requests they
  // personally raised, not every DRI's.
  let allDrawingRequests = coll(data, "drawingRequests").filter((r) => !fProject || r.projectId === fProject);
  if (isDri) allDrawingRequests = allDrawingRequests.filter((r) => r.submittedByUserId === currentUserId);
  const pendingDrawingRequests = allDrawingRequests.filter((r) => r.reviewStatus !== "approved" && r.reviewStatus !== "returned").length;
  const activeProjects = projects.length;

  // Real per-project labour totals, aggregated from actual submitted reports (no invented figures).
  const labourByProject = projects
    .filter((p) => !fProject || p.id === fProject)
    .map((p) => {
      const total = rows.filter((r) => r.projectId === p.id).reduce((a, r) => a + (r.labourCount || 0), 0);
      return { project: p, total };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  const labourGrandTotal = labourByProject.reduce((a, x) => a + x.total, 0) || 1;

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

  // Display rows for the Work Progress table: every category with a Work
  // Target, plus categories that have logged quantities but no target yet —
  // those show Planned/Progress as "—" rather than an invented figure.
  type WpRow = { category: string; unit: string; planned: number | null; completed: number };
  const wpRows: WpRow[] = WORK_CATEGORIES.map((cat): WpRow | null => {
    const withTarget = plannedProgress.find((p) => p.category === cat);
    if (withTarget) return withTarget;
    const qtyEntries = rows.flatMap((r) => r.workEntries.filter((we) => we.category === cat && we.qty != null));
    if (qtyEntries.length === 0) return null;
    return { category: cat, unit: qtyEntries.find((we) => we.unit)?.unit || "", planned: null, completed: qtyEntries.reduce((a, we) => a + (we.qty || 0), 0) };
  }).filter((x): x is WpRow => x !== null);

  // Overall progress — completed/planned across every category that has a
  // Work Target, matching the Work Progress table's own per-row percentage.
  const overallProgressTotals = wpRows.reduce(
    (a, r) => (r.planned != null ? { planned: a.planned + r.planned, completed: a.completed + r.completed } : a),
    { planned: 0, completed: 0 }
  );
  const overallProgress = overallProgressTotals.planned > 0
    ? Math.min(100, Math.round((overallProgressTotals.completed / overallProgressTotals.planned) * 100))
    : 0;

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
        <div className="field" style={{ minWidth: 150, position: "relative" }} ref={calendarWrapRef}>
          <label>Date Range</label>
          <SearchDropdown
            icon="calendar"
            searchable={false}
            scrollable={false}
            value={fRange}
            onChange={(v) => { setFRange(v as DateRange); if (v === "custom") setCalendarOpen(true); }}
            options={DATE_RANGES.map((r) => ({ value: r.key, label: r.label }))}
            neutralActive
          />
          {fRange === "custom" && customFrom && customTo && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{customFrom} → {customTo}</div>
          )}
          {fRange === "custom" && calendarOpen && (
            <CalendarRangePicker
              from={customFrom}
              to={customTo}
              onCancel={() => setCalendarOpen(false)}
              onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setCalendarOpen(false); }}
            />
          )}
        </div>
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
          <div className="stat-label">Total Labour ({rangeLabel})</div>
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
          <div className="stat-label">Active Projects ({rangeLabel})</div>
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
            <div className="card wp-card" style={{ order: 1 }}>
              <div className="card-title-row wp-head">
                <div>
                  <div className="card-title">Work Progress{fProject ? "" : " (Site-wide)"}</div>
                  <div className="card-subtitle">
                    {fProject ? projects.find((p) => p.id === fProject)?.name : "All projects"} · {rangeLabel} — planned vs. completed by work item
                  </div>
                </div>
              </div>
              <div className="wp-body">
                {wpRows.length === 0 ? (
                  <div className="empty">No Work Targets set and no quantities logged for this filter yet — add a target in Masters ▸ Work Target.</div>
                ) : (
                  <div className="wp-table-wrap">
                    <table className="data wp-table">
                      <thead>
                        <tr><th>Work item</th><th className="num">Planned</th><th className="num">Completed</th><th>Progress</th></tr>
                      </thead>
                      <tbody>
                        {wpRows.map((r) => {
                          const hasPlan = r.planned != null && r.planned > 0;
                          const pct = hasPlan ? Math.min(100, Math.round((r.completed / (r.planned as number)) * 100)) : 0;
                          const fill = pct >= 90 ? "var(--color-pass)" : pct >= 60 ? "#f59e0b" : "var(--color-fail)";
                          return (
                            <tr key={r.category}>
                              <td className="wp-item">{r.category}</td>
                              <td className="num wp-mono">{r.planned != null ? `${r.planned.toLocaleString("en-IN")} ${r.unit}` : "—"}</td>
                              <td className="num wp-mono">{r.completed.toLocaleString("en-IN")} {r.unit}</td>
                              <td>
                                <div className="wp-progress">
                                  <div className="wp-track">
                                    <div className="wp-fill" style={{ width: pct + "%", background: fill }} />
                                  </div>
                                  <span className="wp-pct">{hasPlan ? pct + "%" : "—"}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="card wp-card" style={{ order: 2 }}>
              <div className="card-title-row wp-head">
                <div>
                  <div className="card-title">Labour Count by Project</div>
                  <div className="card-subtitle">{rangeLabel}</div>
                </div>
              </div>
              <div className="wp-body">
                {labourByProject.length === 0 ? (
                  <div className="empty">No labour data yet.</div>
                ) : (
                  <div className="wp-table-wrap">
                    <table className="data wp-table">
                      <thead>
                        <tr><th>Project</th><th className="num">Total labour</th><th>% of total</th></tr>
                      </thead>
                      <tbody>
                        {labourByProject.map(({ project, total }) => {
                          const pct = labourGrandTotal > 0 ? Math.round((total / labourGrandTotal) * 100) : 0;
                          return (
                            <tr key={project.id}>
                              <td className="wp-item">{project.name}</td>
                              <td className="num wp-mono" style={{ fontWeight: 700 }}>{total}</td>
                              <td>
                                <div className="wp-progress">
                                  <div className="wp-track"><div className="wp-fill" style={{ width: pct + "%", background: "var(--theme-primary)" }} /></div>
                                  <span className="wp-pct">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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
                        <td><span className={"badge-tag " + (STAGE_BADGE_CLASS[r.reviewStatus] || "mute")}>{STAGE_LABEL[r.reviewStatus]}</span></td>
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
                      <th>Date</th><th>Project</th><th>Contractor</th><th>DRI</th><th>Shift</th><th>Labourers</th><th>Categories</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice((summaryPage - 1) * SUMMARY_PAGE_SIZE, summaryPage * SUMMARY_PAGE_SIZE).map((r) => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(new Date(r.date).getTime())}</td>
                        <td>{r.projectName || refLabel(data, "projects", r.projectId)}</td>
                        <td>{r.vendorName || r.vendorCode}</td>
                        <td>{r.submittedByName}</td>
                        <td><span className={"badge-tag " + (r.shift === "Night" ? "mute" : "wip")}>{r.shift}</span></td>
                        <td className="num">{r.labourCount}</td>
                        <td><span className="badge-tag wip">{r.workEntries.length} categor{r.workEntries.length === 1 ? "y" : "ies"}</span></td>
                        <td>
                          <button className="btn btn-secondary btn-sm" title="View" onClick={() => setViewReportId(r.id)}>
                            <NavIcon name="eye" size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {rows.length > SUMMARY_PAGE_SIZE && (
              <PageControls
                page={summaryPage}
                totalPages={Math.ceil(rows.length / SUMMARY_PAGE_SIZE)}
                onChange={setSummaryPage}
              />
            )}
          </div>
        )}
      </div>

      <SidePanel wide open={open} icon={<NavIcon name="dpr" size={17} />} title="New Daily Progress Report" desc="Fill in today's site details, then check off what work happened." onClose={() => setOpen(false)}>
        <DprForm isPublic={false} onDone={() => setOpen(false)} />
      </SidePanel>

      <SidePanel open={drOpen} icon={<NavIcon name="drawing" size={17} />} title="Request a Drawing" desc="Ask Planning/Design for a drawing you need on site" onClose={() => setDrOpen(false)}>
        <DrawingRequestForm isPublic={false} onDone={() => setDrOpen(false)} />
      </SidePanel>

      {viewReport && (
        <SidePanel open icon={<NavIcon name="dpr" size={17} />} title={`Report — ${viewReport.projectName || refLabel(data, "projects", viewReport.projectId)}`} desc="" onClose={() => setViewReportId(null)}>
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="form-grid">
              <div><span style={{ color: "var(--text-muted)" }}>Date: </span>{fmtDate(new Date(viewReport.date).getTime())}</div>
              <div><span style={{ color: "var(--text-muted)" }}>DRI: </span>{viewReport.submittedByName}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Contractor: </span>{viewReport.vendorName || viewReport.vendorCode}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Shift: </span>{viewReport.shift}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Labourers: </span>{viewReport.labourCount}</div>
            </div>
          </div>
          {viewReport.workEntries.map((entry) => (
            <div key={entry.category} className="card card-pad" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{entry.category}</div>
              {entry.generalPhotos.length > 0 && (
                <div className="photo-strip" style={{ marginBottom: 8 }}>
                  {entry.generalPhotos.map((p, i) => (
                    <img key={i} className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />
                  ))}
                </div>
              )}
              {(entry.beforePhotos.length > 0 || entry.afterPhotos.length > 0) && (
                <div style={{ display: "flex", gap: 16 }}>
                  {entry.beforePhotos.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Before</div>
                      <div className="photo-strip">
                        {entry.beforePhotos.map((p, i) => <img key={i} className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />)}
                      </div>
                    </div>
                  )}
                  {entry.afterPhotos.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>After</div>
                      <div className="photo-strip">
                        {entry.afterPhotos.map((p, i) => <img key={i} className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {entry.generalPhotos.length === 0 && entry.beforePhotos.length === 0 && entry.afterPhotos.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No photos attached.</div>
              )}
            </div>
          ))}
        </SidePanel>
      )}
    </div>
  );
}

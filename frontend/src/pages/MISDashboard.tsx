import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, projectFloors, projectUnits, trackStages } from "../shared/rules";
import {
  buildUnitRows, computeTopKpis, computeProjectOverview, computeStageProgress,
  computeSnagAnalysis, computePossessionTracker, computeTradePerformance, computeManagementAlerts,
  type MisFilters
} from "../shared/misData";
import { SEVERITIES } from "../services/config";
import Card from "../ui/tw/Card";
import Badge from "../ui/tw/Badge";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";

/* Management/CEO-facing MIS Dashboard — read-only aggregation over the
   existing BoardData via shared/misData.ts. No new endpoint, no change
   to any business rule, gating, or write path: every number here is
   derived from data the rest of the app already renders (unitSummary,
   openSnagsFor, trackStages, myProjects — all untouched). */

const ACCENT = "#FF7A00";

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "default" | "danger" }) {
  return (
    <Card className="!p-4">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{label}</div>
      <div className="text-2xl font-extrabold leading-tight" style={tone === "danger" ? { color: "#dc2626" } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-muted)] mt-1">{sub}</div>}
    </Card>
  );
}

function ProgressBar({ pct, color = ACCENT }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

function MiniBar({ rows, max }: { rows: { label: string; count: number; color?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12px]">
          <div className="w-28 shrink-0 truncate text-[var(--text-sub)]">{r.label}</div>
          <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.count / m) * 100}%`, background: r.color || ACCENT }} />
          </div>
          <div className="w-8 text-right font-semibold shrink-0">{r.count}</div>
        </div>
      ))}
      {rows.length === 0 && <div className="text-[12px] text-[var(--text-muted)]">No data.</div>}
    </div>
  );
}

function StatusPill({ status }: { status: "On Track" | "Needs Attention" | "At Risk" }) {
  const color = status === "On Track" ? "green" : status === "Needs Attention" ? "amber" : "red";
  return <Badge color={color as any}>{status}</Badge>;
}

export default function MISDashboard() {
  const { data, currentUserId, currentProjectId, openDrawer } = useApp();
  const allProjects = myProjects(data, currentUserId);

  const [projectId, setProjectId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [stageId, setStageId] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const floors = projectId ? projectFloors(data, projectId) : [];
  const units = projectId ? projectUnits(data, projectId).filter((u) => !floorId || u.floorId === floorId) : [];
  const tradeStages = projectId ? trackStages(data, projectId, "unit").filter((x) => x.stage.itemBased) : [];

  const filters: MisFilters = useMemo(() => ({
    projectId: projectId || undefined,
    floorId: floorId || undefined,
    unitId: unitId || undefined,
    stageId: stageId || undefined,
    severity: severity || undefined,
    status: status || undefined,
    fromTs: fromDate ? new Date(fromDate).getTime() : undefined,
    toTs: toDate ? new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1 : undefined
  }), [projectId, floorId, unitId, stageId, severity, status, fromDate, toDate]);

  const kpis = useMemo(() => computeTopKpis(data, currentUserId, filters), [data, currentUserId, filters]);
  const projectRows = useMemo(() => computeProjectOverview(data, currentUserId, filters), [data, currentUserId, filters]);
  const stageRows = useMemo(() => computeStageProgress(data, currentUserId, filters), [data, currentUserId, filters]);
  const snagAnalysis = useMemo(() => computeSnagAnalysis(data, currentUserId, filters), [data, currentUserId, filters]);
  const possession = useMemo(() => computePossessionTracker(data, currentUserId, filters), [data, currentUserId, filters]);
  const trades = useMemo(() => computeTradePerformance(data, currentUserId, filters), [data, currentUserId, filters]);
  const alerts = useMemo(() => computeManagementAlerts(data, currentUserId, filters), [data, currentUserId, filters]);

  const worstTrade = trades.slice().sort((a, b) => (b.criticalSnags * 10 + b.reopenRate) - (a.criticalSnags * 10 + a.reopenRate))[0];

  return (
    <div className="pb-10">
      <div className="flex items-start gap-3.5 mb-6">
        <div className="w-11 h-11 shrink-0 rounded-radius-md flex items-center justify-center" style={{ background: "rgba(255,122,0,0.12)", color: ACCENT }}>
          <NavIcon name="trend" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">Quality MIS Dashboard</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1">Management overview — project quality, snags, possession and trade performance, live.</div>
        </div>
      </div>

      {/* ---------------------------------------------------------- Filters */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
            <SearchDropdown value={projectId} onChange={(v) => { setProjectId(v); setFloorId(""); setUnitId(""); }} options={[{ value: "", label: "All Projects" }, ...allProjects.map((p) => ({ value: p.id, label: p.name }))]} neutralActive />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Floor</div>
            <SearchDropdown searchable={false} value={floorId} onChange={(v) => { setFloorId(v); setUnitId(""); }} options={[{ value: "", label: "All Floors" }, ...floors.map((f) => ({ value: f.id, label: f.name }))]} neutralActive disabled={!projectId} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Unit</div>
            <SearchDropdown value={unitId} onChange={setUnitId} options={[{ value: "", label: "All Units" }, ...units.map((u) => ({ value: u.id, label: u.name }))]} neutralActive disabled={!projectId} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Stage / Trade</div>
            <SearchDropdown searchable={false} value={stageId} onChange={setStageId} options={[{ value: "", label: "All Stages" }, ...tradeStages.map((x) => ({ value: x.stage.id, label: x.stage.name }))]} neutralActive disabled={!projectId} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Snag Severity</div>
            <SearchDropdown searchable={false} value={severity} onChange={setSeverity} options={[{ value: "", label: "All Severities" }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]} neutralActive />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Snag Status</div>
            <SearchDropdown searchable={false} value={status} onChange={setStatus} options={[{ value: "", label: "All Statuses" }, { value: "Open", label: "Open" }, { value: "In Progress", label: "In Progress" }, { value: "Closed", label: "Closed" }]} neutralActive />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">From</div>
            <input type="date" className="input w-full" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">To</div>
            <input type="date" className="input w-full" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------- 1. Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Total Projects" value={kpis.totalProjects} />
        <Kpi label="Total Units" value={kpis.totalUnits} />
        <Kpi label="Units Completed" value={kpis.unitsCompleted} />
        <Kpi label="Units In Progress" value={kpis.unitsInProgress} />
        <Kpi label="Open Snags" value={kpis.openSnags} />
        <Kpi label="Critical Snags" value={kpis.criticalSnags} tone={kpis.criticalSnags > 0 ? "danger" : "default"} />
        <Kpi label="Ready for Possession" value={kpis.unitsReadyForPossession} />
        <Kpi label="Avg. Snag Closure" value={kpis.avgSnagClosureDays == null ? "—" : `${kpis.avgSnagClosureDays}d`} />
      </div>

      {/* ---------------------------------------------- 7. Management Alerts */}
      {alerts.length > 0 && (
        <Card className="mb-6" style={{ borderColor: "rgba(220,38,38,0.35)" }}>
          <div className="flex items-center gap-2 mb-3">
            <NavIcon name="bug" size={16} />
            <div className="text-[13px] font-bold">Attention Required</div>
          </div>
          <div className="flex flex-col gap-2">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a.severity === "critical" ? "#dc2626" : "#f59e0b" }} />
                {a.text}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ----------------------------------------- 2. Project Quality Overview */}
      <Card className="mb-6">
        <div className="text-[13px] font-bold mb-4">Project Quality Overview</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                <th className="pb-2 pr-4">Project</th>
                <th className="pb-2 pr-4">Units</th>
                <th className="pb-2 pr-4">Completed</th>
                <th className="pb-2 pr-4">In Progress</th>
                <th className="pb-2 pr-4 w-[160px]">Quality %</th>
                <th className="pb-2 pr-4">Open Snags</th>
                <th className="pb-2 pr-4">Critical</th>
                <th className="pb-2 pr-4">Possession Ready</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {projectRows.map((p) => (
                <tr key={p.projectId} className="border-t border-[var(--border)]">
                  <td className="py-2.5 pr-4 font-semibold">{p.projectName}</td>
                  <td className="py-2.5 pr-4">{p.totalUnits}</td>
                  <td className="py-2.5 pr-4">{p.completedUnits}</td>
                  <td className="py-2.5 pr-4">{p.inProgressUnits}</td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-20"><ProgressBar pct={p.qualityPct} /></div>
                      <span className="font-semibold">{p.qualityPct}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">{p.openSnags}</td>
                  <td className="py-2.5 pr-4">{p.criticalSnags > 0 ? <span style={{ color: "#dc2626", fontWeight: 700 }}>{p.criticalSnags}</span> : 0}</td>
                  <td className="py-2.5 pr-4">{p.possessionReadyPct}%</td>
                  <td className="py-2.5"><StatusPill status={p.status} /></td>
                </tr>
              ))}
              {projectRows.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-[var(--text-muted)]">No projects in the current filter scope.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* -------------------------------------------- 3. Quality / Stage Progress */}
      <Card className="mb-6">
        <div className="text-[13px] font-bold mb-4">Quality / Stage Progress</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {stageRows.map((s) => (
            <div key={s.stageId} className="rounded-radius-md border border-[var(--border)] p-3">
              <div className="text-[12.5px] font-bold mb-2">{s.label}</div>
              <ProgressBar pct={s.pct} />
              <div className="text-[11px] text-[var(--text-muted)] mt-1.5">{s.pct}% complete</div>
              <div className="flex justify-between text-[11px] mt-2">
                <span>✅ {s.completed}</span>
                <span>🔶 {s.inProgress}</span>
                <span>⬜ {s.pending}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* --------------------------------------------------- 4. Snag Analysis */}
      <Card className="mb-6">
        <div className="text-[13px] font-bold mb-4">Snag Analysis</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Kpi label="Total" value={snagAnalysis.total} />
          <Kpi label="Critical" value={snagAnalysis.critical} tone={snagAnalysis.critical > 0 ? "danger" : "default"} />
          <Kpi label="Major" value={snagAnalysis.major} />
          <Kpi label="Minor" value={snagAnalysis.minor} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Open vs In Progress vs Closed</div>
            <MiniBar rows={[
              { label: "Open", count: snagAnalysis.open, color: "#dc2626" },
              { label: "In Progress", count: snagAnalysis.inProgress, color: "#f59e0b" },
              { label: "Closed", count: snagAnalysis.closed, color: "#16a34a" }
            ]} />
            <div className="text-[11.5px] text-[var(--text-muted)] mt-3">
              Avg. closure time: <b>{snagAnalysis.avgClosureDays == null ? "—" : `${snagAnalysis.avgClosureDays} days`}</b> · Reopened: <b>{snagAnalysis.reopened}</b>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">By Trade</div>
            <MiniBar rows={snagAnalysis.byTrade.map((t) => ({ label: t.label, count: t.count }))} />
          </div>
        </div>
        {snagAnalysis.byProject.length > 0 && (
          <div className="mt-5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">By Project</div>
            <MiniBar rows={snagAnalysis.byProject.map((p) => ({ label: p.name, count: p.count }))} />
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ 5. Possession Tracker */}
      <Card className="mb-6">
        <div className="text-[13px] font-bold mb-4">Possession Tracker</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Internal Ready" value={`${possession.internalReadyPct}%`} />
          <Kpi label="Owner Ready" value={`${possession.ownerReadyPct}%`} />
          <Kpi label="Pending Internal" value={possession.pendingInternal} />
          <Kpi label="Pending Owner" value={possession.pendingOwner} />
          <Kpi label="Failed — Internal" value={possession.failedInternal} tone={possession.failedInternal > 0 ? "danger" : "default"} />
          <Kpi label="Failed — Owner" value={possession.failedOwner} tone={possession.failedOwner > 0 ? "danger" : "default"} />
        </div>
        {possession.waitingRectification.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Units Waiting for Rectification</div>
            <div className="flex flex-wrap gap-2">
              {possession.waitingRectification.slice(0, 24).map((u) => (
                <button key={u.unitId} className="text-[11.5px] px-2.5 py-1 rounded-full border border-[var(--border)] hover:bg-[var(--bg-card-hover)]" onClick={() => openDrawer({ kind: "unit", id: u.unitId })}>
                  {u.unitName} · {u.projectName}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ 6. Trade Performance */}
      <Card className="mb-6">
        <div className="text-[13px] font-bold mb-1">Contractor / Trade Performance</div>
        <div className="text-[11.5px] text-[var(--text-muted)] mb-4">
          Grouped by construction trade (no separate contractor field exists in the data model yet — this is the most reliable proxy available today).
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                <th className="pb-2 pr-4">Trade</th>
                <th className="pb-2 pr-4">Units Handled</th>
                <th className="pb-2 pr-4 w-[160px]">Progress</th>
                <th className="pb-2 pr-4">Open Snags</th>
                <th className="pb-2 pr-4">Critical</th>
                <th className="pb-2 pr-4">Closed</th>
                <th className="pb-2 pr-4">Reopen Rate</th>
                <th className="pb-2">Avg. Closure</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.stageId} className="border-t border-[var(--border)]" style={worstTrade && t.stageId === worstTrade.stageId && (worstTrade.criticalSnags > 0 || worstTrade.reopenRate > 20) ? { background: "rgba(220,38,38,0.05)" } : undefined}>
                  <td className="py-2.5 pr-4 font-semibold">
                    {t.label}
                    {worstTrade && t.stageId === worstTrade.stageId && (worstTrade.criticalSnags > 0 || worstTrade.reopenRate > 20) && (
                      <span className="ml-2"><Badge color="red">Underperforming</Badge></span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">{t.unitsHandled}</td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-20"><ProgressBar pct={t.workProgressPct} /></div>
                      <span className="font-semibold">{t.workProgressPct}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">{t.openSnags}</td>
                  <td className="py-2.5 pr-4">{t.criticalSnags > 0 ? <span style={{ color: "#dc2626", fontWeight: 700 }}>{t.criticalSnags}</span> : 0}</td>
                  <td className="py-2.5 pr-4">{t.closedSnags}</td>
                  <td className="py-2.5 pr-4">{t.reopenRate}%</td>
                  <td className="py-2.5">{t.avgClosureDays == null ? "—" : `${t.avgClosureDays}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

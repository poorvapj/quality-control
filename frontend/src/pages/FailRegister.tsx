import React, { useMemo, useRef, useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, byId } from "../shared/rules";
import { type DateRange, DATE_RANGES, dateRangeBounds } from "../shared/dateRange";
import CalendarRangePicker from "../components/CalendarRangePicker";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import StatTile from "../components/StatTile";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { TabKey } from "../types";

/* A standing register of every Work Quality Inspection that came back
 * Fail or Rework Required, across every project — a permanent record
 * (never cleared/archived) separate from Quality Inspection's own list,
 * which is meant for day-to-day filtering rather than "show me the whole
 * history of what's gone wrong". */
export default function FailRegister() {
  const { data, currentUserId, setActiveTab, setReInspectQualityId, setCaseStudyDraft } = useApp();
  const allProjects = myProjects(data, currentUserId);
  const allowedProjectCodes = new Set(allProjects.map((p) => p.code));
  const inspections = coll(data, "qualityInspections").filter((i) => allowedProjectCodes.has(i.projectCode));
  const snags = coll(data, "snags");
  const users = coll(data, "users");

  const fails = inspections.filter((i) => i.result !== "Pass");

  const [fProjectId, setFProjectId] = useState("");
  const [fRange, setFRange] = useState<DateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!calendarOpen) return;
    function onDocClick(e: MouseEvent) {
      if (calendarWrapRef.current && !calendarWrapRef.current.contains(e.target as Node)) setCalendarOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [calendarOpen]);
  const dateBounds = fRange === "custom"
    ? (customFrom || customTo ? { from: customFrom || "0000-01-01", to: customTo || "9999-12-31" } : null)
    : dateRangeBounds(fRange);

  const filtered = useMemo(() => {
    return fails.filter((i) => {
      if (fProjectId && i.projectId !== fProjectId) return false;
      if (dateBounds) { const d = i.inspectionDate; if (d < dateBounds.from || d > dateBounds.to) return false; }
      return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fails, fProjectId, dateBounds]);

  const openCount = filtered.filter((i) => {
    const s = i.linkedSnagId ? byId(snags, i.linkedSnagId) : null;
    return s && s.status !== "Closed";
  }).length;
  const overdueCount = filtered.filter((i) => {
    const s = i.linkedSnagId ? byId(snags, i.linkedSnagId) : null;
    return s && s.status !== "Closed" && s.dueAt && s.dueAt < Date.now();
  }).length;
  const resolvedCount = filtered.filter((i) => {
    const s = i.linkedSnagId ? byId(snags, i.linkedSnagId) : null;
    return s && s.status === "Closed";
  }).length;

  const projectOptions = allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));

  function downloadCsv() {
    const header = ["Date", "Project", "Floor", "Checklist", "Result", "Inspector", "Contractor", "Assigned DRI", "Target Date", "Snag Status", "Remarks"];
    // Excel/Sheets both choke on a bare comma/quote/newline inside a field
    // without this — wrap every value in quotes and double up any quote
    // already inside it, the standard CSV escaping rule.
    const esc = (v: string | number | undefined | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    for (const insp of filtered) {
      const snag = insp.linkedSnagId ? byId(snags, insp.linkedSnagId) : null;
      const overdue = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
      const assignedDri = insp.correctiveAction?.assignedToName || byId(users, insp.correctiveAction?.assignedToUserId || null)?.name || "";
      const snagStatus = !snag ? "" : snag.status === "Closed" ? "Resolved" : overdue ? "Overdue" : snag.status;
      lines.push([
        insp.inspectionDate, insp.projectCode, insp.floorName + (insp.unitName ? ` / ${insp.unitName}` : ""),
        insp.workType || "", insp.result, insp.inspectorName, insp.contractor || "",
        assignedDri, insp.correctiveAction?.targetDate || "", snagStatus, insp.remarks || ""
      ].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Fail-Register-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div
            className="shrink-0 cursor-pointer text-[var(--text-muted)] flex items-center"
            style={{ height: "44px" }}
            onClick={() => setActiveTab("qualityInspection" as TabKey)}
            title="Back to Quality Inspection"
          >
            <NavIcon name="chevronsLeft" size={18} />
          </div>
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="bug" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Fail Register</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Every Work Quality Inspection that came back Fail or Rework Required, across all projects — a standing record, not filtered to "right now".
            </div>
          </div>
        </div>
        <Btn label="Download CSV" color="secondary" icon="download" onClick={downloadCsv} />
      </div>

      <div className="flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[180px]" style={{ position: "relative" }} ref={calendarWrapRef}>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Date Range</div>
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
            <div className="text-[11px] text-[var(--text-muted)] mt-1">{customFrom} → {customTo}</div>
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
        <div className="max-w-[220px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown value={fProjectId} onChange={setFProjectId} options={[{ value: "", label: "All projects" }, ...projectOptions]} neutralActive />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Total Fails" value={filtered.length} icon="bug" />
        <StatTile label="Open" value={openCount} icon="bug" valueClassName={openCount > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Overdue" value={overdueCount} icon="clock" valueClassName={overdueCount > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Resolved" value={resolvedCount} icon="award" />
      </div>

      <Card padded={false} className="p-[18px]">
        <Table
          columns={["Date", "Project", "Floor", "Checklist", "Result", "Inspector", "Assigned DRI", "Snag Status", ""]}
          colWidths={["100px", "90px", "160px", "180px", "120px", "120px", "130px", "110px", "150px"]}
          maxHeight="560px"
        >
          {filtered.map((insp) => {
            const snag = insp.linkedSnagId ? byId(snags, insp.linkedSnagId) : null;
            const overdue = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
            const canReinspect = insp.result !== "Pass" && snag?.status !== "Closed";
            return (
              <TableRow
                key={insp.id}
                onClick={canReinspect ? () => { setReInspectQualityId(insp.id); setActiveTab("qualityInspection" as TabKey); } : undefined}
              >
                <TableCell muted className="whitespace-nowrap">{insp.inspectionDate}</TableCell>
                <TableCell className="whitespace-nowrap">{insp.projectCode}</TableCell>
                <TableCell strong>{insp.floorName}{insp.unitName ? ` / ${insp.unitName}` : ""}</TableCell>
                <TableCell muted>{insp.workType || "—"}</TableCell>
                <TableCell>
                  <Badge color={insp.result === "Fail" ? "red" : "amber"}><span className="whitespace-nowrap">{insp.result}</span></Badge>
                </TableCell>
                <TableCell muted className="truncate max-w-0">{insp.inspectorName}</TableCell>
                <TableCell muted className="truncate max-w-0">{insp.correctiveAction?.assignedToName || byId(users, insp.correctiveAction?.assignedToUserId || null)?.name || "—"}</TableCell>
                <TableCell>
                  {!snag ? <span className="text-[var(--text-sub)]">—</span> : (
                    <Badge color={snag.status === "Closed" ? "green" : overdue ? "red" : "amber"}>
                      <span className="whitespace-nowrap">{snag.status === "Closed" ? "Resolved" : overdue ? "Overdue" : snag.status}</span>
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Btn
                    label="Write up as Case Study"
                    color="secondary"
                    size="sm"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      setCaseStudyDraft({
                        projectId: insp.projectId,
                        floorId: insp.floorId,
                        category: insp.workType,
                        linkedInspectionId: insp.id
                      });
                      setActiveTab("caseStudies" as TabKey);
                    }}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

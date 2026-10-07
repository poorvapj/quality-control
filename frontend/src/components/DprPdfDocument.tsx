import React from "react";
import { Document, Page, View, Text, StyleSheet, pdf } from "@react-pdf/renderer";

const ORANGE = "#FF7A00";
const DARK = "#111827";
const MID = "#374151";
const GRAY = "#6B7280";
const LIGHT = "#F9FAFB";
const BORDER = "#D1D5DB";
const HDR_BG = "#1F2937";
// Same tint as the app's --theme-primary-tint — used for the per-project
// vendor breakdown's header so it reads as "nested under" its parent
// project row instead of another top-level section.
const TINT = "#FFECDA";
const RED = "#DC2626";
const AMBER = "#D97706";
const GREEN = "#16A34A";

const S = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: DARK, backgroundColor: "#fff" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: ORANGE },
  logoName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: DARK },
  logoSub: { fontSize: 8, color: GRAY, marginTop: 2 },
  docTitle: { textAlign: "right" },
  docMain: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ORANGE },
  docSub: { fontSize: 9, color: MID, marginTop: 3 },
  table: { borderWidth: 1, borderColor: BORDER, borderRadius: 3, marginBottom: 9, overflow: "hidden" },
  secHeader: { backgroundColor: ORANGE, paddingVertical: 4, paddingHorizontal: 10 },
  secTitle: { fontFamily: "Helvetica-Bold", color: "#fff", fontSize: 9, textTransform: "uppercase" },
  row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: BORDER },
  rowAlt: { flexDirection: "row", borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: LIGHT },
  cellLabel: { flex: 1.4, padding: "4px 10px", fontSize: 8.5, color: MID },
  cellVal: { flex: 1, padding: "4px 10px", fontSize: 8.5, color: DARK, textAlign: "right", fontFamily: "Helvetica-Bold" },
  hdr: { flexDirection: "row", backgroundColor: HDR_BG, padding: "4px 8px" },
  hdrText: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  col: { flex: 1, fontSize: 8, padding: "2px 4px" },
  bullet: { flexDirection: "row", borderTopWidth: 1, borderTopColor: BORDER, padding: "4px 10px", gap: 6 },
  subWrap: { marginHorizontal: 10, marginBottom: 6, marginTop: 2, borderWidth: 1, borderColor: BORDER, borderRadius: 3, overflow: "hidden" },
  subHeader: { backgroundColor: TINT, paddingVertical: 3, paddingHorizontal: 8, flexDirection: "row", justifyContent: "space-between" },
  subTitle: { fontFamily: "Helvetica-Bold", color: DARK, fontSize: 8 },
  subMeta: { fontFamily: "Helvetica-Bold", color: ORANGE, fontSize: 8 }
});

function KpiTable({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <View style={S.table} wrap={false}>
      <View style={S.secHeader}><Text style={S.secTitle}>{title}</Text></View>
      {rows.map((r) => (
        <View key={r.label} style={S.row}>
          <Text style={S.cellLabel}>{r.label}</Text>
          <Text style={S.cellVal}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

// keepTogether forces the whole table (header + every row) onto one page —
// if it doesn't fit the remaining space it flows whole to the next page
// instead of splitting mid-table with the header left behind. Only safe for
// small, bounded tables — an unbounded one could be taller than a full page
// and get clipped instead of paginating.
function DataTable({ title, columns, widths, rows, emptyLabel, breakBefore, keepTogether, badge }: {
  title: string; columns: string[]; widths?: number[]; rows: string[][]; emptyLabel?: string; breakBefore?: boolean; keepTogether?: boolean; badge?: string;
}) {
  return (
    <View style={S.table} break={breakBefore} wrap={keepTogether ? false : undefined}>
      <View style={[S.secHeader, { flexDirection: "row", justifyContent: "space-between" }]} wrap={false}>
        <Text style={S.secTitle}>{title}</Text>
        {badge && <Text style={[S.secTitle, { textTransform: "none" }]}>{badge}</Text>}
      </View>
      <View style={S.hdr} wrap={false}>
        {columns.map((c, i) => <Text key={c} style={[S.col, S.hdrText, widths ? { flex: widths[i] } : {}]}>{c}</Text>)}
      </View>
      {rows.length === 0 ? (
        <View style={S.row}><Text style={[S.col, { padding: "6px 10px", color: GRAY, flex: columns.length }]}>{emptyLabel || "No records."}</Text></View>
      ) : rows.map((row, i) => (
        <View key={i} style={i % 2 === 0 ? S.row : S.rowAlt} wrap={false}>
          {row.map((cell, j) => <Text key={j} style={[S.col, widths ? { flex: widths[j] } : {}]}>{cell}</Text>)}
        </View>
      ))}
    </View>
  );
}

const ACTION_COLOR: Record<string, string> = { critical: RED, warning: AMBER, good: GREEN };

// The per-project contractor/work-type/labour breakdown nested under
// Project-wise Labour Summary — same four columns as the on-screen labour
// flashcards (Vendor Code, Contractor Name, Work Type, Labour Count).
function VendorBreakdownTable({ projectName, totalLabour, rows }: {
  projectName: string; totalLabour: number;
  rows: { vendorCode: string; vendorName: string; workType: string; labourCount: number }[];
}) {
  return (
    <View style={S.subWrap} wrap={false}>
      <View style={S.subHeader}>
        <Text style={S.subTitle}>{projectName}</Text>
        <Text style={S.subMeta}>Labour Count: {totalLabour.toLocaleString("en-IN")}</Text>
      </View>
      <View style={S.hdr}>
        <Text style={[S.col, S.hdrText]}>Vendor Code</Text>
        <Text style={[S.col, S.hdrText]}>Contractor Name</Text>
        <Text style={[S.col, S.hdrText]}>Work Type</Text>
        <Text style={[S.col, S.hdrText, { textAlign: "right" }]}>Labour Count</Text>
      </View>
      {rows.length === 0 ? (
        <View style={S.row}><Text style={[S.col, { padding: "6px 10px", color: GRAY, flex: 4 }]}>No contractor entries.</Text></View>
      ) : rows.map((r, i) => (
        <View key={r.vendorCode} style={i % 2 === 0 ? S.row : S.rowAlt}>
          <Text style={S.col}>{r.vendorCode}</Text>
          <Text style={S.col}>{r.vendorName}</Text>
          <Text style={S.col}>{r.workType}</Text>
          <Text style={[S.col, { textAlign: "right" }]}>{r.labourCount}</Text>
        </View>
      ))}
    </View>
  );
}

export interface DprPdfData {
  scopeLabel: string;
  periodLabel: string;
  generatedAt: number;
  generatedBy: string;
  kpis: { totalLabour: number; projectsCovered: number; totalContractors: number; workTypes: number; reportingDays: number; reportsSubmitted: number; drawingRequests: number };
  projectSummary: {
    projectName: string; labour: number; contractors: number; reportsCount: number; majorWorkType: string; changePct: number | null;
    vendorBreakdown: { vendorCode: string; vendorName: string; workType: string; labourCount: number }[];
  }[];
  workTypeSummary: { workType: string; entries: number; pct: number }[];
  // No Work Order column — QC has no Work Order entity, only a per-
  // project+category Work Target, so each row is just that.
  workProgress: { workItem: string; projectName: string; unit: string; planned: number; completed: number; pct: number }[];
  drawingRequests: { ticketNo: string; description: string; projectName: string; driName: string; stageLabel: string; requestedOn: string; daysSince: number }[];
  actionItems: { level: "critical" | "warning" | "good"; text: string }[];
}

export function DprDocument({ data }: { data: DprPdfData }) {
  const s = data;
  return (
    <Document title={`Daily Progress Report - ${s.periodLabel}`} author="Neoteric Properties">
      <Page size="A4" style={S.page}>
        <View style={S.headerRow}>
          <View>
            <Text style={S.logoName}>Neoteric Properties</Text>
            <Text style={S.logoSub}>Project Cost Center</Text>
          </View>
          <View style={S.docTitle}>
            <Text style={S.docMain}>DAILY PROGRESS REPORT</Text>
            <Text style={S.docSub}>Scope: {s.scopeLabel}</Text>
            <Text style={S.docSub}>Period: {s.periodLabel}</Text>
            <Text style={S.docSub}>Generated: {new Date(s.generatedAt).toLocaleString("en-IN")} by {s.generatedBy}</Text>
          </View>
        </View>

        <KpiTable title="Executive Summary" rows={[
          { label: "Total Labour", value: s.kpis.totalLabour.toLocaleString("en-IN") },
          { label: "Projects Covered", value: String(s.kpis.projectsCovered) },
          { label: "Contractors Active", value: String(s.kpis.totalContractors) },
          { label: "Work Types Logged", value: String(s.kpis.workTypes) },
          { label: "Reporting Days", value: String(s.kpis.reportingDays) },
          { label: "Reports Submitted", value: String(s.kpis.reportsSubmitted) },
          { label: "Drawing Requests (in scope)", value: String(s.kpis.drawingRequests) }
        ]} />

        <DataTable
          title="Project-wise Labour Summary"
          columns={["Project", "Labour", "Contractors", "Reports", "Major Work Type", "vs Previous Period"]}
          widths={[1.6, 0.7, 0.9, 0.7, 1.2, 1]}
          rows={s.projectSummary.map((p) => [
            p.projectName, p.labour.toLocaleString("en-IN"), String(p.contractors), String(p.reportsCount), p.majorWorkType,
            p.changePct === null ? "—" : `${p.changePct >= 0 ? "Up" : "Down"} ${Math.abs(p.changePct)}%`
          ])}
          emptyLabel="No progress reports in this period."
        />

        {s.projectSummary.map((p) => (
          <VendorBreakdownTable key={p.projectName} projectName={p.projectName} totalLabour={p.labour} rows={p.vendorBreakdown} />
        ))}

        <DataTable
          title="Work Categories Logged (by report entries)"
          columns={["Work Type", "Entries", "% Share"]}
          rows={s.workTypeSummary.map((w) => [w.workType, String(w.entries), `${w.pct}%`])}
          emptyLabel="No work categories logged in this period."
          keepTogether
        />

        <DataTable
          title="Work Progress — Planned vs Completed"
          columns={["Work Item", "Project", "Unit", "Planned", "Completed", "Progress"]}
          widths={[1.5, 1.3, 0.6, 0.8, 0.8, 0.7]}
          rows={s.workProgress.map((w) => [w.workItem, w.projectName, w.unit || "—", w.planned.toLocaleString("en-IN"), w.completed.toLocaleString("en-IN"), `${w.pct}%`])}
          emptyLabel="No Work Targets set for this filter yet."
        />

        <DataTable
          title="Drawing Request Status"
          columns={["Ticket", "Description", "Project", "Requested By", "Stage", "Requested On", "Days"]}
          widths={[0.7, 1.6, 1, 0.9, 1.1, 0.9, 0.5]}
          rows={s.drawingRequests.map((d) => [d.ticketNo, d.description, d.projectName, d.driName, d.stageLabel, d.requestedOn, String(d.daysSince)])}
          emptyLabel="No drawing requests in scope."
        />

        <View style={S.table} wrap={false}>
          <View style={S.secHeader}><Text style={S.secTitle}>Action Required</Text></View>
          {s.actionItems.map((a, i) => (
            <View key={i} style={S.bullet}>
              <Text style={{ color: ACTION_COLOR[a.level], fontSize: 8 }}>•</Text>
              <Text style={{ fontSize: 8.5, color: MID, flex: 1 }}>{a.text}</Text>
            </View>
          ))}
        </View>

        <View style={S.table} wrap={false}>
          <View style={S.secHeader}><Text style={S.secTitle}>Coordinator Remarks</Text></View>
          <View style={{ padding: 12, height: 60 }} />
        </View>
      </Page>
    </Document>
  );
}

export async function downloadDprPdf(data: DprPdfData) {
  const blob = await pdf(<DprDocument data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = data.periodLabel.replace(/[^\w]+/g, "-");
  a.download = `Daily-Progress-Report-${slug}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

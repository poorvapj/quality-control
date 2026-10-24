import React from "react";
import { Document, Page, View, Text, StyleSheet, pdf } from "@react-pdf/renderer";

const ORANGE = "#FF7A00";
const DARK = "#111827";
const MID = "#374151";
const GRAY = "#6B7280";
const LIGHT = "#F9FAFB";
const BORDER = "#D1D5DB";
const HDR_BG = "#1F2937";
const RED = "#DC2626";
const AMBER = "#D97706";
const GREEN = "#16A34A";

const RESULT_COLOR: Record<string, string> = { Pass: GREEN, Fail: RED, "Rework Required": AMBER };

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
  col: { flex: 1, fontSize: 8, padding: "2px 4px" }
});

function KpiTable({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <View style={S.table} wrap={false}>
      <View style={S.secHeader}><Text style={S.secTitle}>{title}</Text></View>
      {rows.map((r) => (
        <View key={r.label} style={S.row}>
          <Text style={S.cellLabel}>{r.label}</Text>
          <Text style={[S.cellVal, r.color ? { color: r.color } : {}]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export interface QcInspectionPdfRow {
  date: string; projectCode: string; floor: string; workType: string; result: string; inspector: string; snagStatus: string;
}

export interface QcInspectionPdfData {
  scopeLabel: string;
  periodLabel: string;
  generatedAt: number;
  generatedBy: string;
  kpis: { total: number; pass: number; fail: number; rework: number; passRate: number; overdue: number; resolved: number };
  rows: QcInspectionPdfRow[];
}

function QcDocument({ data: s }: { data: QcInspectionPdfData }) {
  return (
    <Document title={`Work Quality Inspection Report - ${s.periodLabel}`} author="Neoteric Properties">
      <Page size="A4" style={S.page}>
        <View style={S.headerRow}>
          <View>
            <Text style={S.logoName}>Neoteric Properties</Text>
            <Text style={S.logoSub}>Quality Control</Text>
          </View>
          <View style={S.docTitle}>
            <Text style={S.docMain}>WORK QUALITY INSPECTION REPORT</Text>
            <Text style={S.docSub}>Scope: {s.scopeLabel}</Text>
            <Text style={S.docSub}>Period: {s.periodLabel}</Text>
            <Text style={S.docSub}>Generated: {new Date(s.generatedAt).toLocaleString("en-IN")} by {s.generatedBy}</Text>
          </View>
        </View>

        <KpiTable title="Summary" rows={[
          { label: "Total Inspections", value: String(s.kpis.total) },
          { label: "Pass", value: String(s.kpis.pass), color: GREEN },
          { label: "Fail", value: String(s.kpis.fail), color: RED },
          { label: "Pass Rate", value: `${s.kpis.passRate}%` },
          { label: "Overdue Corrective Actions", value: String(s.kpis.overdue), color: s.kpis.overdue > 0 ? RED : undefined },
          { label: "Resolved", value: String(s.kpis.resolved), color: GREEN }
        ]} />

        <View style={S.table}>
          <View style={S.secHeader}><Text style={S.secTitle}>Inspections ({s.rows.length})</Text></View>
          <View style={S.hdr} wrap={false}>
            <Text style={[S.col, S.hdrText, { flex: 0.7 }]}>Date</Text>
            <Text style={[S.col, S.hdrText, { flex: 0.7 }]}>Project</Text>
            <Text style={[S.col, S.hdrText, { flex: 1.3 }]}>Floor</Text>
            <Text style={[S.col, S.hdrText, { flex: 1.3 }]}>Checklist</Text>
            <Text style={[S.col, S.hdrText, { flex: 0.9 }]}>Result</Text>
            <Text style={[S.col, S.hdrText, { flex: 1 }]}>Inspector</Text>
            <Text style={[S.col, S.hdrText, { flex: 0.8 }]}>Snag</Text>
          </View>
          {s.rows.length === 0 ? (
            <View style={S.row}><Text style={[S.col, { padding: "6px 10px", color: GRAY, flex: 7 }]}>No inspections match these filters.</Text></View>
          ) : s.rows.map((r, i) => (
            <View key={i} style={i % 2 === 0 ? S.row : S.rowAlt} wrap={false}>
              <Text style={[S.col, { flex: 0.7 }]}>{r.date}</Text>
              <Text style={[S.col, { flex: 0.7 }]}>{r.projectCode}</Text>
              <Text style={[S.col, { flex: 1.3 }]}>{r.floor}</Text>
              <Text style={[S.col, { flex: 1.3 }]}>{r.workType}</Text>
              <Text style={[S.col, { flex: 0.9, color: RESULT_COLOR[r.result] || DARK, fontFamily: "Helvetica-Bold" }]}>{r.result}</Text>
              <Text style={[S.col, { flex: 1 }]}>{r.inspector}</Text>
              <Text style={[S.col, { flex: 0.8 }]}>{r.snagStatus}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

export async function downloadQcInspectionPdf(data: QcInspectionPdfData) {
  const blob = await pdf(<QcDocument data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = data.periodLabel.replace(/[^\w]+/g, "-");
  a.download = `Quality-Inspection-Report-${slug}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

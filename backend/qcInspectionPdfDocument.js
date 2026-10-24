/* Server-side mirror of frontend/src/components/QcInspectionPdfDocument.tsx's
 * <QcDocument> — same styles/layout, written with React.createElement (no
 * JSX here; the backend has no build step), so the weekly scheduled Quality
 * report looks identical to the one people download from Work Quality
 * Inspection's "Generate Report" button. Input shape matches that file's
 * QcInspectionPdfData interface exactly.
 */
const React = require("react");
const { Document, Page, View, Text, StyleSheet, renderToBuffer } = require("@react-pdf/renderer");

const h = React.createElement;

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

const RESULT_COLOR = { Pass: GREEN, Fail: RED, "Rework Required": AMBER };

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

function KpiTable({ title, rows }) {
  return h(View, { style: S.table, wrap: false },
    h(View, { style: S.secHeader }, h(Text, { style: S.secTitle }, title)),
    ...rows.map((r) => h(View, { key: r.label, style: S.row },
      h(Text, { style: S.cellLabel }, r.label),
      h(Text, { style: [S.cellVal, r.color ? { color: r.color } : {}] }, r.value)
    ))
  );
}

function QcDocument({ data: s }) {
  return h(Document, { title: `Work Quality Inspection Report - ${s.periodLabel}`, author: "Neoteric Properties" },
    h(Page, { size: "A4", style: S.page },
      h(View, { style: S.headerRow },
        h(View, {},
          h(Text, { style: S.logoName }, "Neoteric Properties"),
          h(Text, { style: S.logoSub }, "Quality Control")
        ),
        h(View, { style: S.docTitle },
          h(Text, { style: S.docMain }, "WORK QUALITY INSPECTION REPORT"),
          h(Text, { style: S.docSub }, `Scope: ${s.scopeLabel}`),
          h(Text, { style: S.docSub }, `Period: ${s.periodLabel}`),
          h(Text, { style: S.docSub }, `Generated: ${new Date(s.generatedAt).toLocaleString("en-IN")} by ${s.generatedBy}`)
        )
      ),

      h(KpiTable, { title: "Summary", rows: [
        { label: "Total Inspections", value: String(s.kpis.total) },
        { label: "Pass", value: String(s.kpis.pass), color: GREEN },
        { label: "Fail", value: String(s.kpis.fail), color: RED },
        { label: "Pass Rate", value: `${s.kpis.passRate}%` },
        { label: "Overdue Corrective Actions", value: String(s.kpis.overdue), color: s.kpis.overdue > 0 ? RED : undefined }
      ] }),

      h(View, { style: S.table },
        h(View, { style: S.secHeader }, h(Text, { style: S.secTitle }, `Inspections (${s.rows.length})`)),
        h(View, { style: S.hdr, wrap: false },
          h(Text, { style: [S.col, S.hdrText, { flex: 0.7 }] }, "Date"),
          h(Text, { style: [S.col, S.hdrText, { flex: 0.7 }] }, "Project"),
          h(Text, { style: [S.col, S.hdrText, { flex: 1.3 }] }, "Floor"),
          h(Text, { style: [S.col, S.hdrText, { flex: 1.3 }] }, "Checklist"),
          h(Text, { style: [S.col, S.hdrText, { flex: 0.9 }] }, "Result"),
          h(Text, { style: [S.col, S.hdrText, { flex: 1 }] }, "Inspector"),
          h(Text, { style: [S.col, S.hdrText, { flex: 0.8 }] }, "Snag")
        ),
        s.rows.length === 0
          ? h(View, { style: S.row }, h(Text, { style: [S.col, { padding: "6px 10px", color: GRAY, flex: 7 }] }, "No inspections match these filters."))
          : s.rows.map((r, i) => h(View, { key: i, style: i % 2 === 0 ? S.row : S.rowAlt, wrap: false },
              h(Text, { style: [S.col, { flex: 0.7 }] }, r.date),
              h(Text, { style: [S.col, { flex: 0.7 }] }, r.projectCode),
              h(Text, { style: [S.col, { flex: 1.3 }] }, r.floor),
              h(Text, { style: [S.col, { flex: 1.3 }] }, r.workType),
              h(Text, { style: [S.col, { flex: 0.9, color: RESULT_COLOR[r.result] || DARK, fontFamily: "Helvetica-Bold" }] }, r.result),
              h(Text, { style: [S.col, { flex: 1 }] }, r.inspector),
              h(Text, { style: [S.col, { flex: 0.8 }] }, r.snagStatus)
            ))
      )
    )
  );
}

async function renderQcInspectionPdfBuffer(data) {
  return renderToBuffer(h(QcDocument, { data }));
}

module.exports = { renderQcInspectionPdfBuffer };

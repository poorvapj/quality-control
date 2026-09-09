/** Shared section-block model for the PDF (print) and Excel possession
 *  reports — one report is built once as a list of sections and rendered
 *  by both exporters, so their content never drifts apart. Mirrors the
 *  reference design: a header block, an "Executive Summary" KPI list,
 *  one or more data tables, a bulleted "Action Required" list, and a
 *  blank "Remarks" box at the end. */
export type ReportSection =
  | { type: "kpi"; title: string; items: { label: string; value: string | number }[] }
  | { type: "table"; title: string; headers: string[]; rows: (string | number | null | undefined)[][] }
  | { type: "bullets"; title: string; items: string[] }
  | { type: "remarks"; title: string };

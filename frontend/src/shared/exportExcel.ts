import type { ReportSection } from "./reportSections";

/** Downloads a real, column-correct, properly-labeled spreadsheet with zero
 *  new dependencies. Plain CSV (shared/csv.ts's downloadCsv) breaks on many
 *  India-locale Excel installs — those expect ";" as the list separator
 *  (comma is the decimal separator there), so a comma-delimited .csv opens
 *  with every field crammed into column A instead of one column per header.
 *  An HTML <table> saved with a .xls name and the right MIME type opens
 *  natively in Excel as a real, styled grid regardless of locale — no
 *  library needed. Inline styles below are the small subset Excel's HTML
 *  import actually honors (background/border/bold/font-size).
 *
 *  Renders the same shared/reportSections.ts ReportSection[] the PDF
 *  export uses, as stacked one-table-per-section blocks (Excel has no
 *  real notion of "sections" within one sheet), so both exports always
 *  show identical data. */
export function downloadExcelReport(
  name: string, companyName: string, reportTitle: string, scopeLine: string, periodLine: string, generatedLine: string,
  sections: ReportSection[]
): void {
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cell = "border:1px solid #d0d5dd;padding:6px 10px;font-family:Arial,sans-serif;font-size:12px;";
  const bare = "border:none;padding:2px 10px;font-family:Arial,sans-serif;font-size:12px;";
  const sectionBar = (title: string, span: number) =>
    `<tr><td colspan="${span}" style="${cell}background:#ff7a00;color:#fff;font-weight:bold;text-transform:uppercase;font-size:11px;">${esc(title)}</td></tr>`;

  const blocks = sections.map((s) => {
    if (s.type === "kpi") {
      return sectionBar(s.title, 2) + s.items.map((it) =>
        `<tr><td style="${cell}">${esc(it.label)}</td><td style="${cell}font-weight:bold;">${esc(it.value)}</td></tr>`
      ).join("");
    }
    if (s.type === "table") {
      const span = s.headers.length;
      return sectionBar(s.title, span) +
        `<tr>` + s.headers.map((h) => `<th style="${cell}background:#1e293b;color:#fff;text-align:left;">${esc(h)}</th>`).join("") + `</tr>` +
        (s.rows.length
          ? s.rows.map((r) => "<tr>" + r.map((c) => `<td style="${cell}">${esc(c)}</td>`).join("") + "</tr>").join("")
          : `<tr><td colspan="${span}" style="${cell}text-align:center;color:#94a3b8;">No records.</td></tr>`);
    }
    if (s.type === "bullets") {
      return sectionBar(s.title, 1) + (s.items.length
        ? s.items.map((t) => `<tr><td style="${cell}">• ${esc(t)}</td></tr>`).join("")
        : `<tr><td style="${cell}color:#94a3b8;">Nothing to flag.</td></tr>`);
    }
    return sectionBar(s.title, 1) + `<tr><td style="${cell}height:50px;"></td></tr>`;
  }).join(`<tr><td style="border:none;height:10px;"></td></tr>`);

  const html =
    `<table style="border-collapse:collapse;">` +
    `<tr><td style="${bare}font-size:18px;font-weight:bold;">${esc(companyName)}</td></tr>` +
    `<tr><td style="${bare}font-size:16px;font-weight:bold;color:#ff7a00;">${esc(reportTitle)}</td></tr>` +
    `<tr><td style="${bare}color:#64748b;">${esc(scopeLine)}</td></tr>` +
    `<tr><td style="${bare}color:#64748b;">${esc(periodLine)}</td></tr>` +
    `<tr><td style="${bare}color:#64748b;padding-bottom:14px;">${esc(generatedLine)}</td></tr>` +
    blocks +
    "</table>";

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  a.download = name.endsWith(".xls") ? name : name + ".xls";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

import type { ReportSection } from "./reportSections";

/** Opens a print-formatted report in a new tab and triggers the browser's
 *  print dialog — choosing "Save as PDF" there produces a real PDF with
 *  zero new dependencies (no jspdf/pdfmake needed). Visual language
 *  matches the reference design: bold title + orange report label at
 *  top, then a stack of orange-header-bar sections (KPI list / table /
 *  bullet list / blank remarks box), dark-navy table headers. */
export function printSectionedReport(
  companyName: string, reportTitle: string, scopeLine: string, periodLine: string, generatedLine: string,
  sections: ReportSection[]
): void {
  const esc = (v: unknown) => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const sectionHtml = (s: ReportSection): string => {
    if (s.type === "kpi") {
      return `
        <div class="section-title">${esc(s.title)}</div>
        <div class="kpi-box">
          ${s.items.map((it) => `<div class="kpi-row"><span>${esc(it.label)}</span><b>${esc(it.value)}</b></div>`).join("")}
        </div>`;
    }
    if (s.type === "table") {
      return `
        <div class="section-title">${esc(s.title)}</div>
        <table>
          <thead><tr>${s.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${s.rows.length
            ? s.rows.map((r) => "<tr>" + r.map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>").join("")
            : `<tr><td colspan="${s.headers.length}" class="empty">No records.</td></tr>`}</tbody>
        </table>`;
    }
    if (s.type === "bullets") {
      return `
        <div class="section-title">${esc(s.title)}</div>
        <div class="bullet-box">
          ${s.items.length ? s.items.map((t) => `<div class="bullet-row">• ${esc(t)}</div>`).join("") : `<div class="bullet-row empty">Nothing to flag.</div>`}
        </div>`;
    }
    // remarks
    return `
      <div class="section-title">${esc(s.title)}</div>
      <div class="remarks-box"></div>`;
  };

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(reportTitle)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #1e293b; margin: 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #ff7a00; padding-bottom: 14px; margin-bottom: 22px; }
  .company { font-size: 21px; font-weight: 800; }
  .company-sub { font-size: 11.5px; color: #64748b; margin-top: 2px; }
  .report-title { font-size: 18px; font-weight: 800; color: #ff7a00; text-align: right; }
  .report-meta { font-size: 11.5px; color: #64748b; text-align: right; margin-top: 4px; line-height: 1.5; }
  .section-title { background: #ff7a00; color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 8px 12px; margin: 20px 0 0; }
  .kpi-box, .bullet-box { border: 1px solid #e5e7eb; border-top: none; }
  .kpi-row { display: flex; justify-content: space-between; padding: 8px 12px; font-size: 12.5px; border-bottom: 1px solid #eef0f3; }
  .kpi-row:last-child { border-bottom: none; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { background: #1e293b; color: #fff; text-align: left; padding: 7px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  td { padding: 6px 10px; border-bottom: 1px solid #eef0f3; }
  td.empty { text-align: center; color: #94a3b8; padding: 14px; }
  tr:nth-child(even) td { background: #fafafa; }
  .bullet-row { padding: 7px 12px; font-size: 12px; border-bottom: 1px solid #eef0f3; }
  .bullet-row:last-child { border-bottom: none; }
  .bullet-row.empty { color: #94a3b8; }
  .remarks-box { border: 1px solid #e5e7eb; border-top: none; height: 70px; }
  @media print {
    body { margin: 12mm; }
    thead { display: table-header-group; }
    .section-title { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company">${esc(companyName)}</div>
      <div class="company-sub">Possession Report</div>
    </div>
    <div>
      <div class="report-title">${esc(reportTitle)}</div>
      <div class="report-meta">
        ${esc(scopeLine)}<br>
        ${esc(periodLine)}<br>
        ${esc(generatedLine)}
      </div>
    </div>
  </div>
  ${sections.map(sectionHtml).join("")}
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) return; // popup blocked — nothing we can do without a library
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Let the new document actually paint before invoking print — calling it
  // synchronously right after write() can race the layout on some browsers.
  setTimeout(() => { w.focus(); w.print(); }, 300);
}

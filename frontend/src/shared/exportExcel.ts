/** Downloads a real, column-correct spreadsheet with zero new dependencies.
 *  Plain CSV (shared/csv.ts's downloadCsv) breaks on many India-locale
 *  Excel installs — those expect ";" as the list separator (comma is the
 *  decimal separator there), so a comma-delimited .csv opens with every
 *  field crammed into column A instead of one column per header. An HTML
 *  <table> saved with a .xls name and the right MIME type opens natively
 *  in Excel as a real grid regardless of locale — no library needed. */
export function downloadExcel(
  name: string, headers: string[], rows: (string | number | null | undefined)[][]
): void {
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html =
    "<table>" +
    "<thead><tr>" + headers.map((h) => `<th>${esc(h)}</th>`).join("") + "</tr></thead>" +
    "<tbody>" +
    rows.map((r) => "<tr>" + r.map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>").join("") +
    "</tbody></table>";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  a.download = name.endsWith(".xls") ? name : name + ".xls";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

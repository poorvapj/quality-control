/* =============================================================== CSV export
   Generic CSV download helper. Extracted verbatim from app.js.
   =========================================================================== */

import { toast } from "../state/appState.js";

export function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => {
    const v = c == null ? "" : String(c);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Downloaded " + name);
}

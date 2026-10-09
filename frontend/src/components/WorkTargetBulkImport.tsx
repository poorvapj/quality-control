import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { WORK_CATEGORIES } from "../services/config";
import Modal from "./Modal";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { Op, Project, WorkTarget } from "../types";

interface ParsedRow {
  line: number;
  projectRaw: string;
  categoryRaw: string;
  unit: string;
  plannedQty: string;
  projectId: string | null;
  category: string | null;
  error: string | null;
}

const CATEGORY_BY_NAME = new Map(WORK_CATEGORIES.map((c) => [c.toLowerCase(), c]));

function splitRow(line: string): string[] {
  const delim = line.includes("\t") ? "\t" : ",";
  return line.split(delim).map((c) => c.trim());
}

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return joined.includes("project") && (joined.includes("categ") || joined.includes("qty") || joined.includes("quantity"));
}

export default function WorkTargetBulkImport({ onClose }: { onClose: () => void }) {
  const { data, apply, toast, currentUserId } = useApp();
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);

  const projects = coll(data, "projects") as Project[];

  const parsed = useMemo((): ParsedRow[] => {
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: ParsedRow[] = [];
    lines.forEach((line, i) => {
      const cells = splitRow(line);
      if (i === 0 && looksLikeHeader(cells)) return;
      const [projectRaw = "", categoryRaw = "", unit = "", plannedQty = ""] = cells;
      if (!projectRaw && !categoryRaw && !plannedQty) return;

      const project = projectById.get(projectRaw) || projectByName.get(projectRaw.toLowerCase());
      const category = CATEGORY_BY_NAME.get(categoryRaw.toLowerCase());
      const qtyNum = Number(plannedQty);

      let error: string | null = null;
      if (!projectRaw) error = "Missing project";
      else if (!project) error = `Unknown project "${projectRaw}"`;
      else if (!categoryRaw) error = "Missing category";
      else if (!category) error = `Unknown category "${categoryRaw}" — must be one of: ${WORK_CATEGORIES.join(", ")}`;
      else if (!unit) error = "Missing unit";
      else if (!Number.isFinite(qtyNum) || qtyNum <= 0) error = "Planned quantity must be a positive number";

      out.push({
        line: i + 1,
        projectRaw, categoryRaw, unit, plannedQty,
        projectId: project?.id || null,
        category: category || null,
        error
      });
    });
    return out;
  }, [raw, projects]);

  const { validRows, errorRows } = useMemo(() => {
    const valid: ParsedRow[] = [], errors: ParsedRow[] = [];
    for (const r of parsed) (r.error ? errors : valid).push(r);
    return { validRows: valid, errorRows: errors };
  }, [parsed]);

  async function importRows() {
    if (validRows.length === 0) { toast("Nothing valid to import"); return; }
    setSaving(true);
    const existing = coll(data, "workTargets") as WorkTarget[];
    const existingByKey = new Map(existing.filter((t) => t.active !== false).map((t) => [`${t.projectId}::${t.category}`, t]));
    const ops: Op[] = [];
    let created = 0, updated = 0;

    // Last row wins if the pasted table has two rows for the same
    // project+category — same as re-pasting an updated sheet should behave.
    const byKey = new Map<string, ParsedRow>();
    for (const r of validRows) byKey.set(`${r.projectId}::${r.category}`, r);

    // nextId() scans `existing` for the current max each call — calling it
    // once per new row inside the loop would hand out the same id to every
    // one of them, since `existing` never grows. Compute the running id
    // ourselves instead, seeded from the one real scan.
    let nextNewId = nextId("WTG", existing);
    function takeNextId(): string {
      const id = nextNewId;
      const n = parseInt(id.split("-")[1], 10);
      nextNewId = "WTG-" + String(n + 1).padStart(4, "0");
      return id;
    }

    for (const r of byKey.values()) {
      const match = existingByKey.get(`${r.projectId}::${r.category}`);
      const rec: WorkTarget = {
        id: match ? match.id : takeNextId(),
        projectId: r.projectId!,
        category: r.category!,
        unit: r.unit,
        plannedQty: Number(r.plannedQty),
        active: true
      };
      ops.push({ op: "upsert", coll: "workTargets", rec });
      if (match) updated++; else created++;
    }
    ops.push(buildEventOp(currentUserId, "MASTER_SAVE", "", "", `Work Target · bulk import · ${created} created, ${updated} updated`));

    await apply(ops);
    setSaving(false);
    toast(`Imported ${created + updated} Work Target${created + updated === 1 ? "" : "s"} (${created} new, ${updated} updated)`);
    onClose();
  }

  return (
    <Modal
      open
      wide
      sub="MASTERS ▸ WORK TARGET"
      title="Bulk Import Work Targets"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || validRows.length === 0} onClick={importRows}>
            {saving ? "Importing…" : `Import ${validRows.length} row${validRows.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label>Paste rows</label>
        <div className="hint">
          One row per line — tab-separated (paste straight from Excel/Sheets) or comma-separated. Columns, in order:
          <b> Project, Category, Unit, Planned Qty</b>. Project can be a name (e.g. "Zen Garden") or a project id (e.g. "PRJ-013").
          Category must match one of: {WORK_CATEGORIES.join(", ")}. A header row is auto-detected and skipped.
        </div>
        <textarea
          className="textarea"
          style={{ minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
          placeholder={"Zen Garden\tRCC\tsq.ft\t5000\nZen Garden\tElectrical\tpoints\t120\nNature park Hotel\tRCC\tsq.ft\t3000"}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>

      {parsed.length > 0 && (
        <div className="card card-pad">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {validRows.length} valid · {errorRows.length} with errors
          </div>
          <Table columns={["Line", "Project", "Category", "Unit", "Planned Qty", "Status"]} maxHeight="280px">
            {parsed.map((r) => (
              <TableRow key={r.line}>
                <TableCell>{r.line}</TableCell>
                <TableCell>{r.projectRaw}</TableCell>
                <TableCell>{r.categoryRaw}</TableCell>
                <TableCell>{r.unit}</TableCell>
                <TableCell>{r.plannedQty}</TableCell>
                <TableCell>
                  {r.error
                    ? <span className="badge-tag fail">{r.error}</span>
                    : <span className="badge-tag pass">OK</span>}
                </TableCell>
              </TableRow>
            ))}
          </Table>
        </div>
      )}
    </Modal>
  );
}

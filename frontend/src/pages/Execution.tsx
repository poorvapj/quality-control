import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, projectFloors, floorUnits, byId } from "../shared/rules";
import { makeTempId, displayId, fmtDate } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import PhotoGroupUploader from "../components/PhotoGroupUploader";
import SidePanel from "../components/SidePanel";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import { WORK_TYPES, QC_CHECKLISTS, CHECKLIST_STATUSES, isFlatWise } from "./QualityInspection";
import type { ExecutionRecord, Photo, Op } from "../types";

const todayStr = () => new Date().toISOString().slice(0, 10);

/* The Execution team's own version of Quality Inspection — same Project/
   Floor/Flat + Work Type + checklist shape (reuses QualityInspection.tsx's
   WORK_TYPES/QC_CHECKLISTS so both pages always offer the same checklists),
   but this is the crew certifying work is DONE and ready, not a quality
   verdict on it — no Pass/Fail/Rework result, no approval workflow, no
   Snag auto-raise. The actual Quality Inspection still decides pass/fail. */
export default function Execution() {
  const { data, currentUserId } = useApp();
  const [panelOpen, setPanelOpen] = useState(false);
  const [fProjectId, setFProjectId] = useState("");

  const allProjects = myProjects(data, currentUserId);
  const records = coll(data, "executionRecords") as ExecutionRecord[];
  const filtered = useMemo(
    () => records.filter((r) => !fProjectId || r.projectId === fProjectId).sort((a, b) => b.createdAt - a.createdAt),
    [records, fProjectId]
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-icon"><NavIcon name="execution" size={18} /></div>
        <div>
          <div className="page-title">Execution</div>
          <div className="page-desc">The execution team's own record of work done — Floor/Flat, Work Type, checklist, photos. Quality Inspection still decides Pass/Fail separately.</div>
        </div>
        <div className="page-header-actions">
          <Btn label="+ New Execution Record" onClick={() => setPanelOpen(true)} />
        </div>
      </div>

      <Card className="!p-3 !mb-4">
        <div style={{ maxWidth: 280 }}>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown
            value={fProjectId} onChange={setFProjectId}
            options={[{ value: "", label: "All Projects" }, ...allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          />
        </div>
      </Card>

      <Card className="!p-0">
        <Table columns={["Date", "Project", "Floor", "Flat", "Work Type", "Recorded By", "Photos", ""]}>
          {filtered.length === 0 && (
            <TableRow><TableCell colSpan={8}><div className="py-6 text-center text-[13px] text-[var(--text-muted)]">No execution records yet.</div></TableCell></TableRow>
          )}
          {filtered.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{fmtDate(r.createdAt)}</TableCell>
              <TableCell>{r.projectName}</TableCell>
              <TableCell>{r.floorName}</TableCell>
              <TableCell>{r.unitName || "—"}</TableCell>
              <TableCell>{r.workType}</TableCell>
              <TableCell>{r.recordedByName}</TableCell>
              <TableCell>{r.photos?.length || 0}</TableCell>
              <TableCell>{displayId(r.id)}</TableCell>
            </TableRow>
          ))}
        </Table>
      </Card>

      <ExecutionForm open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}

function ExecutionForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, apply, toast, currentUserId, me } = useApp();
  const allProjects = myProjects(data, currentUserId);
  const [projectId, setProjectId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [workType, setWorkType] = useState("");
  const [checklist, setChecklist] = useState<{ text: string; status: "" | "OK" | "Not OK" | "N/A"; remarks: string }[]>([]);
  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);

  const project = byId(allProjects, projectId);
  const floors = projectFloors(data, projectId || null);
  const flatWise = isFlatWise(workType);
  const units = floorId ? floorUnits(data, projectId, floorId) : [];

  function reset() {
    setProjectId(""); setFloorId(""); setUnitId(""); setWorkType("");
    setChecklist([]); setRemarks(""); setPhotos([]);
  }
  function guardedClose() {
    const dirty = !!(projectId || floorId || workType || remarks.trim() || photos.length);
    if (dirty && !window.confirm("Discard this execution record? What you've entered so far will be lost.")) return;
    reset();
    onClose();
  }

  function pickWorkType(wt: string) {
    setWorkType(wt);
    setUnitId("");
    setChecklist((QC_CHECKLISTS[wt] || []).map((text) => ({ text, status: "", remarks: "" })));
  }

  async function save() {
    if (!projectId || !floorId) { toast("Project and Floor are required"); return; }
    if (!workType) { toast("Select a Work Type first"); return; }
    if (flatWise && !unitId) { toast("Pick the flat"); return; }
    if (checklist.some((row) => !row.status)) { toast("Mark every checklist point as OK / Not OK / N/A"); return; }
    if (photos.length === 0) { toast("Add at least one photo as evidence"); return; }

    setSaving(true);
    const floor = byId(floors, floorId);
    const unit = flatWise ? byId(units, unitId) : null;
    const u = me();
    const id = makeTempId("EX");
    const rec: ExecutionRecord = {
      id,
      projectId, projectCode: project?.code || "", projectName: project?.name || "",
      floorId, floorName: floor?.name || "",
      ...(unit ? { unitId: unit.id, unitCode: unit.code, unitName: unit.name } : {}),
      workType,
      checklistItems: checklist.map((row) => ({ text: row.text, status: row.status as "OK" | "Not OK" | "N/A", remarks: row.remarks.trim() || undefined })),
      recordDate: todayStr(),
      remarks: remarks.trim() || undefined,
      photos,
      recordedByUserId: currentUserId || "",
      recordedByName: u?.name || "",
      createdAt: Date.now()
    };
    const ops: Op[] = [
      { op: "upsert", coll: "executionRecords", create: true, rec } as any,
      buildEventOp(currentUserId, "EXECUTION_RECORD", id, "", `Execution · ${workType} · ${rec.floorName}${rec.unitName ? " / " + rec.unitName : ""}`)
    ];
    const synced = await apply(ops);
    setSaving(false);
    toast(synced ? "Execution record saved" : "Saved on this device — will finish submitting once you're back online");
    reset();
    onClose();
  }

  return (
    <SidePanel
      open={open}
      wide
      icon={<NavIcon name="execution" size={18} />}
      title="New Execution Record"
      desc="Record work done against a real Floor/Flat — the execution team's own checklist, not a Pass/Fail verdict."
      onClose={guardedClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={guardedClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>Project *</label>
          <SearchDropdown
            value={projectId}
            onChange={(v) => { setProjectId(v); setFloorId(""); setUnitId(""); }}
            options={[{ value: "", label: "Select project…" }, ...allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          />
        </div>
        <div className="field">
          <label>Floor *</label>
          <SearchDropdown
            value={floorId}
            onChange={(v) => { setFloorId(v); setUnitId(""); }}
            options={[{ value: "", label: "Select floor…" }, ...floors.map((f) => ({ value: f.id, label: f.name }))]}
          />
        </div>
        <div className="field full">
          <label>Work Type *</label>
          <SearchDropdown
            value={workType}
            onChange={pickWorkType}
            options={[{ value: "", label: "Select checklist (Work Type)…" }, ...WORK_TYPES.map((w) => ({ value: w, label: w }))]}
          />
        </div>
        {flatWise && (
          <div className="field full">
            <label>Flat *</label>
            <SearchDropdown
              value={unitId} onChange={setUnitId}
              options={[{ value: "", label: "Select flat…" }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
            />
          </div>
        )}

        {checklist.length > 0 && (
          <div className="field full">
            <div className="overflow-x-auto border border-[var(--border)] rounded-radius-md">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-subtle)]">
                    <th className="p-2 w-8">#</th>
                    <th className="p-2">Check Point</th>
                    <th className="p-2 w-[220px]">Status *</th>
                    <th className="p-2 w-[180px]">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {checklist.map((row, idx) => (
                    <tr key={idx} className="border-t border-[var(--border)] align-top">
                      <td className="p-2 text-[var(--text-muted)]">{idx + 1}</td>
                      <td className="p-2">{row.text}</td>
                      <td className="p-2">
                        <div className="flex gap-2.5 flex-wrap">
                          {CHECKLIST_STATUSES.map((st) => (
                            <label key={st} className="flex items-center gap-1 text-[11.5px] cursor-pointer whitespace-nowrap">
                              <input
                                type="radio" name={`ex-status-${idx}`} checked={row.status === st}
                                onChange={() => setChecklist((prev) => prev.map((r, i) => (i === idx ? { ...r, status: st } : r)))}
                              />
                              {st}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="p-2">
                        <input
                          className="input" style={{ fontSize: 11.5 }} placeholder="optional"
                          value={row.remarks}
                          onChange={(e) => setChecklist((prev) => prev.map((r, i) => (i === idx ? { ...r, remarks: e.target.value } : r)))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {workType && (
          <div className="field full">
            <PhotoGroupUploader label="Evidence Photos *" photos={photos} onChange={setPhotos} />
          </div>
        )}

        <div className="field full">
          <label>Remarks</label>
          <textarea className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional notes" />
        </div>
      </div>
    </SidePanel>
  );
}

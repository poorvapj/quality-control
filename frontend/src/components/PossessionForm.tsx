import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { byId, coll, pkey, prog, projectFloors, floorUnits, trackStages, refLabel } from "../shared/rules";
import { useActions } from "../hooks/useActions";
import { uploadPhoto } from "../shared/uploadPhoto";
import NavIcon from "./NavIcon";
import SearchDropdown from "./SearchDropdown";
import SidePanel from "./SidePanel";
import "./SharpPanel.css";
import type { ChecklistItem, Photo, QParam } from "../types";

export interface PossessionActiveForm {
  unitId: string; unitName: string; floorName: string; projectName: string;
  stageId: string; stageName: string; stageDesc: string; checklistId: string;
}

type CellResult = "pass" | "fail" | "na";
interface RowState { paramId: string; cells: Partial<Record<string, CellResult>>; remark: string; photo?: Photo }

const draftKey = (unitId: string, stageId: string) => `handoverDraft:${unitId}:${stageId}`;

/* Matches the printed possession-checklist sheet's room columns (A–M) —
   each checklist item gets assessed per room, not once for the whole
   unit, since a room can individually pass/fail (e.g. Doors OK in the
   Living Room but cracked in Bedroom 2). Fixed list rather than derived
   from unit.type — an "if applicable" column is simply left blank for a
   unit that doesn't have it (e.g. a 1BHK's Bedroom 2/3 columns), same as
   the paper form itself. */
const ROOMS = [
  "Living Room", "Dining Area", "Kitchen",
  "Bedroom 1", "Toilet 1", "Bedroom 2", "Toilet 2", "Bedroom 3", "Toilet 3",
  "Balcony 1", "Balcony 2", "Balcony 3", "Terrace"
];
const ROOM_SHORT: Record<string, string> = {
  "Living Room": "Living", "Dining Area": "Dining", "Kitchen": "Kitchen",
  "Bedroom 1": "Bed 1", "Toilet 1": "Toil 1", "Bedroom 2": "Bed 2", "Toilet 2": "Toil 2",
  "Bedroom 3": "Bed 3", "Toilet 3": "Toil 3",
  "Balcony 1": "Bal 1", "Balcony 2": "Bal 2", "Balcony 3": "Bal 3", "Terrace": "Terrace"
};

function nextCellResult(cur: CellResult | undefined, allowNA: boolean): CellResult | undefined {
  if (cur === undefined) return "pass";
  if (cur === "pass") return "fail";
  if (cur === "fail") return allowNA ? "na" : undefined;
  return undefined;
}

/* One item's overall result, rolled up from whichever room cells were
   actually filled in — Fail anywhere wins (a single bad room still blocks
   the item), N/A only when every filled cell was N/A, otherwise Pass
   (including when nothing was filled — matches the old single-value
   form's "defaults to pass until touched" behavior). */
function aggregateResult(row: RowState): CellResult {
  const vals = Object.values(row.cells).filter((v): v is CellResult => !!v);
  if (vals.includes("fail")) return "fail";
  if (vals.length > 0 && vals.every((v) => v === "na")) return "na";
  return "pass";
}

/* Fill-out form for one possession checklist (Internal or Owner) — opens
   as a right-side SidePanel drawer, the same visual language as
   AssignModal.tsx's "Assign Work" form (icon+title+desc header, bordered
   card sections, sticky footer with Cancel/Save/Submit, sharp-panel
   corners). Submission still goes through the existing
   useActions().submitChecklist — same pass/fail/snag logic as
   ChecklistModal, just presented as a full drawer instead of a popup.

   Shared by HandoverChecklist.tsx's unit table and Drawer.tsx's Unit 360°
   "Possession" tab — one implementation, not a second copy. */
type StageKey = "internal" | "owner";

export default function PossessionForm({ form, onDone }: { form: PossessionActiveForm | null; onDone: () => void }) {
  const { data, toast, apply } = useApp();
  const { submitChecklist } = useActions();
  const [rows, setRows] = useState<RowState[]>([]);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingPhotoRow = useRef<number | null>(null);

  // The form always opens FOR a specific unit+stage (whichever row's "Fill
  // Form" button was clicked), but Project/Floor/Unit/Stage are still
  // editable dropdowns from there — same cascading-select pattern as
  // SnagModal.tsx's Raise Snag form — in case the wrong unit/stage was
  // opened, or the user wants to jump straight to a different one without
  // closing and reopening from the table/drawer.
  const [selProjectId, setSelProjectId] = useState("");
  const [selFloorId, setSelFloorId] = useState("");
  const [selUnitId, setSelUnitId] = useState("");
  const [selStageKey, setSelStageKey] = useState<StageKey>("internal");
  const [unitSearchQ, setUnitSearchQ] = useState("");

  // Project/Floor/Unit start blank ("All Projects"/"Choose") every time the
  // form opens, rather than pre-filled from whichever row's "Fill Form"
  // button was clicked — an explicit pick each time, same reasoning as
  // SnagModal/AssignModal already starting unset. Stage still follows
  // whichever button opened the form (Internal vs Owner) since it isn't a
  // dropdown at all.
  useEffect(() => {
    if (!form) return;
    setSelProjectId("");
    setSelFloorId("");
    setSelUnitId("");
    setUnitSearchQ("");
    setSelStageKey(form.stageId === "STG-HOO" ? "owner" : "internal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.unitId, form?.stageId]);

  const projects = coll(data, "projects").filter((p) => p.active !== false);
  const floors = projectFloors(data, selProjectId);
  const units = floorUnits(data, selProjectId, selFloorId);
  const unitStages = trackStages(data, selProjectId, "unit");
  const effStageId = selStageKey === "internal" ? "STG-HOI" : "STG-HOO";
  const stageJoined = unitStages.find((x) => x.stage.id === effStageId);
  const mapped = !!stageJoined;
  const effChecklistId = stageJoined?.map.checklistId || "";
  const effUnit = byId(coll(data, "units"), selUnitId);
  const effUnitName = effUnit?.name || "";
  const effFloorName = refLabel(data, "floors", selFloorId);
  const effProjectName = refLabel(data, "projects", selProjectId);
  const effStageName = stageJoined?.stage.name || (selStageKey === "internal" ? "Internal Handover Checklist" : "Owner Handover Sign-off");
  const effStageDesc = selStageKey === "internal"
    ? "Civil / QC internal inspection before owner possession."
    : "Final owner possession and handover inspection.";

  // Quick search across EVERY unit (not just the currently-cascaded
  // project/floor) — picking a result jumps straight there in one tap,
  // instead of having to know which Project/Floor a unit sits under first.
  const unitSearchMatches = (() => {
    const ql = unitSearchQ.trim().toLowerCase();
    if (!ql) return [];
    return coll(data, "units")
      .filter((u) => u.active !== false && (u.name + " " + u.code).toLowerCase().includes(ql))
      .slice(0, 8);
  })();

  function jumpToUnit(u: { id: string; projectId: string; floorId: string }) {
    setSelProjectId(u.projectId);
    setSelFloorId(u.floorId);
    setSelUnitId(u.id);
    setUnitSearchQ("");
  }

  // Whether/when this unit+stage was last filled — so reopening a possession
  // form makes it obvious at a glance if you're about to overwrite real,
  // already-submitted data or starting from a genuinely blank one.
  const lastSubmitted = mapped && selUnitId ? prog(data, selUnitId, effStageId) : null;

  const chk = mapped ? byId(coll(data, "checklists"), effChecklistId) : null;
  const items: ChecklistItem[] = chk?.items || [];

  // A draft is just this in-progress form state, kept client-side
  // (localStorage) rather than written to `progress` — submitChecklist()
  // is the only thing that actually finalizes a pass/fail (and can raise a
  // snag), so a draft must never call it. Restores automatically if the
  // same unit+stage form is reopened before submitting.
  //
  // If there's no local draft, this ALSO falls back to whatever was last
  // actually submitted (progress.checklist, already persisted server-side)
  // — reopening a done/failed unit's form via "View / Refill"/"Rework"
  // used to always start from a blank sheet even though the previous
  // answers already exist, forcing a full refill from scratch every time.
  useEffect(() => {
    if (!form || !selUnitId || !mapped) return;
    let restored: { rows: RowState[]; remarks?: string } | null = null;
    try {
      const raw = localStorage.getItem(draftKey(selUnitId, effStageId));
      if (raw) restored = JSON.parse(raw);
    } catch { /* corrupt/blocked storage — fall back to a fresh form */ }

    if (restored && restored.rows.length === items.length) {
      setRows(restored.rows);
      setRemarks(restored.remarks || "");
      return;
    }

    const p = prog(data, selUnitId, effStageId);
    if (p.checklist && p.checklist.length === items.length) {
      setRows(
        p.checklist.map((c) => ({
          paramId: c.paramId,
          remark: c.remark || "",
          photo: c.photo,
          cells: Object.fromEntries((c.cells || []).map((cell) => [cell.room, cell.result]))
        }))
      );
      setRemarks(p.remarks || "");
      return;
    }

    setRows(items.map((it) => ({ paramId: it.paramId, cells: {}, remark: "" })));
    setRemarks("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, selUnitId, effStageId, effChecklistId]);

  const setRow = (i: number, patch: Partial<RowState>) => {
    setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  };
  function cycleCell(i: number, room: string, allowNA: boolean) {
    setRows((rs) => rs.map((r, ri) => {
      if (ri !== i) return r;
      const next = nextCellResult(r.cells[room], allowNA);
      const cells = { ...r.cells };
      if (next === undefined) delete cells[room]; else cells[room] = next;
      return { ...r, cells };
    }));
  }
  // Quick "mark the whole item" action, alongside the per-room grid — sets
  // every room to the same result in one tap, for the common case where an
  // item is uniformly fine (or uniformly bad) across the unit. Individual
  // rooms can still be corrected afterward by tapping that cell.
  function setAllCells(i: number, result: CellResult) {
    setRows((rs) => rs.map((r, ri) => (ri !== i ? r : { ...r, cells: Object.fromEntries(ROOMS.map((room) => [room, result])) })));
  }
  const answeredCount = rows.filter((r) => Object.values(r.cells).some(Boolean)).length;
  const pct = items.length ? Math.round((answeredCount / items.length) * 100) : 0;

  function saveDraft() {
    if (!form || !selUnitId) return;
    setSavingDraft(true);
    try {
      localStorage.setItem(draftKey(selUnitId, effStageId), JSON.stringify({ rows, remarks }));
      toast("Draft saved");
    } catch {
      toast("Couldn't save draft — browser storage unavailable");
    }
    setSavingDraft(false);
  }

  const groups: { category: string; entries: { item: ChecklistItem; param: QParam; i: number }[] }[] = [];
  items.forEach((it, i) => {
    const param = byId(coll(data, "qparams"), it.paramId) as QParam | null;
    if (!param) return;
    const cat = param.category || "General";
    let g = groups.find((x) => x.category === cat);
    if (!g) { g = { category: cat, entries: [] }; groups.push(g); }
    g.entries.push({ item: it, param, i });
  });

  function requestPhoto(i: number) {
    pendingPhotoRow.current = i;
    fileRef.current?.click();
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const i = pendingPhotoRow.current;
    e.target.value = "";
    if (!file || i == null) return;
    setUploadingIdx(i);
    const photo = await uploadPhoto(file, "qc", effUnitName);
    setRow(i, { photo });
    setUploadingIdx(null);
  }

  // Items flagged `evidence: true` in Masters ▸ Quality Checklist need a
  // photo attached before this can be submitted — previously that flag was
  // set-and-forget (RecordModal.tsx wrote it, nothing ever read it back).
  const missingEvidence = items
    .map((it, i) => ({ it, row: rows[i] }))
    .find(({ it, row }) => it.evidence && row && aggregateResult(row) !== "na" && !row.photo);

  async function submit() {
    if (!form) return;
    if (!selProjectId || !selFloorId || !selUnitId || !mapped) {
      toast("Project, Floor, Unit, and Stage must all be picked before this can be submitted");
      return;
    }
    if (missingEvidence) {
      const param = byId(coll(data, "qparams"), missingEvidence.it.paramId) as QParam | null;
      toast(`"${param?.name || "This item"}" needs a photo before you can submit`);
      return;
    }
    setSubmitting(true);
    // Roll each item's per-room cells into the single pass/fail/na value
    // submitChecklist()/the rest of the app expects — the full room-level
    // breakdown still rides along as `cells` on the same object (stored
    // verbatim on the progress record) so it isn't lost, just not the
    // value that drives snag-raising/gate pass-fail.
    const results = rows.map((r) => {
      const agg = aggregateResult(r);
      const failedRooms = Object.entries(r.cells).filter(([, v]) => v === "fail").map(([room]) => room);
      const remark = agg === "fail" && failedRooms.length
        ? [r.remark.trim(), `Failed in: ${failedRooms.join(", ")}`].filter(Boolean).join(" — ")
        : r.remark.trim();
      return {
        paramId: r.paramId, result: agg, remark,
        photo: r.photo,
        cells: Object.entries(r.cells).filter(([, v]) => v).map(([room, result]) => ({ room, result }))
      };
    });
    await submitChecklist("unit", selUnitId, effStageId, effChecklistId, results);
    // Additive only — a free-text note alongside the pass/fail results,
    // stored on the same progress record. submitChecklist()'s own `note`
    // field is reserved for the auto-generated fail summary, so this is a
    // separate key rather than overwriting it.
    if (remarks.trim()) {
      await apply([{ op: "progress", key: pkey(selUnitId, effStageId), patch: { remarks: remarks.trim() } }]);
    }
    try { localStorage.removeItem(draftKey(selUnitId, effStageId)); } catch { /* ignore */ }
    setSubmitting(false);
    onDone();
  }

  return (
    <SidePanel
      open={!!form}
      wide
      icon={<NavIcon name="handover" size={17} />}
      title={effStageName.replace("QC GATE", "").trim()}
      desc={effStageDesc}
      onClose={onDone}
      panelClassName="sharp-panel"
      footer={
        form && (
          <>
            <button className="btn btn-secondary" onClick={onDone} disabled={submitting || savingDraft}>Cancel</button>
            <button className="btn btn-secondary" onClick={saveDraft} disabled={submitting || !mapped}>{savingDraft ? "Saving…" : "Save Draft"}</button>
            <button className="btn btn-primary" onClick={submit} disabled={savingDraft || !mapped}>
              {submitting ? "Submitting…" : "Submit " + (selStageKey === "internal" ? "Internal Possession" : "Owner Possession")}
            </button>
          </>
        )
      }
    >
      {!form ? null : (
        <>
          <div className="micro-label" style={{ marginBottom: 8 }}>UNIT INFORMATION</div>
          {/* overflow: visible override — .card's overflow:hidden (for its
              rounded corners) was clipping the Project/Floor/Unit
              SearchDropdowns' floating option panels at this card's own
              bottom edge instead of letting them render on top of the
              content below. */}
          <div className="card card-pad" style={{ marginBottom: 18, overflow: "visible" }}>
            {/* Jumps straight to a unit across every project/floor in one
                tap — the cascading Project→Floor→Unit pickers below only
                help once you already know which project a unit is under. */}
            <div className="field" style={{ marginBottom: 14, position: "relative" }}>
              <label>Search Unit</label>
              <input
                className="input"
                placeholder="Type a unit name or code…"
                value={unitSearchQ}
                onChange={(e) => setUnitSearchQ(e.target.value)}
              />
              {unitSearchMatches.length > 0 && (
                <div
                  style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 80,
                    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
                    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.14)", maxHeight: 220, overflowY: "auto", padding: 4
                  }}
                >
                  {unitSearchMatches.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => jumpToUnit(u)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                        border: "none", background: "none", borderRadius: 7, cursor: "pointer", fontSize: 13
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <div style={{ fontWeight: 700 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {refLabel(data, "projects", u.projectId)} · {refLabel(data, "floors", u.floorId)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Project</label>
                <SearchDropdown
                  value={selProjectId}
                  onChange={(v) => { setSelProjectId(v); setSelFloorId(""); setSelUnitId(""); }}
                  options={[{ value: "", label: "All Projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                  neutralActive
                />
              </div>
              <div className="field">
                <label>Floor</label>
                <SearchDropdown
                  value={selFloorId}
                  onChange={(v) => { setSelFloorId(v); setSelUnitId(""); }}
                  options={[{ value: "", label: "Choose" }, ...floors.map((f) => ({ value: f.id, label: f.name }))]}
                  disabled={!selProjectId}
                  neutralActive
                />
              </div>
              <div className="field">
                <label>Unit</label>
                <SearchDropdown
                  value={selUnitId}
                  onChange={setSelUnitId}
                  options={[{ value: "", label: "Choose" }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
                  disabled={!selFloorId}
                  neutralActive
                />
              </div>
              <div className="field"><label>Stage</label><div style={{ fontSize: 13, fontWeight: 700 }}>{effStageName}</div></div>
              <div className="field"><label>Status</label><div style={{ fontSize: 13, fontWeight: 700 }}>{!mapped ? "—" : answeredCount === 0 ? "Pending" : answeredCount < items.length ? "In Progress" : "Completed"}</div></div>
              {lastSubmitted?.at && (
                <div className="field full">
                  <label>Last Submitted</label>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    {new Date(lastSubmitted.at).toLocaleString()}{lastSubmitted.by ? " · by " + refLabel(data, "users", lastSubmitted.by) : ""}
                  </div>
                </div>
              )}
            </div>
          </div>

          {!mapped ? (
            <div className="card card-pad" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {selProjectId && selFloorId && selUnitId
                ? "Internal/Owner Possession isn't mapped for this project yet — add it via Masters ▸ Stage Mapping."
                : "Pick a Project, Floor, and Unit above to continue."}
            </div>
          ) : (
          <>
          <div className="micro-label" style={{ marginBottom: 8 }}>POSSESSION CHECKLIST</div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              <span>Progress</span>
              <span>{answeredCount} / {items.length}</span>
            </div>
            <div className="workload-bar">
              <div className="workload-fill" style={{ width: pct + "%" }} />
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.category} style={{ marginBottom: 18 }}>
              <div className="micro-label" style={{ marginBottom: 8 }}>{g.category}</div>
              <div className="card card-pad">
                {g.entries.map(({ item, param, i }, gi) => {
                  const row = rows[i];
                  if (!row) return null;
                  const agg = aggregateResult(row);
                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: "10px 0",
                        borderBottom: gi < g.entries.length - 1 ? "1px solid var(--border)" : "none"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 160 }}>{param.name}</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className={"btn btn-sm " + (agg === "pass" ? "btn-primary" : "btn-secondary")} onClick={() => setAllCells(i, "pass")}>Pass</button>
                          <button type="button" className={"btn btn-sm " + (agg === "fail" ? "btn-danger" : "btn-secondary")} onClick={() => setAllCells(i, "fail")}>Fail</button>
                          {item.mandatory === false && (
                            <button type="button" className={"btn btn-sm " + (agg === "na" ? "btn-primary" : "btn-secondary")} onClick={() => setAllCells(i, "na")}>N/A</button>
                          )}
                        </div>
                      </div>

                      {/* One cell per room — tap cycles blank → Pass → Fail →
                          N/A → blank. Matches the printed form's per-room
                          grid; a room that doesn't apply to this unit is
                          simply left blank, same as on paper. */}
                      <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 4 }}>
                        {ROOMS.map((room) => {
                          const v = row.cells[room];
                          const bg = v === "pass" ? "var(--color-pass, #22c55e)" : v === "fail" ? "var(--color-fail, #ef4444)" : v === "na" ? "var(--bg-subtle)" : "transparent";
                          const fg = v ? "#fff" : "var(--text-muted)";
                          return (
                            <button
                              key={room}
                              type="button"
                              onClick={() => cycleCell(i, room, item.mandatory === false)}
                              title={room}
                              style={{
                                flex: "0 0 auto", width: 46, height: 32, borderRadius: 6,
                                border: v ? "none" : "1px dashed var(--border)",
                                background: bg, color: fg,
                                fontSize: 9.5, fontWeight: 700, lineHeight: 1.15,
                                cursor: "pointer", padding: "2px 3px"
                              }}
                            >
                              {v === "pass" ? "✓" : v === "fail" ? "✕" : v === "na" ? "N/A" : ROOM_SHORT[room]}
                            </button>
                          );
                        })}
                      </div>

                      {item.evidence && agg !== "na" && (
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className={"btn btn-sm " + (row.photo ? "btn-secondary" : "btn-danger")}
                            onClick={() => requestPhoto(i)}
                            disabled={uploadingIdx === i}
                          >
                            {uploadingIdx === i ? "Uploading…" : row.photo ? "📷 Retake photo" : "📸 Photo required"}
                          </button>
                          {row.photo && <img src={row.photo.url} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
                        </div>
                      )}
                      {agg === "fail" && (
                        <div style={{ marginTop: 8 }}>
                          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Remarks</label>
                          <input
                            className="input"
                            style={{ marginTop: 4 }}
                            placeholder="What's wrong, and what needs to happen before this passes"
                            value={row.remark}
                            onChange={(e) => setRow(i, { remark: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 18 }}>
            <div className="micro-label" style={{ marginBottom: 8 }}>REMARKS</div>
            <div className="card card-pad">
              <textarea
                className="textarea"
                rows={3}
                placeholder="Any additional notes for this possession checklist…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            Any item marked Fail automatically raises a snag for rework.
          </div>
          </>
          )}
          <input
            type="file" accept="image/*" capture="environment" ref={fileRef} style={{ display: "none" }}
            onChange={onPhotoPicked}
          />
        </>
      )}
    </SidePanel>
  );
}

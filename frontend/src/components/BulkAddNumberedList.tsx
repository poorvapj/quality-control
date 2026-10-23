import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import Modal from "./Modal";
import SearchDropdown from "./SearchDropdown";

/** Column Master / Slab Master can need 80-90 entries for a real tower —
 *  one "New Column"/"New Slab" record at a time isn't workable. This
 *  generates a numbered run ("Column 1".."Column 90") for one project in
 *  a single save, continuing after whatever that project's highest
 *  existing display-order number already is. */
export default function BulkAddNumberedList({
  master, idPrefix, namePrefix, onClose
}: {
  master: "columnMaster" | "slabMaster";
  idPrefix: string;
  namePrefix: string;
  onClose: () => void;
}) {
  const { data, currentUserId, currentProjectId, apply, toast } = useApp();
  const allProjects = myProjects(data, currentUserId);
  const [projectId, setProjectId] = useState(currentProjectId || "");
  const [prefix, setPrefix] = useState(namePrefix);
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("10");
  const [saving, setSaving] = useState(false);

  const existing = coll(data, master) as any[];
  const existingForProject = existing.filter((r) => r.projectId === projectId);
  const maxSeq = existingForProject.reduce((m, r) => Math.max(m, r.seq || 0), 0);

  async function create() {
    if (saving) return;
    const fromN = parseInt(from, 10), toN = parseInt(to, 10);
    if (!projectId) { toast("Pick a project first"); return; }
    if (!prefix.trim()) { toast("Name prefix is required"); return; }
    if (!Number.isFinite(fromN) || !Number.isFinite(toN) || fromN < 1 || toN < fromN) { toast("Enter a valid From/To range"); return; }
    if (toN - fromN + 1 > 500) { toast("That's a lot in one go — split it into smaller batches"); return; }
    // A typo'd range (e.g. redoing "5-15" after already adding "1-10") would
    // otherwise silently create duplicate-looking entries ("Column 5" twice,
    // as two different records) — block instead of guessing which one to skip.
    const existingNamesForProject = new Set(existingForProject.map((r) => r.name));
    const collisions: string[] = [];
    for (let i = fromN; i <= toN; i++) {
      const name = `${prefix.trim()} ${i}`;
      if (existingNamesForProject.has(name)) collisions.push(name);
    }
    if (collisions.length > 0) {
      toast(`Already exist for this project: ${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? `, +${collisions.length - 5} more` : ""} — adjust the range`);
      return;
    }
    setSaving(true);
    try {
      let nextNewId = nextId(idPrefix, existing);
      const ops: any[] = [];
      let seq = maxSeq;
      for (let i = fromN; i <= toN; i++) {
        seq += 1;
        const id = nextNewId;
        const n = parseInt(id.split("-")[1], 10);
        nextNewId = idPrefix + "-" + String(n + 1).padStart(4, "0");
        ops.push({ op: "upsert", coll: master, rec: { id, projectId, name: `${prefix.trim()} ${i}`, seq, active: true } });
      }
      ops.push(buildEventOp(currentUserId, "MASTER_SAVE", projectId, "", `${idPrefix === "COL" ? "Column" : "Slab"} Master · bulk created ${toN - fromN + 1}`));
      await apply(ops);
      toast(`Created ${toN - fromN + 1} entries`);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      sub={`BULK ADD ${idPrefix === "COL" ? "COLUMNS" : "SLABS"}`}
      title={`Bulk Add ${namePrefix}s`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={saving}>{saving ? "Creating…" : "Create"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Project *</label>
          <SearchDropdown
            value={projectId}
            onChange={setProjectId}
            options={[{ value: "", label: "Select project…" }, ...allProjects.map((p) => ({ value: p.id, label: p.name }))]}
          />
          {projectId && <div className="hint">{existingForProject.length} already exist for this project — new ones continue the display order after {maxSeq}.</div>}
        </div>
        <div className="field">
          <label>Name prefix *</label>
          <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={namePrefix} />
        </div>
        <div className="field">
          <label>From #</label>
          <input className="input" type="number" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To #</label>
          <input className="input" type="number" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field full hint">
          {Number.isFinite(parseInt(from, 10)) && Number.isFinite(parseInt(to, 10)) && parseInt(to, 10) >= parseInt(from, 10)
            ? `Will create: "${prefix.trim() || namePrefix} ${from}" … "${prefix.trim() || namePrefix} ${to}" (${parseInt(to, 10) - parseInt(from, 10) + 1} entries)`
            : "Enter a valid range"}
        </div>
      </div>
    </Modal>
  );
}

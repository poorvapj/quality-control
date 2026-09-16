import { useApp } from "../context/AppContext";
import { API_BASE, HOUR } from "../services/config";
import type { Op, Track, ProgressPatch } from "../types";
import { pkey, prog, trackStages, byId, coll, refLabel } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { watermarkPhoto } from "../shared/watermark";

export function useActions() {
  const { data, apply, toast, currentUserId, currentProjectId, closeDrawer, drawer, openDrawer, openSnagModal } = useApp();

  function logEvent(action: string, targetId: string, stageId: string, detail: string): Op {
    return buildEventOp(currentUserId, action, targetId, stageId, detail);
  }

  // Every status-changing progress write goes through here so `history` keeps
  // growing across rework cycles instead of getting silently overwritten —
  // `rel`/`ack`/`start`/`at` on the patch itself only ever hold the latest
  // cycle's timestamps (see ProgressPatch.history in types/index.ts).
  function progressOp(id: string, stageId: string, patch: Partial<ProgressPatch>): Op {
    if (!patch.status) return { op: "progress", key: pkey(id, stageId), patch };
    const existing = prog(data, id, stageId);
    const ts = patch.rel ?? patch.ack ?? patch.start ?? patch.at ?? Date.now();
    const history = [...(existing.history || []), { status: patch.status, ts, by: patch.by }];
    return { op: "progress", key: pkey(id, stageId), patch: { ...patch, history } };
  }

  function reopenDrawer() {
    if (drawer) openDrawer(drawer);
  }

  async function ackStage(kind: Track, id: string, stageId: string) {
    await apply([
      progressOp(id, stageId, { status: "ack", ack: Date.now(), by: currentUserId || "" }),
      logEvent("ACK", id, stageId, "Acknowledged release")
    ]);
    reopenDrawer();
    toast("Release acknowledged");
  }

  async function startStage(kind: Track, id: string, stageId: string) {
    const p = prog(data, id, stageId);
    await apply([
      progressOp(id, stageId, { status: "wip", ack: p.ack || Date.now(), start: Date.now(), by: currentUserId || "" }),
      logEvent("START", id, stageId, "Work started")
    ]);
    reopenDrawer();
    toast("Work started");
  }

  function releaseNextOps(kind: Track, id: string, stageId: string): Op[] {
    const list = trackStages(data, currentProjectId, kind);
    const i = list.findIndex((x) => x.stage.id === stageId);
    if (i === -1 || i + 1 >= list.length) return [];
    const nxt = list[i + 1].stage;
    if (prog(data, id, nxt.id).status) return [];
    return [progressOp(id, nxt.id, { status: "released", rel: Date.now() })];
  }

  async function completeStage(kind: Track, id: string, stageId: string) {
    const ops: Op[] = [
      progressOp(id, stageId, { status: "done", at: Date.now(), by: currentUserId || "", note: null }),
      logEvent("COMPLETE", id, stageId, "Stage completed"),
      ...releaseNextOps(kind, id, stageId)
    ];
    await apply(ops);
    reopenDrawer();
    toast("Completed · next stage released");
  }

  async function failStage(kind: Track, id: string, stageId: string) {
    const reason = prompt("QC failure reason (mandatory):");
    if (!reason) return;
    await apply([
      progressOp(id, stageId, { status: "fail", at: Date.now(), by: currentUserId || "", note: reason }),
      logEvent("QC_FAIL", id, stageId, reason)
    ]);
    reopenDrawer();
    toast("Gate failed — raise a snag to track the rework");
    if (kind === "unit") openSnagModal({ unitId: id, stageId, preset: reason });
  }

  async function submitChecklist(kind: Track, id: string, stageId: string, checklistId: string, results: { paramId: string; result: string; remark: string }[]) {
    const failed = results.filter((r) => r.result === "fail");
    const now = Date.now();

    if (!failed.length) {
      const ops: Op[] = [
        progressOp(id, stageId, { status: "done", at: now, by: currentUserId || "", note: null, checklistId, checklist: results }),
        logEvent("QC_PASS", id, stageId, "Checklist passed (" + results.length + " lines)"),
        ...releaseNextOps(kind, id, stageId)
      ];
      await apply(ops);
      reopenDrawer();
      toast("Gate passed · next stage released");
      return;
    }

    const stage = byId(coll(data, "stages"), stageId);
    const owner = coll(data, "users").find((u) => u.role === stage?.role && u.active !== false) || byId(coll(data, "users"), currentUserId);
    const ops: Op[] = [
      progressOp(id, stageId, { status: "fail", at: now, by: currentUserId || "", checklistId, checklist: results, note: failed.length + " parameter(s) failed" }),
      logEvent("QC_FAIL", id, stageId, failed.length + " parameter(s) failed")
    ];
    let n = 0;
    for (const f of failed) {
      const p = byId(coll(data, "qparams"), f.paramId);
      if (!p) continue;
      ops.push({
        op: "upsert", coll: "snags",
        rec: {
          id: nextId("SNG", coll(data, "snags")).replace(/(\d+)$/, (m) => String(parseInt(m, 10) + n++).padStart(4, "0")),
          projectId: currentProjectId || "",
          unitId: kind === "unit" ? id : "",
          stageId, paramId: f.paramId,
          title: p.name + " failed at " + (stage?.name || ""),
          description: f.remark || (p.name + " outside acceptance criteria (" + (p.acceptance || "as per spec") + ")."),
          severity: p.severity || "Major",
          status: "Open",
          raisedBy: currentUserId || "", raisedAt: now,
          assignedTo: owner ? owner.id : currentUserId || "",
          dueAt: now + (p.severity === "Critical" ? 24 : 72) * HOUR,
          photos: [], comments: []
        }
      });
    }
    await apply(ops);
    reopenDrawer();
    toast(failed.length + " snag(s) raised · gate failed");
  }

  async function saveAssignment(input: { targetType: Track; targetId: string; stageId: string; itemId?: string; assignedTo: string; dueAt: number | null; note: string; projectId?: string }) {
    if (!input.targetId) { toast("Pick a target first"); return; }
    const rec = {
      id: nextId("ASG", coll(data, "assignments")),
      projectId: input.projectId || currentProjectId || "",
      targetType: input.targetType,
      targetId: input.targetId,
      stageId: input.stageId,
      itemId: input.itemId,
      assignedTo: input.assignedTo,
      assignedBy: currentUserId || "",
      assignedAt: Date.now(),
      dueAt: input.dueAt,
      status: "Assigned" as const,
      note: input.note
    };
    await apply([
      { op: "upsert", coll: "assignments", rec },
      logEvent("ASSIGN", rec.targetId, rec.stageId, "Assigned to " + refLabel(data, "users", rec.assignedTo))
    ]);
    toast("Assigned to " + refLabel(data, "users", rec.assignedTo));
  }

  async function setAssignStatus(id: string, status: "Assigned" | "Accepted" | "Done") {
    const a = byId(coll(data, "assignments"), id);
    if (!a) return;
    const rec: any = Object.assign({}, a, { status });
    if (status === "Done") { rec.doneAt = Date.now(); rec.doneBy = currentUserId; }
    await apply([
      { op: "upsert", coll: "assignments", rec },
      logEvent("ASSIGN_" + status.toUpperCase(), a.targetId, a.stageId, status + " by " + refLabel(data, "users", currentUserId))
    ]);
    reopenDrawer();
    toast("Assignment marked " + status.toLowerCase());
  }

  async function saveSnag(input: { unitId: string; stageId: string; itemId?: string; paramId: string; title: string; description: string; severity: "Critical" | "Major" | "Minor"; assignedTo: string; dueAt: number | null; projectId?: string }) {
    if (!input.title.trim()) { toast("Give the snag a title"); return; }
    const rec = {
      id: nextId("SNG", coll(data, "snags")),
      projectId: input.projectId || currentProjectId || "",
      unitId: input.unitId,
      stageId: input.stageId,
      itemId: input.itemId,
      paramId: input.paramId,
      title: input.title.trim(),
      description: input.description.trim(),
      severity: input.severity,
      status: "Open" as const,
      raisedBy: currentUserId || "",
      raisedAt: Date.now(),
      assignedTo: input.assignedTo,
      dueAt: input.dueAt,
      photos: [], comments: []
    };
    await apply([
      { op: "upsert", coll: "snags", rec },
      logEvent("SNAG_RAISE", rec.unitId, rec.stageId, rec.title)
    ]);
    toast("Snag " + rec.id + " raised");
  }

  async function setSnagStatus(id: string, status: "Open" | "In Progress" | "Closed") {
    const s = byId(coll(data, "snags"), id);
    if (!s) return;
    const reopening = s.status === "Closed" && status !== "Closed";
    const patch: any = Object.assign({}, s, { status });
    if (status === "Closed") { patch.closedAt = Date.now(); patch.closedBy = currentUserId; }
    else { patch.closedAt = null; patch.closedBy = null; }
    if (reopening) {
      patch.reopenCount = (s.reopenCount || 0) + 1;
      patch.reopenedAt = Date.now();
      patch.reopenedBy = currentUserId;
    }
    await apply([
      { op: "upsert", coll: "snags", rec: patch },
      logEvent(reopening ? "SNAG_REOPEN" : "SNAG_" + status.toUpperCase().replace(" ", "_"), s.unitId || "", s.stageId, s.title)
    ]);
    reopenDrawer();
    toast(reopening ? "Snag reopened" : "Snag " + status.toLowerCase());
  }

  async function saveSnagAssignee(id: string, to: string) {
    const s = byId(coll(data, "snags"), id);
    if (!s) return;
    await apply([
      { op: "upsert", coll: "snags", rec: Object.assign({}, s, { assignedTo: to, lastReassignedBy: currentUserId, lastReassignedAt: Date.now() }) },
      logEvent("SNAG_REASSIGN", s.unitId || "", s.stageId, "to " + refLabel(data, "users", to))
    ]);
    reopenDrawer();
    toast("Reassigned to " + refLabel(data, "users", to));
  }

  async function capturePhoto(kind: "snag" | "unit" | "floor", id: string, stageId: string, file: File) {
    toast("Processing photo…");
    const label = kind === "snag" ? refLabel(data, "snags", id) : refLabel(data, kind === "unit" ? "units" : "floors", id);
    const dataUrl = await watermarkPhoto(file, label, data ? byId(coll(data, "users"), currentUserId)?.name : undefined);
    const photoType = kind === "snag" ? "snags" : "progress";
    let photo: { url: string; publicId: string | null } = { url: dataUrl, publicId: null };
    try {
      const r = await fetch(API_BASE + "/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, type: photoType })
      });
      const j = await r.json();
      if (j.url) photo = { url: j.url, publicId: j.publicId || null };
    } catch {}
    if (kind === "snag") {
      const s = byId(coll(data, "snags"), id);
      if (s) await apply([{ op: "upsert", coll: "snags", rec: Object.assign({}, s, { photos: (s.photos || []).concat([photo]) }) }]);
    } else {
      await apply([
        { op: "progress", key: pkey(id, stageId), patch: { meas: Date.now(), measBy: currentUserId || "", photo } },
        logEvent("MEASURE", id, stageId, "Hidden work measured and photographed")
      ]);
    }
    reopenDrawer();
    toast("Photo attached");
  }

  /* ---------------------------------------------------------- item-based
   * stages (RCC, Brick, AC, Electric, Plastering — any Stage.itemBased)
   * live inside ONE progress record's `checklist[]`, each cell keyed by
   * `itemId` and carrying the same status/rel/ack/start/at/by/meas/
   * measBy lifecycle a whole stage used to. These mirror ackStage/
   * startStage/completeStage/failStage/capturePhoto above, just writing
   * into one cell of that array instead of a separate progress record. */

  function stageCells(unitId: string, stageId: string) {
    return (prog(data, unitId, stageId).checklist || []).slice();
  }
  function upsertCell(cells: any[], itemId: string, patch: Record<string, unknown>) {
    const idx = cells.findIndex((c) => c.itemId === itemId);
    if (idx === -1) cells.push({ itemId, ...patch });
    else cells[idx] = { ...cells[idx], ...patch };
    return cells;
  }
  function itemStageStatus(cells: any[], items: { id: string; name?: string }[]): "wip" | "done" {
    return items.every((it) => cells.find((c) => c.itemId === it.id)?.status === "done") ? "done" : "wip";
  }
  async function writeStageCells(unitId: string, stageId: string, cells: any[], items: { id: string; name?: string }[]) {
    await apply([{ op: "progress", key: pkey(unitId, stageId), patch: { status: itemStageStatus(cells, items), checklist: cells } }]);
  }

  async function ackStageItem(unitId: string, stageId: string, itemId: string) {
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "ack", ack: Date.now(), by: currentUserId || "" });
    await apply([{ op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells } }, logEvent("ACK", unitId, stageId, "Acknowledged release")]);
    reopenDrawer();
    toast("Release acknowledged");
  }

  async function startStageItem(unitId: string, stageId: string, itemId: string) {
    const existing = stageCells(unitId, stageId).find((c) => c.itemId === itemId);
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "wip", ack: existing?.ack || Date.now(), start: Date.now(), by: currentUserId || "" });
    await apply([{ op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells } }, logEvent("START", unitId, stageId, "Work started")]);
    reopenDrawer();
    toast("Work started");
  }

  function releaseNextStageItem(cells: any[], items: { id: string; name?: string }[], idx: number): any[] {
    if (idx + 1 >= items.length) return cells;
    const nextId_ = items[idx + 1].id;
    if (cells.find((c) => c.itemId === nextId_)?.status) return cells;
    return upsertCell(cells, nextId_, { status: "released", rel: Date.now() });
  }

  async function completeStageItem(unitId: string, stageId: string, itemId: string, items: { id: string; name?: string }[]) {
    const idx = items.findIndex((it) => it.id === itemId);
    let cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "done", at: Date.now(), by: currentUserId || "", note: null });
    cells = releaseNextStageItem(cells, items, idx);
    const ops: Op[] = [
      { op: "progress", key: pkey(unitId, stageId), patch: { status: itemStageStatus(cells, items), checklist: cells } },
      logEvent("COMPLETE", unitId, stageId, (items[idx]?.name || itemId) + " completed"),
    ];
    if (itemStageStatus(cells, items) === "done") ops.push(...releaseNextOps("unit", unitId, stageId));
    await apply(ops);
    reopenDrawer();
    toast("Completed · next item released");
  }

  async function failStageItem(unitId: string, stageId: string, itemId: string, items: { id: string; name?: string }[]) {
    const reason = prompt("QC failure reason (mandatory):");
    if (!reason) return;
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "fail", at: Date.now(), by: currentUserId || "", note: reason });
    await writeStageCells(unitId, stageId, cells, items);
    await apply([logEvent("QC_FAIL", unitId, stageId, reason)]);
    reopenDrawer();
    toast("Gate failed — raise a snag to track the rework");
    openSnagModal({ unitId, stageId, itemId, preset: reason });
  }

  async function submitStageItemChecklist(unitId: string, stageId: string, itemId: string, items: { id: string; name?: string }[], checklistId: string, results: { paramId: string; result: string; remark: string }[]) {
    const failed = results.filter((r) => r.result === "fail");
    const now = Date.now();
    const idx = items.findIndex((it) => it.id === itemId);
    const item = items[idx];

    if (!failed.length) {
      let cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "done", at: now, by: currentUserId || "", note: null });
      cells = releaseNextStageItem(cells, items, idx);
      const ops: Op[] = [
        { op: "progress", key: pkey(unitId, stageId), patch: { status: itemStageStatus(cells, items), checklist: cells, checklistId } },
        logEvent("QC_PASS", unitId, stageId, (item?.name || itemId) + " checklist passed (" + results.length + " lines)"),
      ];
      if (itemStageStatus(cells, items) === "done") ops.push(...releaseNextOps("unit", unitId, stageId));
      await apply(ops);
      reopenDrawer();
      toast("Gate passed · next item released");
      return;
    }

    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "fail", at: now, by: currentUserId || "", note: failed.length + " parameter(s) failed" });
    const ops: Op[] = [
      { op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells, checklistId } },
      logEvent("QC_FAIL", unitId, stageId, failed.length + " parameter(s) failed"),
    ];
    let n = 0;
    for (const f of failed) {
      const p = byId(coll(data, "qparams"), f.paramId);
      if (!p) continue;
      ops.push({
        op: "upsert", coll: "snags",
        rec: {
          id: nextId("SNG", coll(data, "snags")).replace(/(\d+)$/, (m) => String(parseInt(m, 10) + n++).padStart(4, "0")),
          projectId: currentProjectId || "",
          unitId, stageId, itemId, paramId: f.paramId,
          title: p.name + " failed at " + (item?.name || ""),
          description: f.remark || (p.name + " outside acceptance criteria (" + (p.acceptance || "as per spec") + ")."),
          severity: p.severity || "Major",
          status: "Open",
          raisedBy: currentUserId || "", raisedAt: now,
          assignedTo: currentUserId || "",
          dueAt: now + (p.severity === "Critical" ? 24 : 72) * HOUR,
          photos: [], comments: []
        }
      });
    }
    await apply(ops);
    reopenDrawer();
    toast(failed.length + " snag(s) raised · gate failed");
  }

  async function captureStageItemPhoto(unitId: string, stageId: string, itemId: string, file: File) {
    toast("Processing photo…");
    const label = refLabel(data, "units", unitId);
    const dataUrl = await watermarkPhoto(file, label, data ? byId(coll(data, "users"), currentUserId)?.name : undefined);
    let photo: { url: string; publicId: string | null } = { url: dataUrl, publicId: null };
    try {
      const r = await fetch(API_BASE + "/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, type: "progress" })
      });
      const j = await r.json();
      if (j.url) photo = { url: j.url, publicId: j.publicId || null };
    } catch {}
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { meas: Date.now(), measBy: currentUserId || "", photo });
    await apply([
      { op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells } },
      logEvent("MEASURE", unitId, stageId, "Hidden work measured and photographed")
    ]);
    reopenDrawer();
    toast("Photo attached");
  }

  return {
    ackStage, startStage, completeStage, failStage, submitChecklist,
    saveAssignment, setAssignStatus, saveSnag, setSnagStatus, saveSnagAssignee, capturePhoto,
    ackStageItem, startStageItem, completeStageItem, failStageItem, submitStageItemChecklist, captureStageItemPhoto,
    releaseNextOps, logEvent
  };
}

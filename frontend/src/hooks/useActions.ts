import { useApp, authHeaders, notifySessionExpired } from "../context/AppContext";
import { API_BASE, HOUR } from "../services/config";
import type { Op, Track, ProgressPatch } from "../types";
import { pkey, prog, trackStages, byId, coll, refLabel } from "../shared/rules";
import { buildEventOp } from "../shared/eventLog";
import { watermarkPhoto } from "../shared/watermark";
import { makeTempId, displayId } from "../shared/helpers";

export function useActions() {
  const { data, apply, toast, currentUserId, currentProjectId, drawer, openDrawer, openSnagModal } = useApp();

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

  // apply() queues an op on this device instead of losing it when the
  // network/session fails, rather than discarding it — but every action
  // below used to show the same success toast regardless, so an action
  // that only reached the local queue looked identical, to whoever did it,
  // to one that actually reached the server. Swap in this message whenever
  // `synced` comes back false.
  const OFFLINE_TOAST = "Saved on this device — will finish submitting once you're back online";

  async function ackStage(kind: Track, id: string, stageId: string) {
    const synced = await apply([
      progressOp(id, stageId, { status: "ack", ack: Date.now(), by: currentUserId || "" }),
      logEvent("ACK", id, stageId, "Acknowledged release")
    ]);
    reopenDrawer();
    toast(synced ? "Release acknowledged" : OFFLINE_TOAST);
  }

  async function startStage(kind: Track, id: string, stageId: string) {
    const p = prog(data, id, stageId);
    const synced = await apply([
      progressOp(id, stageId, { status: "wip", ack: p.ack || Date.now(), start: Date.now(), by: currentUserId || "" }),
      logEvent("START", id, stageId, "Work started")
    ]);
    reopenDrawer();
    toast(synced ? "Work started" : OFFLINE_TOAST);
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
    const synced = await apply(ops);
    reopenDrawer();
    toast(synced ? "Completed · next stage released" : OFFLINE_TOAST);
  }

  async function failStage(kind: Track, id: string, stageId: string) {
    const reason = prompt("QC failure reason (mandatory):");
    if (!reason) return;
    const synced = await apply([
      progressOp(id, stageId, { status: "fail", at: Date.now(), by: currentUserId || "", note: reason }),
      logEvent("QC_FAIL", id, stageId, reason)
    ]);
    reopenDrawer();
    toast(synced ? "Gate failed — raise a snag to track the rework" : OFFLINE_TOAST);
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
      const synced = await apply(ops);
      reopenDrawer();
      toast(synced ? "Gate passed · next stage released" : OFFLINE_TOAST);
      return;
    }

    const stage = byId(coll(data, "stages"), stageId);
    const owner = coll(data, "users").find((u) => u.role === stage?.role && u.active !== false) || byId(coll(data, "users"), currentUserId);
    const ops: Op[] = [
      progressOp(id, stageId, { status: "fail", at: now, by: currentUserId || "", checklistId, checklist: results, note: failed.length + " parameter(s) failed" }),
      logEvent("QC_FAIL", id, stageId, failed.length + " parameter(s) failed")
    ];
    for (const f of failed) {
      const p = byId(coll(data, "qparams"), f.paramId);
      if (!p) continue;
      ops.push({
        op: "upsert", coll: "snags", create: true,
        rec: {
          // Was nextId("SNG", coll(data,"snags")) — same collision class as
          // DprForm.tsx's old id (see QualityInspection.tsx's submit()):
          // two inspectors failing a checklist around the same moment, on
          // snapshots of `snags` that haven't yet seen each other's save,
          // compute the SAME next id. The server's create:true path 409s on
          // a duplicate rather than silently overwriting, but the snag
          // simply never gets raised for the second inspector — "gate
          // failed" with no snag to show for it.
          id: makeTempId("SNG"),
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
    const synced = await apply(ops);
    reopenDrawer();
    toast(synced ? failed.length + " snag(s) raised · gate failed" : OFFLINE_TOAST);
  }

  async function saveAssignment(input: { targetType: Track; targetId: string; stageId: string; itemId?: string; assignedTo: string; dueAt: number | null; note: string; projectId?: string }) {
    if (!input.targetId) { toast("Pick a target first"); return; }
    const rec = {
      // Was nextId("ASG", coll(data,"assignments")) — same collision risk as
      // snags/DPR when two people assign something around the same moment.
      id: makeTempId("ASG"),
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
    const synced = await apply([
      { op: "upsert", coll: "assignments", create: true, rec },
      logEvent("ASSIGN", rec.targetId, rec.stageId, "Assigned to " + refLabel(data, "users", rec.assignedTo))
    ]);
    toast(synced ? "Assigned to " + refLabel(data, "users", rec.assignedTo) : OFFLINE_TOAST);
  }

  async function setAssignStatus(id: string, status: "Assigned" | "Accepted" | "Done") {
    const a = byId(coll(data, "assignments"), id);
    if (!a) return;
    // only the fields this action changes (not the whole record as it was on this screen): a colleague's change to
    // any other field of the same assignment is not written back with an old value
    const rec: any = { id: a.id, status };
    if (status === "Done") { rec.doneAt = Date.now(); rec.doneBy = currentUserId; }
    const synced = await apply([
      { op: "upsert", coll: "assignments", rec },
      logEvent("ASSIGN_" + status.toUpperCase(), a.targetId, a.stageId, status + " by " + refLabel(data, "users", currentUserId))
    ]);
    reopenDrawer();
    toast(synced ? "Assignment marked " + status.toLowerCase() : OFFLINE_TOAST);
  }

  async function saveSnag(input: { unitId: string; stageId: string; itemId?: string; paramId: string; title: string; description: string; severity: "Critical" | "Major" | "Minor"; assignedTo: string; dueAt: number | null; projectId?: string }) {
    if (!input.title.trim()) { toast("Give the snag a title"); return; }
    const rec = {
      // Was nextId("SNG", coll(data,"snags")) — same collision risk as above.
      id: makeTempId("SNG"),
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
    const synced = await apply([
      { op: "upsert", coll: "snags", create: true, rec },
      logEvent("SNAG_RAISE", rec.unitId, rec.stageId, rec.title)
    ]);
    toast(synced ? "Snag " + displayId(rec.id) + " raised" : OFFLINE_TOAST);
  }

  async function setSnagStatus(id: string, status: "Open" | "In Progress" | "Closed") {
    const s = byId(coll(data, "snags"), id);
    if (!s) return;
    const reopening = s.status === "Closed" && status !== "Closed";
    // only the fields this action changes (see setAssignStatus)
    const patch: any = { id: s.id, status };
    if (status === "Closed") { patch.closedAt = Date.now(); patch.closedBy = currentUserId; }
    else { patch.closedAt = null; patch.closedBy = null; }
    if (reopening) {
      patch.reopenCount = (s.reopenCount || 0) + 1;
      patch.reopenedAt = Date.now();
      patch.reopenedBy = currentUserId;
    }
    const synced = await apply([
      { op: "upsert", coll: "snags", rec: patch },
      logEvent(reopening ? "SNAG_REOPEN" : "SNAG_" + status.toUpperCase().replace(" ", "_"), s.unitId || "", s.stageId, s.title)
    ]);
    reopenDrawer();
    toast(!synced ? OFFLINE_TOAST : reopening ? "Snag reopened" : "Snag " + status.toLowerCase());
  }

  async function saveSnagAssignee(id: string, to: string) {
    const s = byId(coll(data, "snags"), id);
    if (!s) return;
    const synced = await apply([
      { op: "upsert", coll: "snags", rec: { id: s.id, assignedTo: to, lastReassignedBy: currentUserId, lastReassignedAt: Date.now() } },
      logEvent("SNAG_REASSIGN", s.unitId || "", s.stageId, "to " + refLabel(data, "users", to))
    ]);
    reopenDrawer();
    toast(synced ? "Reassigned to " + refLabel(data, "users", to) : OFFLINE_TOAST);
  }

  async function capturePhoto(kind: "snag" | "unit" | "floor", id: string, stageId: string, file: File) {
    toast("Processing photo…");
    const label = kind === "snag" ? refLabel(data, "snags", id) : refLabel(data, kind === "unit" ? "units" : "floors", id);
    const dataUrl = await watermarkPhoto(file, label, data ? byId(coll(data, "users"), currentUserId)?.name : undefined);
    const photoType = kind === "snag" ? "snags" : "progress";
    let photo: { url: string; publicId: string | null; localOnly?: boolean } = { url: dataUrl, publicId: null };
    try {
      const r = await fetch(API_BASE + "/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ dataUrl, type: photoType })
      });
      if (r.status === 401) notifySessionExpired();
      const j = await r.json();
      if (j.url) photo = { url: j.url, publicId: j.publicId || null };
      else photo.localOnly = true;
    } catch {
      photo.localOnly = true;
    }
    let synced = true;
    if (kind === "snag") {
      const s = byId(coll(data, "snags"), id);
      // appended on the server — two people adding a photo to the same snag no longer replace each other's list
      if (s) synced = await apply([{ op: "upsert", coll: "snags", rec: { id: s.id }, push: { photos: photo } }]);
    } else {
      synced = await apply([
        { op: "progress", key: pkey(id, stageId), patch: { meas: Date.now(), measBy: currentUserId || "", photo } },
        logEvent("MEASURE", id, stageId, "Hidden work measured and photographed")
      ]);
    }
    reopenDrawer();
    // Upload itself failing silently (kept only as raw local data) was
    // exactly how a photo-heavy submission went missing with no warning —
    // see uploadPhoto.ts for the same fix on the other photo-capture path.
    // The whole record not reaching the server at all is the more serious
    // of the two possible problems here, so it takes priority in the toast.
    toast(!synced ? OFFLINE_TOAST : photo.localOnly ? "Photo upload failed — kept locally for now, try re-uploading" : "Photo attached");
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
    return apply([{ op: "progress", items: items.map((it) => it.id), key: pkey(unitId, stageId), patch: { status: itemStageStatus(cells, items), checklist: cells } }]);
  }

  async function ackStageItem(unitId: string, stageId: string, itemId: string) {
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "ack", ack: Date.now(), by: currentUserId || "" });
    const synced = await apply([{ op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells } }, logEvent("ACK", unitId, stageId, "Acknowledged release")]);
    reopenDrawer();
    toast(synced ? "Release acknowledged" : OFFLINE_TOAST);
  }

  async function startStageItem(unitId: string, stageId: string, itemId: string) {
    const existing = stageCells(unitId, stageId).find((c) => c.itemId === itemId);
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "wip", ack: existing?.ack || Date.now(), start: Date.now(), by: currentUserId || "" });
    const synced = await apply([{ op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells } }, logEvent("START", unitId, stageId, "Work started")]);
    reopenDrawer();
    toast(synced ? "Work started" : OFFLINE_TOAST);
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
      { op: "progress", items: items.map((it) => it.id), key: pkey(unitId, stageId), patch: { status: itemStageStatus(cells, items), checklist: cells } },
      logEvent("COMPLETE", unitId, stageId, (items[idx]?.name || itemId) + " completed"),
    ];
    if (itemStageStatus(cells, items) === "done") ops.push(...releaseNextOps("unit", unitId, stageId));
    const synced = await apply(ops);
    reopenDrawer();
    toast(synced ? "Completed · next item released" : OFFLINE_TOAST);
  }

  async function failStageItem(unitId: string, stageId: string, itemId: string, items: { id: string; name?: string }[]) {
    const reason = prompt("QC failure reason (mandatory):");
    if (!reason) return;
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "fail", at: Date.now(), by: currentUserId || "", note: reason });
    const synced1 = await writeStageCells(unitId, stageId, cells, items);
    const synced2 = await apply([logEvent("QC_FAIL", unitId, stageId, reason)]);
    reopenDrawer();
    toast(synced1 && synced2 ? "Gate failed — raise a snag to track the rework" : OFFLINE_TOAST);
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
        { op: "progress", items: items.map((it) => it.id), key: pkey(unitId, stageId), patch: { status: itemStageStatus(cells, items), checklist: cells, checklistId } },
        logEvent("QC_PASS", unitId, stageId, (item?.name || itemId) + " checklist passed (" + results.length + " lines)"),
      ];
      if (itemStageStatus(cells, items) === "done") ops.push(...releaseNextOps("unit", unitId, stageId));
      const synced = await apply(ops);
      reopenDrawer();
      toast(synced ? "Gate passed · next item released" : OFFLINE_TOAST);
      return;
    }

    const cells = upsertCell(stageCells(unitId, stageId), itemId, { status: "fail", at: now, by: currentUserId || "", note: failed.length + " parameter(s) failed" });
    const ops: Op[] = [
      { op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells, checklistId } },
      logEvent("QC_FAIL", unitId, stageId, failed.length + " parameter(s) failed"),
    ];
    for (const f of failed) {
      const p = byId(coll(data, "qparams"), f.paramId);
      if (!p) continue;
      ops.push({
        op: "upsert", coll: "snags", create: true,
        rec: {
          // Was nextId("SNG", coll(data,"snags")) — same collision risk as submitChecklist above.
          id: makeTempId("SNG"),
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
    const synced = await apply(ops);
    reopenDrawer();
    toast(synced ? failed.length + " snag(s) raised · gate failed" : OFFLINE_TOAST);
  }

  async function captureStageItemPhoto(unitId: string, stageId: string, itemId: string, file: File) {
    toast("Processing photo…");
    const label = refLabel(data, "units", unitId);
    const dataUrl = await watermarkPhoto(file, label, data ? byId(coll(data, "users"), currentUserId)?.name : undefined);
    let photo: { url: string; publicId: string | null; localOnly?: boolean } = { url: dataUrl, publicId: null };
    try {
      const r = await fetch(API_BASE + "/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ dataUrl, type: "progress" })
      });
      if (r.status === 401) notifySessionExpired();
      const j = await r.json();
      if (j.url) photo = { url: j.url, publicId: j.publicId || null };
      else photo.localOnly = true;
    } catch {
      photo.localOnly = true;
    }
    const cells = upsertCell(stageCells(unitId, stageId), itemId, { meas: Date.now(), measBy: currentUserId || "", photo });
    const synced = await apply([
      { op: "progress", key: pkey(unitId, stageId), patch: { checklist: cells } },
      logEvent("MEASURE", unitId, stageId, "Hidden work measured and photographed")
    ]);
    reopenDrawer();
    toast(!synced ? OFFLINE_TOAST : photo.localOnly ? "Photo upload failed — kept locally for now, try re-uploading" : "Photo attached");
  }

  return {
    ackStage, startStage, completeStage, failStage, submitChecklist,
    saveAssignment, setAssignStatus, saveSnag, setSnagStatus, saveSnagAssignee, capturePhoto,
    ackStageItem, startStageItem, completeStageItem, failStageItem, submitStageItemChecklist, captureStageItemPhoto,
    releaseNextOps, logEvent
  };
}

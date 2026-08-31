import { useApp } from "../context/AppContext";
import { API_BASE, HOUR } from "../services/config";
import type { Op, Track, EventLog } from "../types";
import { pkey, prog, trackStages, byId, coll, refLabel } from "./rules";
import { nextId } from "./helpers";

export function useActions() {
  const { data, apply, toast, currentUserId, currentProjectId, closeDrawer, drawer, openDrawer, openSnagModal } = useApp();

  function logEvent(action: string, targetId: string, stageId: string, detail: string): Op {
    const ev: EventLog = { ts: Date.now(), userId: currentUserId || "", action, targetId, stageId, detail };
    return { op: "event", ev };
  }

  function reopenDrawer() {
    if (drawer) openDrawer(drawer);
  }

  async function ackStage(kind: Track, id: string, stageId: string) {
    await apply([
      { op: "progress", key: pkey(id, stageId), patch: { status: "ack", ack: Date.now(), by: currentUserId || "" } },
      logEvent("ACK", id, stageId, "Acknowledged release")
    ]);
    reopenDrawer();
    toast("Release acknowledged");
  }

  async function startStage(kind: Track, id: string, stageId: string) {
    const p = prog(data, id, stageId);
    await apply([
      { op: "progress", key: pkey(id, stageId), patch: { status: "wip", ack: p.ack || Date.now(), start: Date.now(), by: currentUserId || "" } },
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
    return [{ op: "progress", key: pkey(id, nxt.id), patch: { status: "released", rel: Date.now() } }];
  }

  async function completeStage(kind: Track, id: string, stageId: string) {
    const ops: Op[] = [
      { op: "progress", key: pkey(id, stageId), patch: { status: "done", at: Date.now(), by: currentUserId || "", note: null } },
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
      { op: "progress", key: pkey(id, stageId), patch: { status: "fail", at: Date.now(), by: currentUserId || "", note: reason } },
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
        { op: "progress", key: pkey(id, stageId), patch: { status: "done", at: now, by: currentUserId || "", note: null, checklistId, checklist: results } },
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
      { op: "progress", key: pkey(id, stageId), patch: { status: "fail", at: now, by: currentUserId || "", checklistId, checklist: results, note: failed.length + " parameter(s) failed" } },
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

  async function saveAssignment(input: { targetType: Track; targetId: string; stageId: string; assignedTo: string; dueAt: number | null; note: string }) {
    if (!input.targetId) { toast("Pick a target first"); return; }
    const rec = {
      id: nextId("ASG", coll(data, "assignments")),
      projectId: currentProjectId || "",
      targetType: input.targetType,
      targetId: input.targetId,
      stageId: input.stageId,
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

  async function saveSnag(input: { unitId: string; stageId: string; paramId: string; title: string; description: string; severity: "Critical" | "Major" | "Minor"; assignedTo: string; dueAt: number | null }) {
    if (!input.title.trim()) { toast("Give the snag a title"); return; }
    const rec = {
      id: nextId("SNG", coll(data, "snags")),
      projectId: currentProjectId || "",
      unitId: input.unitId,
      stageId: input.stageId,
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
    const patch: any = Object.assign({}, s, { status });
    if (status === "Closed") { patch.closedAt = Date.now(); patch.closedBy = currentUserId; }
    else { patch.closedAt = null; patch.closedBy = null; }
    await apply([
      { op: "upsert", coll: "snags", rec: patch },
      logEvent("SNAG_" + status.toUpperCase().replace(" ", "_"), s.unitId || "", s.stageId, s.title)
    ]);
    reopenDrawer();
    toast("Snag " + status.toLowerCase());
  }

  async function saveSnagAssignee(id: string, to: string) {
    const s = byId(coll(data, "snags"), id);
    if (!s) return;
    await apply([
      { op: "upsert", coll: "snags", rec: Object.assign({}, s, { assignedTo: to }) },
      logEvent("SNAG_REASSIGN", s.unitId || "", s.stageId, "to " + refLabel(data, "users", to))
    ]);
    reopenDrawer();
    toast("Reassigned to " + refLabel(data, "users", to));
  }

  async function capturePhoto(kind: "snag" | "unit" | "floor", id: string, stageId: string, file: File) {
    toast("Processing photo…");
    const label = kind === "snag" ? refLabel(data, "snags", id) : refLabel(data, kind === "unit" ? "units" : "floors", id);
    const dataUrl = await watermark(file, label, data ? byId(coll(data, "users"), currentUserId)?.name : undefined);
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

  return {
    ackStage, startStage, completeStage, failStage, submitChecklist,
    saveAssignment, setAssignStatus, saveSnag, setSnagStatus, saveSnagAssignee, capturePhoto,
    releaseNextOps, logEvent
  };
}

function watermark(file: File, label: string, byName?: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1280;
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const pad = Math.round(c.width * 0.02);
      const fs = Math.max(12, Math.round(c.width * 0.028));
      const text = `${label} · ${new Date().toLocaleString("en-IN")} · ${byName || ""}`;
      ctx.font = `600 ${fs}px Inter, sans-serif`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(pad, c.height - pad - fs * 1.8, w + fs, fs * 1.8);
      ctx.fillStyle = "#00ff66";
      ctx.fillText(text, pad + fs / 2, c.height - pad - fs * 0.5);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve("");
    img.src = URL.createObjectURL(file);
  });
}

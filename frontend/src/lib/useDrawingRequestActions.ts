/* ===========================================================================
   Drawing Requests — 4-stage review/approval state machine.

   Stage 1 (screen)      -> forward to stage 2 (assign + committed date), OR return (dead end)
   Stage 2 (produce)     -> upload file(s) + submit -> stage 3
   Stage 3 (crosscheck)  -> approve -> stage 4  |  reject -> BACK TO STAGE 2 (not stage 1)
   Stage 4 (final approve) -> approve -> overall "approved" (+ priority)  |  reject -> BACK TO STAGE 2
   "returned" (stage-1 only) -> only the original requester can "resubmit" -> always restarts at stage 1

   Every transition appends one entry to reviewHistory. Prior entries are
   never mutated or removed — always spread the existing array and add.
   =========================================================================== */

import { useApp } from "../context/AppContext";
import { byId, coll } from "./rules";
import { nextId } from "./helpers";
import type { DrawingRequest, ReviewHistoryEntry, DrawingPriority, DrawingFile } from "../types";

export function useDrawingRequestActions() {
  const { data, apply, toast, currentUserId, me } = useApp();

  function historyEntry(entry: Omit<ReviewHistoryEntry, "at" | "by" | "byName">): ReviewHistoryEntry {
    const u = me();
    return { ...entry, by: currentUserId, byName: u?.name, at: Date.now() };
  }

  async function saveDrawingRequest(rec: DrawingRequest) {
    await apply([{ op: "upsert", coll: "drawingRequests", rec }]);
  }

  /** Stage 1: forward to production, optionally assigning someone + a committed date. */
  async function forwardToStage2(id: string, assignedTo: string | null, committedDate: string | null, remarks: string) {
    const dr = byId(coll(data, "drawingRequests"), id);
    if (!dr) return;
    const rec: DrawingRequest = {
      ...dr,
      reviewStatus: "stage-2-produce",
      assignedTo,
      committedDate,
      reviewHistory: [...dr.reviewHistory, historyEntry({ stage: "stage-1-screen", action: "forwarded", remarks })]
    };
    await saveDrawingRequest(rec);
    toast("Forwarded to production (Stage 2)");
  }

  /** Stage 1: the drawing isn't needed — dead end until the requester resubmits. */
  async function returnAtStage1(id: string, remarks: string) {
    const dr = byId(coll(data, "drawingRequests"), id);
    if (!dr) return;
    const rec: DrawingRequest = {
      ...dr,
      reviewStatus: "returned",
      reviewHistory: [...dr.reviewHistory, historyEntry({ stage: "stage-1-screen", action: "returned", remarks })]
    };
    await saveDrawingRequest(rec);
    toast("Returned — the requester can resubmit");
  }

  /** Stage 2: upload the drawing(s) and submit for cross-check. */
  async function submitStage2(id: string, files: DrawingFile[], remarks: string) {
    const dr = byId(coll(data, "drawingRequests"), id);
    if (!dr) return;
    const rec: DrawingRequest = {
      ...dr,
      files: [...dr.files, ...files],
      reviewStatus: "stage-3-crosscheck",
      reviewHistory: [...dr.reviewHistory, historyEntry({ stage: "stage-2-produce", action: "submitted", remarks })]
    };
    await saveDrawingRequest(rec);
    toast("Submitted for cross-check (Stage 3)");
  }

  /** Stage 3: approve -> stage 4, or reject -> back to stage 2 (rework, not the original request). */
  async function decideStage3(id: string, approved: boolean, remarks: string) {
    const dr = byId(coll(data, "drawingRequests"), id);
    if (!dr) return;
    const rec: DrawingRequest = {
      ...dr,
      reviewStatus: approved ? "stage-4-final-approve" : "stage-2-produce",
      reviewHistory: [...dr.reviewHistory, historyEntry({ stage: "stage-3-crosscheck", action: approved ? "approved" : "returned", remarks })]
    };
    await saveDrawingRequest(rec);
    toast(approved ? "Cross-check passed · Stage 4" : "Sent back to Stage 2 for rework");
  }

  /** Stage 4: final approval -> overall approved (+ priority), or reject -> back to stage 2. */
  async function decideStage4(id: string, approved: boolean, priority: DrawingPriority | "", remarks: string) {
    const dr = byId(coll(data, "drawingRequests"), id);
    if (!dr) return;
    const rec: DrawingRequest = {
      ...dr,
      reviewStatus: approved ? "approved" : "stage-2-produce",
      priority: approved ? priority : dr.priority,
      trackingStatus: approved ? (dr.trackingStatus || "pending") : dr.trackingStatus,
      reviewHistory: [...dr.reviewHistory, historyEntry({ stage: "stage-4-final-approve", action: approved ? "approved" : "returned", remarks })]
    };
    await saveDrawingRequest(rec);
    toast(approved ? "Final approval granted" : "Sent back to Stage 2 for rework");
  }

  /** Only the original requester revives a "returned" ticket — always restarts at stage 1. */
  async function resubmit(id: string, remarks: string) {
    const dr = byId(coll(data, "drawingRequests"), id);
    if (!dr) return;
    const rec: DrawingRequest = {
      ...dr,
      reviewStatus: "stage-1-screen",
      reviewHistory: [...dr.reviewHistory, historyEntry({ stage: "stage-1-screen", action: "resubmitted", remarks })]
    };
    await saveDrawingRequest(rec);
    toast("Resubmitted — back to Stage 1");
  }

  async function updateTracking(id: string, patch: Partial<Pick<DrawingRequest, "trackingStatus" | "actualCompletionDate" | "planningVerified" | "projectAcknowledged" | "remarks">>) {
    const dr = byId(coll(data, "drawingRequests"), id);
    if (!dr) return;
    await saveDrawingRequest({ ...dr, ...patch });
  }

  async function createDrawingRequest(input: {
    projectId: string; description: string; drawingType: DrawingRequest["drawingType"];
    source: DrawingRequest["source"]; requesterName: string; isPublic: boolean;
    requestedPriority?: DrawingPriority | "";
  }) {
    const existing = coll(data, "drawingRequests");
    const rec: DrawingRequest = {
      id: nextId("DR", existing),
      ticketNo: nextId("DR", existing),
      createdAt: Date.now(),
      projectId: input.projectId,
      projectName: byId(coll(data, "projects"), input.projectId)?.name || "",
      description: input.description,
      drawingType: input.drawingType,
      source: input.source,
      requesterName: input.requesterName,
      requestedPriority: input.requestedPriority || "",
      reviewStatus: "stage-1-screen",
      reviewHistory: [{ stage: "stage-1-screen", action: "submitted", by: input.isPublic ? null : currentUserId, at: Date.now(), remarks: "Ticket created" }],
      files: [],
      assignedTo: null,
      committedDate: null,
      priority: "",
      trackingStatus: "",
      actualCompletionDate: null,
      planningVerified: false,
      projectAcknowledged: false,
      remarks: "",
      submittedByUserId: input.isPublic ? null : currentUserId,
      isPublic: input.isPublic
    };
    await apply([{ op: "upsert", coll: "drawingRequests", rec }]);
    toast("Ticket " + rec.ticketNo + " created");
    return rec.ticketNo;
  }

  return { forwardToStage2, returnAtStage1, submitStage2, decideStage3, decideStage4, resubmit, updateTracking, createDrawingRequest };
}

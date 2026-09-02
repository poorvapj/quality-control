import type { BoardData } from "../types";
import { byId, coll, refLabel, snagTarget } from "./rules";
import { downloadCsv } from "./csv";
import { HOUR } from "../services/config";

export function exportSnagCsv(data: BoardData | null, currentProjectId: string | null) {
  const all = coll(data, "snags").filter((s) => s.projectId === currentProjectId);
  const head = ["Snag ID", "Unit", "Floor", "Stage", "Parameter", "Title", "Description", "Severity", "Status",
    "Raised by", "Raised at", "Assigned to", "Due at", "Closed at", "Closed by", "Hours open"];
  const body = all.map((s) => {
    const unit = s.unitId ? byId(coll(data, "units"), s.unitId) : null;
    const end = s.closedAt || Date.now();
    return [
      s.id, snagTarget(data, s), unit ? refLabel(data, "floors", unit.floorId) : (s.floorId ? refLabel(data, "floors", s.floorId) : ""),
      refLabel(data, "stages", s.stageId), s.paramId ? refLabel(data, "qparams", s.paramId) : "",
      s.title, s.description || "", s.severity, s.status,
      refLabel(data, "users", s.raisedBy), s.raisedAt ? new Date(s.raisedAt).toISOString() : "",
      refLabel(data, "users", s.assignedTo), s.dueAt ? new Date(s.dueAt).toISOString() : "",
      s.closedAt ? new Date(s.closedAt).toISOString() : "", s.closedBy ? refLabel(data, "users", s.closedBy) : "",
      s.raisedAt ? Math.round((end - s.raisedAt) / HOUR) : ""
    ] as (string | number)[];
  });
  downloadCsv("snag-register.csv", [head, ...body]);
}

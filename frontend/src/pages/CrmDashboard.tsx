import React from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, projectUnits, trackStages, prog } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import Card from "../ui/tw/Card";
import StatTile from "../components/StatTile";
import type { TabKey } from "../types";

/* CRM's own dashboard — focused on handover progress (their actual job:
   coordinating Internal/Owner handover with buyers), not the full
   construction-stage KPI set on OpsDashboard. */
export default function CrmDashboard() {
  const { data, currentUserId, setActiveTab } = useApp();
  const projects = myProjects(data, currentUserId);
  const projectIds = projects.map((p) => p.id);

  let hoiDone = 0, hoiTotal = 0, hooDone = 0, hooTotal = 0;
  for (const pid of projectIds) {
    const stages = trackStages(data, pid, "unit");
    const hasHoi = stages.some((x) => x.stage.id === "STG-HOI");
    const hasHoo = stages.some((x) => x.stage.id === "STG-HOO");
    const units = projectUnits(data, pid);
    for (const u of units) {
      if (hasHoi) { hoiTotal++; if (prog(data, u.id, "STG-HOI").status === "done") hoiDone++; }
      if (hasHoo) { hooTotal++; if (prog(data, u.id, "STG-HOO").status === "done") hooDone++; }
    }
  }

  const openSnags = coll(data, "snags").filter((s) => s.status !== "Closed" && projectIds.includes(s.projectId));
  const critical = openSnags.filter((s) => s.severity === "Critical").length;

  const stats = [
    { label: "INTERNAL HANDOVER", val: `${hoiDone}/${hoiTotal}`, icon: "award", foot: "Units cleared", onClick: () => setActiveTab("handoverInternal" as TabKey) },
    { label: "OWNER HANDOVER", val: `${hooDone}/${hooTotal}`, icon: "award", foot: "Units cleared", onClick: () => setActiveTab("handoverOwner" as TabKey) },
    { label: "OPEN SNAGS", val: openSnags.length, icon: "bug", foot: critical + " critical", onClick: () => setActiveTab("snags" as TabKey) },
    { label: "MY PROJECTS", val: projects.length, icon: "board", foot: "In your scope" }
  ];

  return (
    <div>
      <div className="flex items-start gap-3 mt-0.5 mb-5">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="dashboard" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">My Dashboard</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            Handover progress and open issues across {projects.length} project{projects.length === 1 ? "" : "s"}.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => <StatTile key={s.label} label={s.label} value={s.val} foot={s.foot} icon={s.icon} onClick={s.onClick} />)}
      </div>

      <Card className="text-center text-[13px] text-[var(--text-muted)] py-6">
        Open Handover Checklist (Internal or Owner) above for the unit-by-unit possession flow.
      </Card>
    </div>
  );
}

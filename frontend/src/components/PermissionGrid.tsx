import React from "react";
import { MATRIX_MODULES } from "../shared/permissionMatrix";
import type { StageKey } from "../shared/permissions";
import type { ModuleAction } from "../types";
import Card from "../ui/tw/Card";
import Switch from "../ui/tw/Switch";

const ACTION_LABEL: Record<ModuleAction, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete"
};

const STAGE_FIELDS: { k: StageKey; label: string }[] = [
  { k: "canScreenStage1", label: "Stage 1 — Screen" },
  { k: "canProduceStage2", label: "Stage 2 — Produce" },
  { k: "canCrosscheckStage3", label: "Stage 3 — Cross-check" },
  { k: "canFinalApproveStage4", label: "Stage 4 — Final Approval" }
];

/* The module × action toggle grid itself — used by both PermissionMatrix.tsx
   (editing an existing user's grants) and AddUser.tsx (setting grants at
   creation time, before the user even exists yet). Purely a controlled
   {grants, onToggle} view — no data-loading of its own, so both callers can
   plug in whatever grants state (existing vs. fresh-empty) they have.

   stageGrants/onToggleStage are optional — when passed, the 4 Drawing
   Request review-chain approvals render as extra rows inside that same
   "Drawing Requests" card instead of a separate section elsewhere on the
   page, since they're conceptually part of the same module's access. */
export default function PermissionGrid({
  grants, onToggle, stageGrants, onToggleStage
}: {
  grants: Record<string, Partial<Record<ModuleAction, boolean>>>;
  onToggle: (moduleKey: string, action: ModuleAction, v: boolean) => void;
  stageGrants?: Partial<Record<StageKey, boolean>>;
  onToggleStage?: (k: StageKey, v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {MATRIX_MODULES.map((m) => {
        const g = grants[m.key] || {};
        const showStages = m.key === "drawingRequests" && stageGrants && onToggleStage;
        return (
          <Card key={m.key}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13.5px] font-bold">{m.label}</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">{m.actions.length + (showStages ? STAGE_FIELDS.length : 0)} node{m.actions.length === 1 ? "" : "s"}</div>
            </div>
            <div className="flex flex-col gap-2.5">
              {m.actions.map((a) => (
                <div key={a} className="flex items-center justify-between">
                  <div>
                    <div className="text-[12.5px] font-semibold">{ACTION_LABEL[a]}</div>
                    <div className="text-[10.5px] text-[var(--text-muted)]">{m.key}.{a}</div>
                  </div>
                  <Switch on={!!g[a]} onChange={(v) => onToggle(m.key, a, v)} />
                </div>
              ))}
              {showStages && (
                <>
                  <div className="border-t border-[var(--border)] my-1 pt-2 text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    Review Chain Approvals
                  </div>
                  {STAGE_FIELDS.map((s) => (
                    <div key={s.k} className="flex items-center justify-between">
                      <div className="text-[12.5px] font-semibold">{s.label}</div>
                      <Switch on={!!stageGrants![s.k]} onChange={(v) => onToggleStage!(s.k, v)} />
                    </div>
                  ))}
                </>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

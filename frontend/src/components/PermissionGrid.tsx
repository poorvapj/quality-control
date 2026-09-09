import React from "react";
import { MATRIX_MODULES } from "../shared/permissionMatrix";
import type { ModuleAction } from "../types";
import Card from "../ui/tw/Card";
import Switch from "../ui/tw/Switch";

const ACTION_LABEL: Record<ModuleAction, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete"
};

/* The module × action toggle grid itself — used by both PermissionMatrix.tsx
   (editing an existing user's grants) and AddUser.tsx (setting grants at
   creation time, before the user even exists yet). Purely a controlled
   {grants, onToggle} view — no data-loading of its own, so both callers can
   plug in whatever grants state (existing vs. fresh-empty) they have. */
export default function PermissionGrid({
  grants, onToggle
}: {
  grants: Record<string, Partial<Record<ModuleAction, boolean>>>;
  onToggle: (moduleKey: string, action: ModuleAction, v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {MATRIX_MODULES.map((m) => {
        const g = grants[m.key] || {};
        return (
          <Card key={m.key}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13.5px] font-bold">{m.label}</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">{m.actions.length} node{m.actions.length === 1 ? "" : "s"}</div>
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
            </div>
          </Card>
        );
      })}
    </div>
  );
}

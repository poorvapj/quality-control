import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, byId } from "../shared/rules";
import { buildEventOp } from "../shared/eventLog";
import { MATRIX_MODULES, countGrantedActions } from "../shared/permissionMatrix";
import type { ModuleAction, ModuleGrant } from "../types";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";

const ACTION_LABEL: Record<ModuleAction, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete"
};

/* Small pill switch — no shared <Toggle> component exists yet in ui/tw,
   every other bool field in the app uses a plain checkbox (RecordModal.tsx)
   which doesn't match the reference screenshot's switch look, so this is a
   local, self-contained control rather than a new shared primitive. */
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
        (on ? "bg-primary" : "bg-[var(--bg-subtle)] border border-[var(--border)]")
      }
    >
      <span
        className={
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform " +
          (on ? "translate-x-[18px]" : "translate-x-1")
        }
      />
    </button>
  );
}

export default function PermissionMatrix() {
  const { data, apply, currentUserId, toast } = useApp();
  const users = coll(data, "users").filter((u) => u.id !== "U-ADMIN");
  const [userId, setUserId] = useState(users[0]?.id || "");
  const existing = coll(data, "moduleGrants").find((g) => g.userId === userId) || null;

  const [roleLabel, setRoleLabel] = useState(existing?.roleLabel || "");
  const [grants, setGrants] = useState<Record<string, Partial<Record<ModuleAction, boolean>>>>(existing?.grants || {});
  const [loadedFor, setLoadedFor] = useState(userId);

  // Re-sync local draft when the selected user changes (not on every data
  // refresh, so mid-edit toggles aren't clobbered by a live-data poll).
  if (loadedFor !== userId) {
    const rec = coll(data, "moduleGrants").find((g) => g.userId === userId) || null;
    setRoleLabel(rec?.roleLabel || "");
    setGrants(rec?.grants || {});
    setLoadedFor(userId);
  }

  const user = byId(users, userId);
  const assignedCount = countGrantedActions(grants);

  function toggle(moduleKey: string, action: ModuleAction, v: boolean) {
    setGrants((prev) => ({ ...prev, [moduleKey]: { ...prev[moduleKey], [action]: v } }));
  }

  async function save() {
    if (!userId) return;
    const rec: ModuleGrant = { id: "MG-" + userId, userId, roleLabel: roleLabel.trim() || undefined, grants };
    await apply([
      { op: "upsert", coll: "moduleGrants", rec },
      buildEventOp(currentUserId, "PERMISSION_UPDATE", userId, "", `Updated module grants for ${user?.name || userId}`)
    ]);
    toast("Permissions saved");
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-6">
        <div className="flex gap-3.5 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="permissions" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Permission Matrix</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Grant a user extra access on top of their role — never removes anything their role already allows.
            </div>
          </div>
        </div>
      </div>

      <Card className="flex gap-4 flex-wrap items-end mb-5">
        <div className="w-[220px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">User</div>
          <SearchDropdown
            value={userId}
            onChange={setUserId}
            options={users.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))}
            neutralActive
          />
        </div>
        <div className="w-[220px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Custom Role Label (optional)</div>
          <input className="input w-full" placeholder="e.g. Site Auditor" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} />
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Assigned authorizations</div>
          <div className="text-xl font-extrabold leading-tight">{assignedCount}</div>
        </div>
      </Card>

      {!userId ? (
        <Card className="text-center text-[13px] text-[var(--text-muted)]">No users to grant permissions to.</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
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
                      <Switch on={!!g[a]} onChange={(v) => toggle(m.key, a, v)} />
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {userId && (
        <div className="flex justify-end">
          <Btn label="Save Permissions" color="primary" onClick={save} />
        </div>
      )}
    </div>
  );
}

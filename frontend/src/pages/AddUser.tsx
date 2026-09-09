import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { ROLES } from "../services/config";
import { countGrantedActions } from "../shared/permissionMatrix";
import type { ModuleAction, Op, Role } from "../types";
import NavIcon from "../components/NavIcon";
import PermissionGrid from "../components/PermissionGrid";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Switch from "../ui/tw/Switch";

/* Dedicated user-creation screen (Masters ▸ Users ▸ "+ New" lands here
   instead of the generic RecordModal) — combines the account fields with
   the Permission Matrix so an admin can grant module access at creation
   time in one screen, instead of a separate trip to Permission Matrix
   afterward. Editing an EXISTING user still goes through RecordModal as
   before (same field set, now including Slack Member ID/Password there
   too, since both are just added to MASTERS.users.fields). */
export default function AddUser() {
  const { data, apply, currentUserId, toast, setActiveTab, setActiveMaster } = useApp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [slackId, setSlackId] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("CIVIL");
  const [teamId, setTeamId] = useState("");
  const [active, setActive] = useState(true);
  const teams = coll(data, "teams").filter((t) => t.active !== false);
  const [grants, setGrants] = useState<Record<string, Partial<Record<ModuleAction, boolean>>>>({});
  const [saving, setSaving] = useState(false);

  const assignedCount = countGrantedActions(grants);

  function toggle(moduleKey: string, action: ModuleAction, v: boolean) {
    setGrants((prev) => ({ ...prev, [moduleKey]: { ...prev[moduleKey], [action]: v } }));
  }

  function backToUsers() {
    setActiveMaster("users");
    setActiveTab("masters");
  }

  async function save() {
    if (!name.trim() || !email.trim() || !password || !role) {
      toast("Full name, email, password, and role are required");
      return;
    }
    setSaving(true);
    const id = nextId("USR", coll(data, "users"));
    const ops: Op[] = [
      {
        op: "upsert", coll: "users",
        rec: {
          id, name: name.trim(), email: email.trim(), phone: phone.trim() || undefined,
          slackId: slackId.trim() || undefined, password, role, teamId: teamId || undefined, active
        } as any
      }
    ];
    if (Object.keys(grants).length > 0) {
      ops.push({ op: "upsert", coll: "moduleGrants", rec: { id: "MG-" + id, userId: id, grants } });
    }
    ops.push(buildEventOp(currentUserId, "MASTER_SAVE", id, "", `Created user ${name.trim()}`));
    await apply(ops);
    setSaving(false);
    toast("User created");
    backToUsers();
  }

  return (
    <div>
      <div className="flex items-start gap-3.5 mt-0.5 mb-6">
        <button
          type="button"
          onClick={backToUsers}
          className="w-9 h-9 shrink-0 rounded-radius-md border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center hover:bg-[var(--bg-card-hover)]"
        >
          <NavIcon name="chevronsLeft" size={15} />
        </button>
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="team" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">Add New User</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">Create a new team member account.</div>
        </div>
      </div>

      <Card className="mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Full Name *</div>
            <input className="input w-full" placeholder="e.g. Rahul Gupta" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Email Address *</div>
            <input className="input w-full" type="email" placeholder="e.g. rahul@neotericgrp.in" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Mobile</div>
            <input className="input w-full" placeholder="e.g. 9876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Slack Member ID</div>
            <input className="input w-full" placeholder="e.g. U0123ABCDE" value={slackId} onChange={(e) => setSlackId(e.target.value)} />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Password *</div>
            <input className="input w-full" type="password" autoComplete="new-password" placeholder="Set initial password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Role *</div>
            <select className="select w-full" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {Object.keys(ROLES).map((r) => <option key={r} value={r}>{ROLES[r as Role].name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Team</div>
            <select className="select w-full" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">— None —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2.5 mt-4 pt-4 border-t border-[var(--border)]">
          <Switch on={active} onChange={setActive} />
          <span className="text-[12.5px] font-semibold">{active ? "Active" : "Inactive"}</span>
        </div>
      </Card>

      <Card className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[13.5px] font-bold">Role Permission Matrix</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Grants extra access on top of the Role above — none required.</div>
        </div>
        <div className="text-right">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Assigned authorizations</div>
          <div className="text-xl font-extrabold leading-tight">{assignedCount}</div>
        </div>
      </Card>

      <div className="mb-5">
        <PermissionGrid grants={grants} onToggle={toggle} />
      </div>

      <div className="flex justify-end gap-2">
        <Btn label="Cancel" color="secondary" onClick={backToUsers} disabled={saving} />
        <Btn label={saving ? "Creating…" : "Create User"} color="primary" onClick={save} disabled={saving} />
      </div>
    </div>
  );
}

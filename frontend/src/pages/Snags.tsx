import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel, snagTarget } from "../shared/rules";
import { dueLabel, ago } from "../shared/helpers";
import { ESCALATION_DAYS, HOUR } from "../services/config";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge, { type BadgeColor } from "../ui/tw/Badge";

const DUE_BADGE_COLOR: Record<"mute" | "fail" | "gate", BadgeColor> = { mute: "gray", fail: "red", gate: "amber" };
const SEVERITY_BADGE_COLOR: Record<string, BadgeColor> = { Critical: "red", Major: "amber" };
const STATUS_BADGE_COLOR: Record<string, BadgeColor> = { "In Progress": "blue" };

export default function Snags() {
  const { data, currentProjectId, currentUserId, openSnagModal, openDrawer, apply, toast } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const [q, setQ] = useState("");
  const [fs, setFs] = useState("");
  const [fv, setFv] = useState("");
  const [fm, setFm] = useState("");

  async function deleteSnag(e: React.MouseEvent, s: { id: string; title: string }) {
    e.stopPropagation();
    if (!confirm(`Delete snag ${s.id} — "${s.title}"?\n\nThis removes it for everyone on the board.`)) return;
    await apply([{ op: "delete", coll: "snags", id: s.id }]);
    toast("Deleted " + s.id);
  }

  let list = coll(data, "snags").filter((s) => s.projectId === currentProjectId);
  if (fs) list = list.filter((s) => s.status === fs);
  if (fv) list = list.filter((s) => s.severity === fv);
  if (fm === "mine") list = list.filter((s) => s.assignedTo === currentUserId);
  if (fm === "raised") list = list.filter((s) => s.raisedBy === currentUserId);
  if (q) {
    const ql = q.toLowerCase();
    list = list.filter((s) => (s.title + " " + (s.description || "") + " " + snagTarget(data, s)).toLowerCase().includes(ql));
  }
  list = list.slice().sort(
    (a, b) => (b.status === "Closed" ? -1 : 1) - (a.status === "Closed" ? -1 : 1) || (b.raisedAt || 0) - (a.raisedAt || 0)
  );

  const all = coll(data, "snags").filter((s) => s.projectId === currentProjectId);
  const open = all.filter((s) => s.status !== "Closed");
  const overdue = open.filter((s) => s.dueAt && s.dueAt < Date.now());
  // Escalation is deliberately computed on read, not a cron job or persisted
  // flag — always reflects the live picture, no scheduler/notification
  // infra needed. Threshold: overdue by ESCALATION_DAYS+ still-open days.
  const escalated = open
    .filter((s) => s.dueAt && Date.now() - s.dueAt >= ESCALATION_DAYS * 24 * HOUR)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-6">
        <div className="flex gap-3.5 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="snags" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Snag Register</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              {open.length} open · {overdue.length} overdue · {all.length - open.length} closed
            </div>
          </div>
        </div>
        <Btn label="＋ Raise snag" size="sm" onClick={() => openSnagModal({ unitId: "", stageId: "" })} />
      </div>

      {escalated.length > 0 && (
        <Card className="mb-4 border-[var(--color-fail)] bg-[rgba(239,68,68,0.06)]">
          <div className="text-[12.5px] font-extrabold text-[var(--color-fail)] mb-2">
            ⚠ {escalated.length} snag{escalated.length === 1 ? "" : "s"} escalated — overdue {ESCALATION_DAYS}+ days, needs senior attention
          </div>
          {escalated.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 py-3.5 px-4 border-b border-[var(--border)] cursor-pointer transition-colors last:border-b-0 border-l-4 border-l-[var(--color-fail)] bg-[rgba(239,68,68,0.05)]"
              onClick={() => openDrawer({ kind: "snag", id: s.id })}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold">{s.id} · {s.title}</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-normal">{snagTarget(data, s)} · assigned to {refLabel(data, "users", s.assignedTo)} · {dueLabel(s.dueAt).text}</div>
              </div>
              <Badge color={SEVERITY_BADGE_COLOR[s.severity] || "gray"}>{s.severity}</Badge>
            </div>
          ))}
        </Card>
      )}

      <Card padded={false} className="min-h-[70vh] p-4.5">
        <div className="flex gap-2.5 items-center flex-wrap mb-4 pb-1">
          <input className="input grow" placeholder="Search snags by title, unit or description…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="w-40">
            <SearchDropdown
              searchable={false}
              value={fs}
              onChange={setFs}
              options={[
                { value: "", label: "All statuses" },
                { value: "Open", label: "Open" },
                { value: "In Progress", label: "In Progress" },
                { value: "Closed", label: "Closed" }
              ]}
              neutralActive
            />
          </div>
          <div className="w-40">
            <SearchDropdown
              searchable={false}
              value={fv}
              onChange={setFv}
              options={[
                { value: "", label: "All severities" },
                { value: "Critical", label: "Critical" },
                { value: "Major", label: "Major" },
                { value: "Minor", label: "Minor" }
              ]}
              neutralActive
            />
          </div>
          <div className="w-[170px]">
            <SearchDropdown
              searchable={false}
              value={fm}
              onChange={setFm}
              options={[
                { value: "", label: "Everyone" },
                { value: "mine", label: "Assigned to me" },
                { value: "raised", label: "Raised by me" }
              ]}
              neutralActive
            />
          </div>
        </div>
        <div>
          {list.length === 0 && <div className="py-7.5 px-5 text-center text-[var(--text-muted)] text-[13px]">No snags match these filters.</div>}
          {list.map((s) => {
            const d = dueLabel(s.dueAt);
            const closed = s.status === "Closed";
            return (
              <div
                key={s.id}
                className={
                  "flex items-center justify-between gap-3 py-3.5 px-4 border-b border-[var(--border)] cursor-pointer transition-colors last:border-b-0" +
                  (closed ? " opacity-60" : "") +
                  (!closed && s.severity === "Critical" ? " border-l-4 border-l-[var(--color-fail)] bg-[rgba(239,68,68,0.05)]" : "")
                }
                onClick={() => openDrawer({ kind: "snag", id: s.id })}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold">{s.id} · {s.title}</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-normal">
                    {snagTarget(data, s)} · {refLabel(data, "stages", s.stageId)} ·{" "}
                    {s.paramId ? refLabel(data, "qparams", s.paramId) + " · " : ""}
                    raised by {refLabel(data, "users", s.raisedBy)} {ago(s.raisedAt)} · on {refLabel(data, "users", s.assignedTo)}
                  </div>
                </div>
                <div className="flex gap-1.5 items-center shrink-0">
                  <Badge color={SEVERITY_BADGE_COLOR[s.severity] || "gray"}>{s.severity}</Badge>
                  <Badge color={closed ? "green" : STATUS_BADGE_COLOR[s.status] || "red"}>{s.status}</Badge>
                  {!closed && <Badge color={DUE_BADGE_COLOR[d.cls]}>{d.text}</Badge>}
                  {isAdmin && (
                    <button
                      title="Delete"
                      onClick={(e) => deleteSnag(e, s)}
                      className="w-7 h-7 shrink-0 rounded-radius-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-card-hover)]"
                    >
                      <NavIcon name="trash" size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

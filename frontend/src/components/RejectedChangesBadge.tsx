import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import Modal from "./Modal";
import NavIcon from "./NavIcon";
import { parseRejected, REJECTED_KEY, type RejectedEntry } from "../shared/rejected";

/* A change the server refused (not allowed, the id was taken a moment ago, validation...) disappears from the screen and
   from the offline queue. Its content is kept in this browser (shared/rejected.ts; never a password) — this badge makes
   that visible and lets the person look at it, copy it, and re-enter it. It shows nothing while the list is empty. */
function summarize(e: RejectedEntry): string[] {
  const lines: string[] = [];
  for (const op of e.ops as any[]) {
    if (op.op === "upsert") {
      const r = op.rec || {};
      lines.push(`${op.create ? "create" : "save"} ${op.coll} · ${r.name || r.title || r.ticketNo || r.description || r.id || "?"}`);
    } else if (op.op === "delete") lines.push(`delete ${op.coll} · ${op.id}`);
    else if (op.op === "progress") lines.push(`progress · ${op.key}`);
  }
  return lines.slice(0, 6);
}

export default function RejectedChangesBadge() {
  const { rejectedCount, clearRejected, toast } = useApp();
  const [open, setOpen] = useState(false);
  if (rejectedCount === 0) return null;
  let list: RejectedEntry[] = [];
  try { list = parseRejected(localStorage.getItem(REJECTED_KEY)).slice().reverse(); } catch {}

  async function copy() {
    try { await navigator.clipboard.writeText(JSON.stringify(list, null, 2)); toast("Details copied"); } catch { toast("Could not copy — select the text instead"); }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", bottom: 20, left: 20, zIndex: 2000, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", border: "none",
          background: "var(--color-gate, #D97706)", color: "#fff", padding: "9px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)"
        }}
        title="The server refused these changes. They are kept on this device so you can re-enter them."
      >
        <NavIcon name="clock" size={14} />
        {rejectedCount} change{rejectedCount === 1 ? "" : "s"} refused — view
      </button>
      <Modal
        open={open}
        sub="NOT SAVED"
        title="Changes the server refused"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={copy}>Copy details</button>
            <button className="btn btn-secondary" onClick={() => { clearRejected(); setOpen(false); }}>Dismiss all</button>
            <button className="btn btn-primary" onClick={() => setOpen(false)}>Close</button>
          </>
        }
      >
        <div className="hint" style={{ marginBottom: 12 }}>These were NOT saved. Re-enter them if you still need them. Passwords are never kept here.</div>
        {list.map((e, i) => (
          <div key={e.at + "-" + i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 700 }}>{new Date(e.at).toLocaleString("en-IN")}</div>
            <div style={{ color: "var(--color-fail, #DC2626)", margin: "2px 0 4px" }}>{e.error}</div>
            {summarize(e).map((l, j) => <div key={j} className="hint">{l}</div>)}
          </div>
        ))}
      </Modal>
    </>
  );
}

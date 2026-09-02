import React, { useEffect, useState } from "react";
import { useApp, authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import NavIcon from "../components/NavIcon";

interface BackupSummary {
  id: string;
  createdAt: number;
  createdBy: string | null;
  counts: Record<string, number>;
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Backups() {
  const { toast } = useApp();
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(API_BASE + "/api/backups", { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Couldn't load backups"); setBackups([]); return; }
      setBackups(j.backups || []);
    } catch {
      toast("Couldn't reach the server");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createBackup() {
    setCreating(true);
    try {
      const r = await fetch(API_BASE + "/api/backups", { method: "POST", headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Backup failed"); return; }
      toast("Backup created");
      await load();
    } catch {
      toast("Couldn't reach the server");
    } finally {
      setCreating(false);
    }
  }

  async function downloadBackup(id: string) {
    const r = await fetch(API_BASE + "/api/backups/" + id, { headers: authHeaders() });
    const j = await r.json();
    if (!r.ok) { toast(j.error || "Couldn't fetch backup"); return; }
    const blob = new Blob([JSON.stringify(j, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = id + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function restoreBackup(b: BackupSummary) {
    const totalRecords = Object.values(b.counts).reduce((a, n) => a + n, 0);
    const confirmed = confirm(
      `Restore the backup from ${fmtDateTime(b.createdAt)}?\n\n` +
      `This REPLACES everything currently on the board (all projects, users, snags, reports — ${totalRecords} records total) with this backup's data. This cannot be undone.\n\n` +
      `Type OK only if you're certain.`
    );
    if (!confirmed) return;
    setRestoringId(b.id);
    try {
      const r = await fetch(API_BASE + "/api/backups/" + b.id + "/restore", { method: "POST", headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Restore failed"); return; }
      toast("Restored — reloading...");
      setTimeout(() => window.location.reload(), 900);
    } catch {
      toast("Couldn't reach the server");
    } finally {
      setRestoringId(null);
    }
  }

  async function deleteBackup(b: BackupSummary) {
    const confirmed = confirm(`Permanently delete the backup from ${fmtDateTime(b.createdAt)}? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingId(b.id);
    try {
      const r = await fetch(API_BASE + "/api/backups/" + b.id, { method: "DELETE", headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Delete failed"); return; }
      toast("Backup deleted");
      setBackups((prev) => prev.filter((x) => x.id !== b.id));
    } catch {
      toast("Couldn't reach the server");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="database" size={20} /></div>
          <div>
            <div className="page-title">Backups</div>
            <div className="page-desc">Snapshot and restore the whole board — a safety net against an accidental reset or bad change.</div>
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={createBackup} disabled={creating}>
            {creating ? "Creating…" : "＋ Create Backup Now"}
          </button>
        </div>
      </div>

      <div className="panel-card">
        <div className="table-scroll">
          {loading ? (
            <div className="empty">Loading…</div>
          ) : backups.length === 0 ? (
            <div className="empty">No backups yet — click "Create Backup Now" to make the first one.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Created</th><th>By</th><th>Records</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDateTime(b.createdAt)}</td>
                    <td>{b.createdBy || "—"}</td>
                    <td className="num">{Object.values(b.counts).reduce((a, n) => a + n, 0)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-secondary btn-sm" title="Download JSON" onClick={() => downloadBackup(b.id)}>
                          <NavIcon name="download" size={13} />
                        </button>
                        <button
                          className="btn btn-danger btn-sm solid"
                          title="Restore this backup"
                          disabled={restoringId === b.id}
                          onClick={() => restoreBackup(b)}
                        >
                          {restoringId === b.id ? "Restoring…" : "Restore"}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          title="Delete this backup"
                          disabled={deletingId === b.id}
                          onClick={() => deleteBackup(b)}
                        >
                          <NavIcon name="trash" size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

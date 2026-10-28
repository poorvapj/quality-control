import React from "react";
import { useApp } from "../context/AppContext";
import NavIcon from "./NavIcon";
import RejectedChangesBadge from "./RejectedChangesBadge";

/** A save that only got queued (offline, server asleep, expired session)
 *  used to be visible only as one 2.6s toast — miss it, and there was no
 *  way to tell a change was still unsynced versus actually saved. This
 *  stays on screen the whole time there's anything queued, so it's never
 *  invisible: glance at it any time to see whether everything's synced. */
export default function PendingSyncBadge() {
  const { pendingCount } = useApp();
  if (pendingCount === 0) return <RejectedChangesBadge />;
  return (
    <>
    <RejectedChangesBadge />
    <div
      style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 2000,
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--color-fail, #DC2626)", color: "#fff",
        padding: "9px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)"
      }}
      title="These changes are saved on this device and will finish submitting automatically once you're back online"
    >
      <NavIcon name="clock" size={14} />
      {pendingCount} change{pendingCount === 1 ? "" : "s"} waiting to sync
    </div>
    </>
  );
}

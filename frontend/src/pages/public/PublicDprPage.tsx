import React, { useState } from "react";
import DprForm from "../../components/DprForm";
import Toast from "../../components/Toast";

/** Standalone, no-login page. Reachable at /dpr/new — no sidebar, no header,
 *  no account/session concept at all. */
export default function PublicDprPage() {
  const [doneId, setDoneId] = useState<string | null>(null);

  return (
    <div className="login-screen" style={{ alignItems: "flex-start", overflowY: "auto", padding: "40px 20px" }}>
      <div className="login-card" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="login-brand">
          <div className="brand-logo" style={{ width: 44, height: 44, fontSize: 18 }}>N</div>
          <div>
            <div className="brand-title" style={{ fontSize: 16 }}>NEOTERIC GROUP</div>
            <div className="brand-sub">DAILY PROGRESS REPORT</div>
          </div>
        </div>
        {doneId ? (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>✅ Submitted</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Your daily progress report has been recorded. You can close this page.</div>
          </div>
        ) : (
          <div style={{ marginTop: 20 }}>
            <DprForm isPublic onDone={setDoneId} />
          </div>
        )}
      </div>
      <Toast />
    </div>
  );
}

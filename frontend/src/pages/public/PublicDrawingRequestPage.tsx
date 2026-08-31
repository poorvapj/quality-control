import React, { useState } from "react";
import DrawingRequestForm from "../../components/DrawingRequestForm";
import Toast from "../../components/Toast";

/** Standalone, no-login page. Reachable at /drawing-requests/new. */
export default function PublicDrawingRequestPage() {
  const [ticketNo, setTicketNo] = useState<string | null>(null);

  return (
    <div className="login-screen" style={{ alignItems: "flex-start", overflowY: "auto", padding: "40px 20px" }}>
      <div className="login-card" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="login-brand">
          <div className="brand-logo" style={{ width: 44, height: 44, fontSize: 18 }}>N</div>
          <div>
            <div className="brand-title" style={{ fontSize: 16 }}>NEOTERIC GROUP</div>
            <div className="brand-sub">DRAWING REQUEST</div>
          </div>
        </div>
        {ticketNo ? (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>✅ Ticket {ticketNo} created</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Your drawing request has been raised and will go through the review chain. You can close this page.</div>
          </div>
        ) : (
          <div style={{ marginTop: 20 }}>
            <DrawingRequestForm isPublic onDone={setTicketNo} />
          </div>
        )}
      </div>
      <Toast />
    </div>
  );
}

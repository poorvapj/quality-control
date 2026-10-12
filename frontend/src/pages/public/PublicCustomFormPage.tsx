import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import { coll } from "../../shared/rules";
import CustomFormFill from "../../components/CustomFormFill";
import Toast from "../../components/Toast";

/** Standalone, no-login page for any admin-built custom form — reachable
 *  at /forms/<formId> (routes/publicRoutes.tsx), same no-sidebar/no-header
 *  pattern as PublicDprPage.tsx. Only renders when the form exists, is
 *  active, and is marked public — otherwise shows a plain "not found"
 *  message instead of silently exposing an internal-only form's fields. */
export default function PublicCustomFormPage() {
  const { data } = useApp();
  const [doneId, setDoneId] = useState<string | null>(null);
  const formId = window.location.pathname.replace(/\/+$/, "").split("/").pop() || "";
  const form = coll(data, "forms").find((f) => f.id === formId);

  return (
    <div className="login-screen" style={{ alignItems: "flex-start", overflowY: "auto", padding: "40px 20px" }}>
      <div className="login-card" style={{ maxWidth: 820, width: "100%", margin: "0 auto" }}>
        <div className="login-brand">
          <div className="brand-logo" style={{ width: 44, height: 44, fontSize: 18 }}>N</div>
          <div>
            <div className="brand-title" style={{ fontSize: 16 }}>NEOTERIC GROUP</div>
            <div className="brand-sub">{form?.name?.toUpperCase() || "FORM"}</div>
          </div>
        </div>
        {!data ? (
          <div style={{ marginTop: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : !form || form.active === false || !form.isPublic ? (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Form not available</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>This link may be inactive or no longer public.</div>
          </div>
        ) : doneId ? (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>✅ Submitted</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Your response has been recorded. You can close this page.</div>
          </div>
        ) : (
          <div style={{ marginTop: 20 }}>
            <CustomFormFill form={form} onDone={setDoneId} />
          </div>
        )}
      </div>
      <Toast />
    </div>
  );
}

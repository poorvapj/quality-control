import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import NavIcon from "./NavIcon";

export default function LoginScreen() {
  const { data, mode, login } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!data && mode === "offline") {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>Can't reach the board</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Start the backend (<code>node server.js</code> in <code>backend/</code>) so the app has data to sign in against, then reload.
          </div>
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    const err = await login(email.trim(), password);
    setSubmitting(false);
    if (err) setError(err);
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-logo" style={{ width: 48, height: 48, fontSize: 20 }}>N</div>
          <div>
            <div className="brand-title" style={{ fontSize: 17 }}>NEOTERIC GROUP</div>
            <div className="brand-sub">TOWER QUALITY BOARD</div>
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="field" style={{ marginTop: 22 }}>
            <label>Email</label>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@neotericgrp.in"
              autoFocus
            />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Password</label>
            <div style={{ position: "relative" }}>
              <input
                className="input"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
                  width: 40, height: 40, background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center"
                }}
              >
                <NavIcon name={showPassword ? "eyeOff" : "eye"} size={16} />
              </button>
            </div>
          </div>

          {error && (
            <div className="note-box" style={{ marginTop: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 18, justifyContent: "center" }}
            disabled={!email.trim() || !password || submitting}
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../../context/AppContext";
import { ROLES } from "../../services/config";
import { coll } from "../../shared/rules";
import SearchDropdown from "../../components/SearchDropdown";
import "./Header.css";

export default function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { data, currentUserId, setCurrentUserId, me, logout } = useApp();
  const [dark, setDark] = useState(() => localStorage.getItem("neoteric_theme") !== "light");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem("neoteric_theme", next ? "dark" : "light"); } catch { }
  };

  const users = coll(data, "users").filter((u) => u.active !== false);
  const u = me();
  const roleLabel = u && ROLES[u.role] ? ROLES[u.role].name : u?.role || "—";
  const initials = u ? u.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "--";

  return (
    <header>
      <div className="header-inner">
        <div className="header-left">
          <button className="btn-icon menu-btn" onClick={onToggleSidebar} title="Menu">☰</button>
          <div
            style={{
              width: 36,
              height: 36,
              flexShrink: 0,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 5,
            }}
          >
            <img src="/neoteric-logo.png" alt="Neoteric" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-title" style={{ fontSize: 14, fontWeight: 700 }}>Neoteric Properties</div>
            <div className="header-subtitle" style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 400 }}>Quality Control &amp; Handoff System</div>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn-icon" onClick={toggleTheme} title="Toggle theme">{dark ? "☾" : "☀"}</button>
          <div className="account-wrap">
            <button className="account-btn" ref={btnRef} onClick={() => setMenuOpen((o) => !o)}>
              <div className="account-name">
                <div className="n">{u ? u.name : "—"}</div>
                <div className="r">{roleLabel}</div>
              </div>
              <div className="role-avatar" title="Signed in as">{initials}</div>
            </button>
            {menuOpen && (
              <div className="account-menu open" ref={menuRef}>
                <div className="account-menu-header">
                  <div className="n">{u ? u.name : "—"}</div>
                  <div className="r">{roleLabel}</div>
                </div>
                {u?.id === "U-ADMIN" && (
                  <>
                    <label className="micro-label">Switch role</label>
                    <div style={{ marginBottom: 10 }}>
                      <SearchDropdown
                        value={currentUserId ?? ""}
                        onChange={setCurrentUserId}
                        options={users.map((usr) => ({ value: usr.id, label: `${usr.name} · ${usr.role}` }))}
                        neutralActive
                      />
                    </div>
                  </>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => { setMenuOpen(false); logout(); }}>Logout</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

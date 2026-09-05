import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../../context/AppContext";
import { ROLES } from "../../services/config";
import { coll } from "../../shared/rules";
import NavIcon from "../../components/NavIcon";
import "./Header.css";

export default function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { data, currentUserId, setCurrentUserId, me, logout } = useApp();
  const [dark, setDark] = useState(() => localStorage.getItem("neoteric_theme") !== "light");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"menu" | "switch">("menu");
  const [switchQ, setSwitchQ] = useState("");
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

  // Always land back on the main menu (not mid-switch) the next time it opens.
  useEffect(() => {
    if (!menuOpen) { setMenuView("menu"); setSwitchQ(""); }
  }, [menuOpen]);

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
                {menuView === "menu" ? (
                  <>
                    <div className="account-menu-header">
                      <div className="n">{u ? u.name : "—"}</div>
                      <div className="r">{roleLabel}</div>
                    </div>
                    {u?.id === "U-ADMIN" && (
                      <button className="account-menu-row" onClick={() => setMenuView("switch")}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14 }}>⇄</span> Switch Account
                        </span>
                        <span style={{ color: "var(--theme-primary)", fontWeight: 800 }}>›</span>
                      </button>
                    )}
                    <button className="account-menu-row danger" onClick={() => { setMenuOpen(false); logout(); }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14 }}>⏻</span> Sign out
                      </span>
                    </button>
                  </>
                ) : (
                  <>
                    <button className="account-menu-back" onClick={() => setMenuView("menu")}>‹ Back</button>
                    <div style={{ position: "relative", padding: "0 4px 8px" }}>
                      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}>
                        <NavIcon name="search" size={13} />
                      </span>
                      <input
                        autoFocus
                        className="input"
                        style={{ width: "100%", paddingLeft: 30 }}
                        placeholder="Search…"
                        value={switchQ}
                        onChange={(e) => setSwitchQ(e.target.value)}
                      />
                    </div>
                    <div style={{ maxHeight: 260, overflowY: "auto" }}>
                      {users
                        .filter((usr) => !switchQ.trim() || usr.name.toLowerCase().includes(switchQ.trim().toLowerCase()))
                        .map((usr) => {
                          const active = usr.id === currentUserId;
                          return (
                            <button
                              key={usr.id}
                              className="account-menu-row"
                              onClick={() => { setCurrentUserId(usr.id); setMenuView("menu"); setMenuOpen(false); }}
                            >
                              <span style={{ color: active ? "var(--theme-primary)" : "var(--text-main)", fontWeight: active ? 800 : 600 }}>
                                {usr.name} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>— {ROLES[usr.role]?.name || usr.role}</span>
                              </span>
                              {active && <span style={{ color: "var(--theme-primary)", flexShrink: 0 }}><NavIcon name="check" size={14} /></span>}
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

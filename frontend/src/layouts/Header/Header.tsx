import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../../context/AppContext";
import { ROLES } from "../../services/config";
import { coll } from "../../shared/rules";
import NavIcon from "../../components/NavIcon";
import "./Header.css";

// Which admin id this browser is currently impersonating-someone-else
// from — set only when U-ADMIN switches to another account, cleared once
// back on U-ADMIN (or signed out). Lets "Back to Admin" show up for
// whichever account is active mid-impersonation, without ever showing it
// for an ordinary (non-admin-originated) session.
const IMPERSONATE_KEY = "neoteric_impersonating_from";

export default function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { data, currentUserId, setCurrentUserId, me, logout } = useApp();
  const [dark, setDark] = useState(() => localStorage.getItem("neoteric_theme") === "dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"menu" | "switch">("menu");
  const [switchQ, setSwitchQ] = useState("");
  const [impersonatingFrom, setImpersonatingFrom] = useState<string | null>(() => {
    try { return localStorage.getItem(IMPERSONATE_KEY); } catch { return null; }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function switchTo(usr: { id: string }, fromAdminId?: string) {
    if (fromAdminId) {
      try { localStorage.setItem(IMPERSONATE_KEY, fromAdminId); } catch {}
      setImpersonatingFrom(fromAdminId);
    } else if (usr.id === impersonatingFrom) {
      try { localStorage.removeItem(IMPERSONATE_KEY); } catch {}
      setImpersonatingFrom(null);
    }
    setCurrentUserId(usr.id);
    setMenuView("menu");
    setMenuOpen(false);
  }

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
          <button type="button" className="btn-icon menu-btn" onClick={onToggleSidebar} title="Menu">☰</button>
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
          <button type="button" className="btn-icon" onClick={toggleTheme} title="Toggle theme">{dark ? "☾" : "☀"}</button>
          <div className="account-wrap">
            <button type="button" className="account-btn" ref={btnRef} onClick={() => setMenuOpen((o) => !o)}>
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
                      <button
                        type="button"
                        className="account-menu-row"
                        onClick={(e) => { e.stopPropagation(); setMenuView("switch"); }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <NavIcon name="switchAccount" size={14} /> Switch Account
                        </span>
                        <span style={{ color: "var(--theme-primary)", fontWeight: 800 }}>›</span>
                      </button>
                    )}
                    {/* Only shows mid-impersonation (U-ADMIN switched to this
                        account) — never for an ordinary, non-admin-originated
                        session, so only Admin ever gets a way back. */}
                    {u?.id !== "U-ADMIN" && impersonatingFrom && (
                      <button
                        type="button"
                        className="account-menu-row"
                        onClick={() => switchTo({ id: impersonatingFrom })}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <NavIcon name="switchAccount" size={14} /> Back to Admin
                        </span>
                      </button>
                    )}
                    <button type="button" className="account-menu-row danger" onClick={() => { try { localStorage.removeItem(IMPERSONATE_KEY); } catch {} setMenuOpen(false); logout(); }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <NavIcon name="logout" size={14} /> Sign out
                      </span>
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="account-menu-back" onClick={() => setMenuView("menu")}>‹ Back</button>
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
                              type="button"
                              key={usr.id}
                              className="account-menu-row"
                              onClick={() => switchTo(usr, u?.id === "U-ADMIN" && usr.id !== "U-ADMIN" ? "U-ADMIN" : undefined)}
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

import React from "react";
import { useApp } from "../context/AppContext";
import { coll, myAssignments, myReleases } from "../lib/rules";
import NavIcon from "./NavIcon";
import type { TabKey } from "../types";

interface NavItem { key: TabKey; icon: string; label: string; badge?: number }

export default function Sidebar({ open, collapsed, onNavigate }: { open: boolean; collapsed: boolean; onNavigate: () => void }) {
  const { activeTab, setActiveTab, data, currentUserId, currentProjectId } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";

  const workBadge =
    myAssignments(data, currentProjectId, currentUserId).length + myReleases(data, currentProjectId, currentUserId).length;
  const snagBadge = coll(data, "snags").filter((s) => s.status !== "Closed" && s.projectId === currentProjectId).length;

  const groups: { label: string; items: NavItem[] }[] = [
    { label: "Overview", items: [{ key: "dash", icon: "dashboard", label: "Dashboard" }] },
    {
      label: "Execution",
      items: [
        { key: "work", icon: "work", label: "My Work", badge: workBadge },
        { key: "board", icon: "board", label: "Tower Board" },
        { key: "snags", icon: "snags", label: "Snags", badge: snagBadge },
        ...(isAdmin ? [{ key: "team" as TabKey, icon: "team", label: "Team" }] : []),
        { key: "dpr", icon: "dpr", label: "Daily Progress Report" },
        { key: "drawingRequests", icon: "drawing", label: "Drawing Requests" }
      ]
    },
    { label: "Administration", items: [{ key: "masters", icon: "masters", label: "Masters" }] }
  ];

  return (
    <aside
      id="sidebar"
      className={"sidebar" + (open ? " open" : "") + (collapsed ? " collapsed" : "")}
      style={{
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        className="sidebar-inner"
        style={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        {/* ── Logo / Brand ── */}
        <div style={{ padding: collapsed ? "20px 12px 16px" : "20px 18px 16px", borderBottom: "1px solid var(--nx-sidebar-logo-border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                background: "#fff",
                border: "1px solid var(--nx-sidebar-logo-border)",
                borderRadius: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(255,122,0,0.2)",
                flexShrink: 0,
                padding: 6,
              }}
            >
              {/* Assumption: same shared logo asset as the ERP sidebar. Swap back to the
                  "N" text mark (className="brand-logo") if this app has its own asset. */}
              <img src="/neoteric-logo.png" alt="Neoteric" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            {!collapsed && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--nx-sidebar-brand-color)", lineHeight: 1.2, whiteSpace: "nowrap" }}>
                  NEOTERIC GROUP
                </div>
                <div style={{ fontSize: 10.5, color: "var(--nx-sidebar-sub-color)", marginTop: 2, lineHeight: 1.2, whiteSpace: "nowrap" }}>
                  QUALITY &amp; HANDOFF
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Nav Groups — scrolls on its own so the collapse toggle below
            always stays visible, even with a long nav list. ── */}
        <nav style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 0 10px" }}>
          {groups.map((g, gi) => (
            <div key={g.label} style={{ marginTop: gi === 0 ? 4 : 0 }}>
              {!collapsed && (
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "var(--nx-sidebar-group-color)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: gi === 0 ? "12px 20px 6px" : "20px 20px 6px",
                  }}
                >
                  {g.label}
                </div>
              )}

              {g.items.map((it) => {
                const isActive = activeTab === it.key;
                return (
                  <button
                    key={it.key}
                    onClick={() => { setActiveTab(it.key); onNavigate(); }}
                    className={"nx-nav-item" + (isActive ? " nx-nav-item--active" : "")}
                    title={collapsed ? it.label : undefined}
                    style={{
                      width: "100%",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      font: "inherit",
                      justifyContent: collapsed ? "center" : "flex-start",
                    }}
                  >
                    <span className="nx-nav-icon"><NavIcon name={it.icon} size={collapsed ? 20 : 17} /></span>
                    {!collapsed && (
                      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                        {it.badge != null && it.badge > 0 && (
                          <span
                            style={{
                              minWidth: 16,
                              height: 16,
                              padding: "0 4px",
                              borderRadius: 8,
                              background: "var(--nx-orange)",
                              color: "#fff",
                              fontSize: 10,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {it.badge}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
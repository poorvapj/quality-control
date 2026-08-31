import React from "react";
import { useApp } from "../context/AppContext";
import { coll, myAssignments, myReleases } from "../lib/rules";
import NavIcon from "./NavIcon";
import type { TabKey } from "../types";

interface NavItem { key: TabKey; icon: string; label: string; badge?: number }

export default function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { activeTab, setActiveTab, data, currentUserId, currentProjectId } = useApp();

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
        { key: "team", icon: "team", label: "Team" },
        { key: "dpr", icon: "dpr", label: "Daily Progress Report" },
        { key: "drawingRequests", icon: "drawing", label: "Drawing Requests" }
      ]
    },
    { label: "Administration", items: [{ key: "masters", icon: "masters", label: "Masters" }] }
  ];

  return (
    <aside
      id="sidebar"
      className={"sidebar" + (open ? " open" : "")}
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
        <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid var(--nx-sidebar-logo-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--nx-sidebar-brand-color)", lineHeight: 1.2, whiteSpace: "nowrap" }}>
                NEOTERIC GROUP
              </div>
              <div style={{ fontSize: 10.5, color: "var(--nx-sidebar-sub-color)", marginTop: 2, lineHeight: 1.2, whiteSpace: "nowrap" }}>
                QUALITY &amp; HANDOFF
              </div>
            </div>
          </div>
        </div>

        {/* ── Nav Groups ── */}
        <nav style={{ flex: 1, padding: "6px 0 10px" }}>
          {groups.map((g, gi) => (
            <div key={g.label} style={{ marginTop: gi === 0 ? 4 : 0 }}>
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

              {g.items.map((it) => {
                const isActive = activeTab === it.key;
                return (
                  <button
                    key={it.key}
                    onClick={() => { setActiveTab(it.key); onNavigate(); }}
                    className={"nx-nav-item" + (isActive ? " nx-nav-item--active" : "")}
                    style={{
                      width: "100%",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      font: "inherit",
                    }}
                  >
                    <span className="nx-nav-icon"><NavIcon name={it.icon} /></span>
                    <span style={{ flex: 1 }}>{it.label}</span>
                    {it.badge != null && it.badge > 0 && (
                      <span
                        style={{
                          minWidth: 18,
                          height: 18,
                          padding: "0 5px",
                          borderRadius: 9,
                          background: "var(--nx-orange)",
                          color: "#fff",
                          fontSize: 11,
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
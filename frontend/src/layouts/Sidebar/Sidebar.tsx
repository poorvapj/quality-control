import React, { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import { coll, myAssignments, myReleases } from "../../shared/rules";
import { canAccessTab } from "../../shared/permissionMatrix";
import NavIcon from "../../components/NavIcon";
import type { TabKey } from "../../types";
import "./Sidebar.css";

interface NavItem { key: TabKey; icon: string; label: string; badge?: number; children?: NavItem[] }

export default function Sidebar({ open, collapsed: collapsedProp, onNavigate }: { open: boolean; collapsed: boolean; onNavigate: () => void }) {
  const { activeTab, setActiveTab, data, currentUserId, currentProjectId, myRole } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  // One question for every item — the Permission Matrix decides (same
  // function the page router uses), so the menu and the pages can't disagree.
  const can = (tab: TabKey) => canAccessTab(data, currentUserId, tab);

  // Icon-only collapse only ever makes sense on desktop. A stale
  // collapsed=true from localStorage (e.g. set on desktop, then this page
  // loads on a phone) must never hide labels here — check the real
  // viewport directly rather than trusting the prop alone.
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 960px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 960px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const collapsed = collapsedProp && !isMobile;
  const [handoverOpen, setHandoverOpen] = useState(activeTab === "handoverInternal" || activeTab === "handoverOwner");

  const workBadge =
    myAssignments(data, currentProjectId, currentUserId).length + myReleases(data, currentProjectId, currentUserId).length;
  const snagBadge = coll(data, "snags").filter((s) => s.status !== "Closed" && s.projectId === currentProjectId).length;

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "Overview",
      items: [
        ...(can("dash") ? [{ key: "dash" as TabKey, icon: "dashboard", label: "Dashboard" }] : []),
        ...(can("userMis") ? [{ key: "userMis" as TabKey, icon: "trend", label: "Users MIS" }] : []),
        // Cross-project VMS execution/billing reconciliation — admin-only,
        // same reasoning as Quality MIS (management-level financial data,
        // not additively grantable via Permission Matrix).
        ...(can("executionReconciliation") ? [{ key: "executionReconciliation" as TabKey, icon: "database", label: "Execution Reconciliation" }] : [])
      ]
    },
    {
      label: "Execution",
      items: [
        ...(can("work") ? [{ key: "work" as TabKey, icon: "work", label: "My Work", badge: workBadge }] : []),
        ...(can("board") ? [{ key: "board" as TabKey, icon: "board", label: "Tower Board" }] : []),
        // Hidden when an admin switched "view" off for the user/role in the
        // Permission Matrix (Internal and Owner Possession are separate rows).
        ...((can("handoverInternal") || can("handoverOwner")) ? [{
          key: (can("handoverInternal") ? "handoverInternal" : "handoverOwner") as TabKey, icon: "handover", label: "Handover Checklist",
          children: [
            ...(can("handoverInternal") ? [{ key: "handoverInternal" as TabKey, icon: "handover", label: "Internal Possession" }] : []),
            ...(can("handoverOwner") ? [{ key: "handoverOwner" as TabKey, icon: "handover", label: "Owner Possession" }] : [])
          ]
        }] : []),
        ...(can("snags") ? [{ key: "snags" as TabKey, icon: "snags", label: "Snags", badge: snagBadge }] : []),
        ...(can("team") ? [{ key: "team" as TabKey, icon: "team", label: "Team" }] : []),
        ...(can("dpr") ? [{ key: "dpr" as TabKey, icon: "dpr", label: "Daily Progress Report" }] : []),
        ...(can("drawingRequests") ? [{ key: "drawingRequests" as TabKey, icon: "drawing", label: "Drawing Requests" }] : []),
        ...(can("qualityInspection") ? [{ key: "qualityInspection" as TabKey, icon: "eye", label: "Quality Inspection" }] : []),
        ...(can("execution") ? [{ key: "execution" as TabKey, icon: "execution", label: "Execution" }] : []),
        ...(can("unitExecutionWorkflow") ? [{ key: "unitExecutionWorkflow" as TabKey, icon: "layers", label: "Measurement" }] : []),
        ...(can("progressAnalysis") ? [{ key: "progressAnalysis" as TabKey, icon: "trend", label: "Progress Analysis" }] : []),
        ...(can("purchaseOrders") ? [{ key: "purchaseOrders" as TabKey, icon: "package", label: "Purchase Orders" }] : []),
        ...(can("caseStudies") ? [{ key: "caseStudies" as TabKey, icon: "award", label: "Case Studies" }] : [])
      ]
    },
    {
      label: "Administration",
      items: [
        ...(can("masters") ? [{ key: "masters" as TabKey, icon: "masters", label: "Masters" }] : []),
        ...(can("backups") ? [{ key: "backups" as TabKey, icon: "database", label: "Backups" }] : []),
        ...(can("auditLog") ? [{ key: "auditLog" as TabKey, icon: "clock", label: "Audit Logs" }] : []),
        ...(isAdmin ? [{ key: "permissionMatrix" as TabKey, icon: "permissions", label: "Permission Matrix" }] : [])
      ]
    }
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
                <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--nx-sidebar-brand-color)", lineHeight: 1.2, whiteSpace: "nowrap" }}>
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
        <nav className="sidebar-nav-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 0 10px" }}>
          {groups.filter((g) => g.items.length > 0).map((g, gi) => (
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
                const hasChildren = !!it.children?.length;
                const isActive = !hasChildren && activeTab === it.key;
                const childActive = hasChildren && it.children!.some((c) => c.key === activeTab);
                return (
                  <div key={it.key}>
                    <button
                      onClick={() => {
                        if (hasChildren) {
                          if (collapsed) { setActiveTab(it.children![0].key); onNavigate(); }
                          else setHandoverOpen((v) => !v);
                        } else {
                          setActiveTab(it.key); onNavigate();
                        }
                      }}
                      className={"nx-nav-item" + (isActive || childActive ? " nx-nav-item--active" : "")}
                      title={collapsed ? it.label : undefined}
                      style={{
                        width: "calc(100% - 20px)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        font: "inherit",
                        justifyContent: collapsed ? "center" : "flex-start",
                      }}
                    >
                      <span className="nx-nav-icon"><NavIcon name={it.icon} size={collapsed ? 16 : 14} /></span>
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
                          {isActive && (
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
                          )}
                          {hasChildren && (
                            <span style={{ transform: handoverOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0, fontSize: 10 }}>
                              ▶
                            </span>
                          )}
                        </span>
                      )}
                    </button>

                    {hasChildren && !collapsed && handoverOpen && (
                      <div>
                        {it.children!.map((c) => {
                          const cActive = activeTab === c.key;
                          return (
                            <button
                              key={c.key}
                              onClick={() => { setActiveTab(c.key); onNavigate(); }}
                              className={"nx-nav-item" + (cActive ? " nx-nav-item--active" : "")}
                              style={{
                                width: "calc(100% - 20px)",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                textAlign: "left",
                                font: "inherit",
                                paddingLeft: 40,
                              }}
                            >
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>
                                {c.label}
                              </span>
                              {cActive && (
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}

/* ===========================================================================
   Entry point — wires every module together and exposes the functions that
   inline onclick="" handlers (in index.html and in generated innerHTML)
   need on window. Behavior is unchanged from the original single app.js.
   =========================================================================== */

import { state, $, esc } from "./state/appState.js";
import { Store, wireStore } from "./services/store.js";
import { ROLES } from "./services/config.js";
import { coll, byId, me } from "./modules/helpers.js";
import { myAssignments, myReleases } from "./modules/rules.js";

import { renderDashboard } from "./pages/dashboard.js";
import { renderWork } from "./pages/myWork.js";
import { renderBoard } from "./pages/towerBoard.js";
import { renderSnags, openSnagModal, saveSnag, setSnagStatus, saveSnagAssignee, exportSnagCsv } from "./pages/snags.js";
import { renderTeam } from "./pages/team.js";
import {
  renderMasters, switchMaster, renderMasterTable, openRecordModal, addChecklistItem,
  saveRecord, deleteRecord, exportMasterCsv
} from "./pages/masters.js";

import { openDrawer, reopenDrawer, closeDrawer } from "./components/drawer.js";
import { setAssignStatus } from "./components/rows.js";

import {
  ackStage, startStage, completeStage, failStage, openChecklist, submitChecklist,
  openAssignModal, syncAssignTargets, saveAssignment
} from "./modules/actions.js";
import { capturePhoto } from "./modules/photo.js";

/* ================================================================ render */

export function renderAll() {
  if (!Store.data) return;
  renderUserBar();
  renderDashboard();
  renderWork();
  renderBoard();
  renderSnags();
  renderTeam();
  renderMasters();
  $("workBadge").innerText = myAssignments(state.currentUserId).length + myReleases(state.currentUserId).length;
  $("snagBadge").innerText = coll("snags").filter((s) => s.status !== "Closed" && s.projectId === state.currentProjectId).length;
}

function renderUserBar() {
  const users = coll("users").filter((u) => u.active !== false);
  $("userSel").innerHTML = users.map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.role)}</option>`).join("");
  $("userSel").value = state.currentUserId;

  const projects = coll("projects").filter((p) => p.active !== false);
  $("projectSel").innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("projectSel").value = state.currentProjectId;

  const u = me();
  const initials = u ? u.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "--";
  $("userAvatar").innerText = initials;
  $("roleNote").innerText = u && ROLES[u.role] ? ROLES[u.role].note : "";

  const roleLabel = u && ROLES[u.role] ? ROLES[u.role].name : (u ? u.role : "");
  $("acctName").innerText = u ? u.name : "—";
  $("acctRole").innerText = roleLabel;
  $("acctMenuName").innerText = u ? u.name : "—";
  $("acctMenuRole").innerText = roleLabel;
}

/* ================================================================= chrome */

export function switchTab(t) {
  state.activeTab = t;
  const map = { dash: "Dash", work: "Work", board: "Board", snags: "Snags", team: "Team", masters: "Masters" };
  for (const [key, suffix] of Object.entries(map)) {
    $("view" + suffix).classList.toggle("hide", key !== t);
    $("tab" + suffix).classList.toggle("active", key === t);
  }
}

export function showModal() { $("modalOverlay").classList.add("open"); $("modalShell").classList.add("open"); }
export function closeModal() { $("modalOverlay").classList.remove("open"); $("modalShell").classList.remove("open"); state.editingId = null; }

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); closeDrawer(); }
});

/* ================================================================= login
   Minimum-necessary access gate: the backend/user model has no password
   field (Masters ▸ User has no such field), so this is a real session gate
   over the existing user identity — not a fake auth layer pretending to be
   more than that. "Signed in" = a chosen, valid user + a session flag. */

const SESSION_KEY = "neoteric_session";

function showLogin() {
  $("appShell").classList.add("hide");
  $("loginScreen").classList.remove("hide");
  const users = coll("users").filter((u) => u.active !== false);
  $("loginUserSel").innerHTML = users.map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.role)}</option>`).join("");
  const savedUser = localStorage.getItem("neoteric_user");
  if (savedUser && byId("users", savedUser)) $("loginUserSel").value = savedUser;
}

function doLogin() {
  const uid = $("loginUserSel").value;
  if (!uid) return;
  state.currentUserId = uid;
  try {
    localStorage.setItem("neoteric_user", uid);
    localStorage.setItem(SESSION_KEY, "1");
  } catch {}
  bootApp();
}

function doLogout() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  $("accountMenu").classList.remove("open");
  showLogin();
}

function bootApp() {
  state.currentProjectId = state.currentProjectId || (coll("projects")[0] || {}).id;
  $("loginScreen").classList.add("hide");
  $("appShell").classList.remove("hide");
  renderAll();
}

/* =================================================================== init */

wireStore(renderAll, reopenDrawer);

(async function init() {
  $("themeToggleBtn").addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    $("themeToggleBtn").innerText = dark ? "☾" : "☀";
    try { localStorage.setItem("neoteric_theme", dark ? "dark" : "light"); } catch {}
  });
  if (localStorage.getItem("neoteric_theme") === "light") {
    document.documentElement.classList.remove("dark");
    $("themeToggleBtn").innerText = "☀";
  }

  $("loginBtn").addEventListener("click", doLogin);
  $("logoutBtn").addEventListener("click", doLogout);
  $("accountBtn").addEventListener("click", () => $("accountMenu").classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!$("accountMenu").contains(e.target) && !$("accountBtn").contains(e.target)) {
      $("accountMenu").classList.remove("open");
    }
  });

  await Store.init();

  if (!Store.data) {
    $("loginScreen").querySelector(".login-card").innerHTML =
      `<div style="font-size:15px; font-weight:800; margin-bottom:8px;">Can't reach the board</div>
       <div style="font-size:13px; color:var(--text-muted); line-height:1.6;">
         Start the backend (<code>node server.js</code> in <code>backend/</code>) so the app has data to sign in against, then reload.
       </div>`;
    return;
  }

  $("userSel").addEventListener("change", (e) => {
    state.currentUserId = e.target.value;
    try { localStorage.setItem("neoteric_user", state.currentUserId); } catch {}
    renderAll();
  });
  $("projectSel").addEventListener("change", (e) => { state.currentProjectId = e.target.value; renderAll(); });

  const savedUser = localStorage.getItem("neoteric_user");
  const sessionActive = localStorage.getItem(SESSION_KEY) === "1";
  const validUser = savedUser && byId("users", savedUser);

  state.currentProjectId = (coll("projects")[0] || {}).id;

  // TEMPORARY: login gate disabled for now (empty deployed DB was blocking
  // access entirely). Re-enable by restoring the sessionActive/validUser
  // check below — nothing else about the login screen/logic was removed.
  const LOGIN_GATE_ENABLED = false;

  if (LOGIN_GATE_ENABLED && !(sessionActive && validUser)) {
    showLogin();
  } else {
    state.currentUserId = (sessionActive && validUser) ? savedUser : (coll("users")[0] || {}).id;
    bootApp();
  }
})();

/* ===================================================== window exposition
   Everything referenced by an onclick="" / onchange="" / oninput="" string —
   either in index.html or in HTML generated by the page/component modules —
   must exist on window, since inline handlers always resolve in global scope. */
Object.assign(window, {
  switchTab, showModal, closeModal,
  openDrawer, closeDrawer,
  setAssignStatus,
  openSnagModal, saveSnag, setSnagStatus, saveSnagAssignee, exportSnagCsv,
  switchMaster, renderMasterTable, openRecordModal, addChecklistItem, saveRecord, deleteRecord, exportMasterCsv,
  ackStage, startStage, completeStage, failStage, openChecklist, submitChecklist,
  openAssignModal, syncAssignTargets, saveAssignment,
  capturePhoto,
  renderSnags,
  Store
});

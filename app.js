/* ===========================================================================
   Neoteric Tower Quality Board — client
   Everything on screen is driven by master data pulled from /api/state.
   =========================================================================== */

const ROLES = {
  DRI:  { name: "Site In-charge (DRI)",              note: "Owns the board. Runs the morning quality huddle, clears slow handoffs." },
  EXE:  { name: "Engineer — Structure & Wet Trades", note: "Columns, slab, masonry, plaster, waterproofing. Needs QC pour permits." },
  MEP:  { name: "Engineer — MEP",                    note: "AC conduits, plumbing and electrical before pour permits close." },
  FIN:  { name: "Engineer — Finishes",               note: "Putty, tiling, windows. Locked until the pre-tiling gate passes." },
  QC:   { name: "QC Engineer",                       note: "Passes/fails gates, issues pour permits. Fails need a written reason." },
  MEAS: { name: "Measurement DET (eMB)",             note: "Measures and photographs hidden work before QC gates." }
};

const SEVERITIES = ["Critical", "Major", "Minor"];
const SNAG_STATUS = ["Open", "In Progress", "Closed"];
const ASSIGN_STATUS = ["Assigned", "Accepted", "Done"];
const HOUR = 3600000;

/* --------------------------------------------------------------- masters */
/* One schema per master drives its table, its form and its CSV export. */
const MASTERS = {
  projects: {
    label: "Project", icon: "🏗️", prefix: "PRJ",
    desc: "Sites this board covers. The active project filters every other screen.",
    cols: ["code", "name", "client", "location", "floorCount", "unitsPerFloor", "targetDate", "active"],
    fields: [
      { k: "code", label: "Project code", type: "text", required: true, hint: "Short code, e.g. NTA" },
      { k: "name", label: "Project name", type: "text", required: true },
      { k: "client", label: "Client", type: "text" },
      { k: "location", label: "Location", type: "text" },
      { k: "floorCount", label: "Floors (planned)", type: "number" },
      { k: "unitsPerFloor", label: "Units per floor (planned)", type: "number" },
      { k: "startDate", label: "Start date", type: "date" },
      { k: "targetDate", label: "Target handover", type: "date" },
      { k: "active", label: "Active", type: "bool" }
    ]
  },
  floors: {
    label: "Floor", icon: "🧱", prefix: "FLR",
    desc: "Floors carry the RCC structure track. A floor releases its units only after curing.",
    cols: ["code", "name", "projectId", "seq", "unitCount", "active"],
    fields: [
      { k: "projectId", label: "Project", type: "ref", coll: "projects", required: true },
      { k: "code", label: "Floor code", type: "text", required: true, hint: "e.g. FL7" },
      { k: "name", label: "Floor name", type: "text", required: true },
      { k: "seq", label: "Sequence (bottom-up)", type: "number", required: true, hint: "1 = lowest. Casting is enforced bottom-up." },
      { k: "unitCount", label: "Units on this floor", type: "number" },
      { k: "active", label: "Active", type: "bool" }
    ]
  },
  units: {
    label: "Unit", icon: "🏠", prefix: "UNT",
    desc: "Flats. Each one runs the unit-track stages from Stage Mapping.",
    cols: ["code", "name", "floorId", "type", "carpetArea", "seq", "active"],
    fields: [
      { k: "projectId", label: "Project", type: "ref", coll: "projects", required: true },
      { k: "floorId", label: "Floor", type: "ref", coll: "floors", required: true },
      { k: "code", label: "Unit code", type: "text", required: true },
      { k: "name", label: "Unit name", type: "text", required: true },
      { k: "type", label: "Unit type", type: "select", options: ["1BHK", "2BHK", "3BHK", "4BHK", "Shop", "Amenity"] },
      { k: "carpetArea", label: "Carpet area (sq ft)", type: "number" },
      { k: "seq", label: "Position on floor", type: "number" },
      { k: "active", label: "Active", type: "bool" }
    ]
  },
  stages: {
    label: "Stage", icon: "📋", prefix: "STG",
    desc: "The vocabulary of work. Gates are QC hold points; hidden work needs DET measurement first.",
    cols: ["code", "name", "track", "role", "category", "seq", "isGate", "isHidden", "active"],
    fields: [
      { k: "code", label: "Stage code", type: "text", required: true },
      { k: "name", label: "Stage name", type: "text", required: true },
      { k: "track", label: "Track", type: "select", options: ["unit", "floor"], required: true, hint: "unit = flat trades · floor = RCC structure" },
      { k: "role", label: "Responsible role", type: "select", options: Object.keys(ROLES), required: true },
      { k: "category", label: "Category", type: "select", options: ["Civil", "MEP", "Wet Trade", "Finishes", "Structure", "Gate", "Permit"] },
      { k: "seq", label: "Default sequence", type: "number" },
      { k: "isGate", label: "QC gate / permit (blocks the next stage)", type: "bool" },
      { k: "isHidden", label: "Hidden work (needs DET measurement + photo)", type: "bool" },
      { k: "dwg", label: "Linked drawing", type: "text" },
      { k: "color", label: "Colour", type: "color" },
      { k: "active", label: "Active", type: "bool" }
    ]
  },
  qparams: {
    label: "Quality Parameter", icon: "🎯", prefix: "QP",
    desc: "Quality Master — what gets measured, how, and the acceptance limit.",
    cols: ["code", "name", "category", "method", "acceptance", "severity", "active"],
    fields: [
      { k: "code", label: "Parameter code", type: "text", required: true },
      { k: "name", label: "Parameter", type: "text", required: true },
      { k: "category", label: "Category", type: "select", options: ["Civil", "MEP", "Wet Trade", "Finishes", "Structure"] },
      { k: "method", label: "Inspection method", type: "text", hint: "e.g. Spirit level, Megger, 48 hr ponding" },
      { k: "acceptance", label: "Acceptance criteria", type: "text", hint: "e.g. ± 3 mm per 3 m" },
      { k: "severity", label: "Severity if failed", type: "select", options: SEVERITIES, required: true },
      { k: "active", label: "Active", type: "bool" }
    ]
  },
  checklists: {
    label: "Quality Checklist", icon: "✅", prefix: "CHK",
    desc: "Parameters grouped per gate. QC fills this in to pass a gate; failed lines raise snags automatically.",
    cols: ["code", "name", "stageId", "itemCount", "active"],
    fields: [
      { k: "code", label: "Checklist code", type: "text", required: true },
      { k: "name", label: "Checklist name", type: "text", required: true },
      { k: "stageId", label: "Runs at stage", type: "ref", coll: "stages", required: true },
      { k: "items", label: "Checklist lines", type: "items" },
      { k: "active", label: "Active", type: "bool" }
    ]
  },
  stagemap: {
    label: "Stage Mapping", icon: "🔗", prefix: "MAP",
    desc: "Which stages actually run on this project, in what order, with which checklist and SLA.",
    cols: ["stageId", "track", "seq", "predecessorId", "checklistId", "slaHours", "active"],
    fields: [
      { k: "projectId", label: "Project", type: "ref", coll: "projects", required: true },
      { k: "track", label: "Track", type: "select", options: ["unit", "floor"], required: true },
      { k: "stageId", label: "Stage", type: "ref", coll: "stages", required: true },
      { k: "seq", label: "Sequence", type: "number", required: true, hint: "Lower runs first. This is the order the board enforces." },
      { k: "predecessorId", label: "Predecessor stage", type: "ref", coll: "stages", hint: "Must be complete before this stage releases. Blank = first stage." },
      { k: "checklistId", label: "Quality checklist", type: "ref", coll: "checklists" },
      { k: "slaHours", label: "SLA (hours)", type: "number", hint: "Handoffs older than this show as slow on the dashboard." },
      { k: "active", label: "Active", type: "bool" }
    ]
  },
  users: {
    label: "User", icon: "👤", prefix: "USR",
    desc: "Everyone who can act on the board. Role decides which stages they can complete.",
    cols: ["code", "name", "role", "company", "phone", "email", "active"],
    fields: [
      { k: "name", label: "Full name", type: "text", required: true },
      { k: "role", label: "Role", type: "select", options: Object.keys(ROLES), required: true },
      { k: "company", label: "Company", type: "text" },
      { k: "phone", label: "Phone", type: "text" },
      { k: "email", label: "Email", type: "text" },
      { k: "active", label: "Active", type: "bool" }
    ]
  }
};

/* ============================================================== the store */

const Store = {
  data: null,
  rev: 0,
  mode: "connecting", // live | local | offline
  LS_KEY: "neoteric_board_v5",

  async init() {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      this.data = j.data;
      this.rev = j.rev;
      this.mode = "live";
      setInterval(() => this.poll(), 5000);
    } catch {
      // file:// or server down — fall back to a private copy on this device.
      const raw = localStorage.getItem(this.LS_KEY);
      if (raw) { try { this.data = JSON.parse(raw); } catch {} }
      this.mode = "local";
      if (!this.data) {
        this.mode = "offline";
        this.data = null;
      }
    }
    paintSync();
  },

  async poll() {
    if (this.mode !== "live") return;
    try {
      const r = await fetch("/api/rev", { cache: "no-store" });
      const j = await r.json();
      if (j.rev !== this.rev) {
        const s = await (await fetch("/api/state", { cache: "no-store" })).json();
        this.data = s.data;
        this.rev = s.rev;
        renderAll();
        if (openDrawerId) reopenDrawer();
      }
      if (this.mode !== "live") { this.mode = "live"; paintSync(); }
    } catch {
      this.mode = "offline";
      paintSync();
    }
  },

  /* Apply locally first so the UI never waits on the network, then push. */
  async apply(ops) {
    applyOpsLocal(this.data, ops);
    renderAll();
    if (this.mode === "local" || this.mode === "offline") {
      try { localStorage.setItem(this.LS_KEY, JSON.stringify(this.data)); } catch {}
      return;
    }
    try {
      const r = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops })
      });
      const j = await r.json();
      if (j.data) { this.data = j.data; this.rev = j.rev; renderAll(); }
    } catch {
      this.mode = "offline";
      paintSync();
      toast("Offline — change kept on this device only");
    }
  },

  async reset(mode) {
    if (this.mode !== "live") return toast("Reset needs the server");
    const r = await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });
    const j = await r.json();
    this.data = j.data; this.rev = j.rev;
    renderAll();
    toast(mode === "blank" ? "Blank board created" : "Demo data reloaded");
  }
};

/* Mirror of the server's op handler so optimistic updates match exactly. */
function applyOpsLocal(d, ops) {
  for (const op of ops) {
    if (op.op === "upsert") {
      const list = (d[op.coll] = d[op.coll] || []);
      const i = list.findIndex((r) => r.id === op.rec.id);
      const merged = i === -1 ? op.rec : Object.assign({}, list[i], op.rec);
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (i === -1) list.push(merged);
      else list[i] = merged;
    } else if (op.op === "delete") {
      d[op.coll] = (d[op.coll] || []).filter((r) => r.id !== op.id);
    } else if (op.op === "progress") {
      const next = Object.assign({}, d.progress[op.key] || {}, op.patch);
      for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
      d.progress[op.key] = next;
    } else if (op.op === "event") {
      d.events.unshift(op.ev);
      if (d.events.length > 5000) d.events.length = 5000;
    }
  }
}

/* ================================================================ helpers */

let currentUserId = null;
let currentProjectId = null;
let activeTab = "dash";
let activeMaster = "projects";
let openDrawerId = null;   // "unit:UNT-0101" | "floor:FLR-01" | "snag:SNG-0001" | "user:USR-02"

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const D = () => Store.data;
const coll = (name) => (Store.data && Store.data[name]) || [];
const byId = (name, id) => coll(name).find((r) => r.id === id) || null;
const me = () => byId("users", currentUserId);
const myRole = () => (me() ? me().role : "DRI");

function nextId(prefix, collName) {
  let max = 0;
  for (const r of coll(collName)) {
    const m = new RegExp("^" + prefix + "-(\\d+)$").exec(r.id || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + "-" + String(max + 1).padStart(4, "0");
}

function fmtDT(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
function ago(ts) {
  if (!ts) return "—";
  const h = (Date.now() - ts) / HOUR;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + "m ago";
  if (h < 48) return Math.round(h) + "h ago";
  return Math.round(h / 24) + "d ago";
}
function dueLabel(ts) {
  if (!ts) return { text: "No due date", cls: "mute" };
  const h = (ts - Date.now()) / HOUR;
  if (h < 0) return { text: "Overdue by " + Math.round(-h) + "h", cls: "fail" };
  if (h < 12) return { text: "Due in " + Math.round(h) + "h", cls: "gate" };
  return { text: "Due " + fmtDate(ts), cls: "mute" };
}

function toast(msg) {
  const t = $("toast");
  t.innerText = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function paintSync() {
  const p = $("syncPill");
  const map = {
    live: ["", "LIVE · SHARED"],
    local: ["local", "THIS DEVICE ONLY"],
    offline: ["off", "OFFLINE"],
    connecting: ["local", "CONNECTING"]
  };
  const [cls, text] = map[Store.mode] || map.connecting;
  p.className = "sync-pill " + cls;
  p.innerHTML = '<span class="dot"></span> ' + text;
  p.title = Store.mode === "live"
    ? "Connected to the shared board on this server. Everyone on the Network URL sees these changes."
    : "The server is not reachable, so changes stay on this device.";
}

/* Human label for any referenced record. */
function refLabel(collName, id) {
  const r = byId(collName, id);
  if (!r) return id || "—";
  if (collName === "stages") return r.name;
  if (collName === "users") return r.name;
  if (collName === "units") return r.name;
  if (collName === "floors") return r.name;
  return r.name || r.code || r.id;
}

/* ========================================================== rules engine */

const pkey = (targetId, stageId) => targetId + "::" + stageId;
const prog = (targetId, stageId) => (D().progress && D().progress[pkey(targetId, stageId)]) || {};

/* Ordered, joined stage list for a track on the active project. */
function trackStages(track) {
  return coll("stagemap")
    .filter((m) => m.projectId === currentProjectId && m.track === track && m.active !== false)
    .map((m) => ({ map: m, stage: byId("stages", m.stageId) }))
    .filter((x) => x.stage && x.stage.active !== false)
    .sort((a, b) => (a.map.seq || 0) - (b.map.seq || 0));
}

const projectFloors = () => coll("floors").filter((f) => f.projectId === currentProjectId && f.active !== false).sort((a, b) => (a.seq || 0) - (b.seq || 0));
const projectUnits = () => coll("units").filter((u) => u.projectId === currentProjectId && u.active !== false);
const floorUnits = (floorId) => projectUnits().filter((u) => u.floorId === floorId).sort((a, b) => (a.seq || 0) - (b.seq || 0));

/* A floor is castable only once the floor below it has cured. */
function floorReleased(floorId) {
  const stages = trackStages("floor");
  if (!stages.length) return true;
  const last = stages[stages.length - 1];
  return prog(floorId, last.stage.id).status === "done";
}
function floorBelow(floorId) {
  const fl = projectFloors();
  const i = fl.findIndex((f) => f.id === floorId);
  return i > 0 ? fl[i - 1] : null;
}

function openSnagsFor(unitId) {
  return coll("snags").filter((s) => s.unitId === unitId && s.status !== "Closed");
}

/* Snags raised on the structure track hang off a floor, not a flat. */
function snagTarget(s) {
  return s.unitId ? refLabel("units", s.unitId) : s.floorId ? refLabel("floors", s.floorId) : "—";
}

/*
 * Why a stage cannot be worked yet — returns null when it is open for work.
 * This is the single place the board's rules live.
 */
function blockReason(targetType, targetId, idx) {
  const track = targetType === "unit" ? "unit" : "floor";
  const list = trackStages(track);
  const cur = list[idx];
  if (!cur) return "Stage not mapped";

  if (targetType === "floor") {
    const below = floorBelow(targetId);
    if (below && !floorReleased(below.id)) {
      return "Bottom-up casting — " + below.name + " is not cured yet";
    }
  } else {
    const unit = byId("units", targetId);
    if (unit && !floorReleased(unit.floorId)) {
      return "Structure not released — " + refLabel("floors", unit.floorId) + " is still casting";
    }
  }

  // Predecessor from Stage Mapping (falls back to the previous mapped stage).
  const predId = cur.map.predecessorId || (idx > 0 ? list[idx - 1].stage.id : "");
  if (predId) {
    const pred = list.find((x) => x.stage.id === predId);
    if (pred && prog(targetId, predId).status !== "done") {
      return "Waiting on " + pred.stage.name;
    }
  }

  // Hidden work since the last gate must be measured before a gate can pass.
  if (cur.stage.isGate) {
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].stage.isGate) break;
      if (list[i].stage.isHidden && !prog(targetId, list[i].stage.id).meas) {
        return "Hidden work lock — " + list[i].stage.name + " not measured by DET";
      }
    }
    if (targetType === "unit") {
      // Only snags from this gate or an earlier stage hold it up — a snag
      // recorded against a later stage is not this gate's problem.
      const upto = new Set(list.slice(0, idx + 1).map((x) => x.stage.id));
      const open = openSnagsFor(targetId).filter((s) => !s.stageId || upto.has(s.stageId));
      if (open.length) return "Open snag" + (open.length > 1 ? "s" : "") + " on this unit (" + open.length + ")";
    }
  }
  return null;
}

function canAct(stage) {
  const r = myRole();
  return r === "DRI" || r === stage.role;
}

/* Unit roll-up used by the tower matrix and KPIs. */
function unitSummary(unitId) {
  const list = trackStages("unit");
  let done = 0, fail = false, started = false;
  for (const x of list) {
    const p = prog(unitId, x.stage.id);
    if (p.status === "done") done++;
    else if (p.status === "fail") fail = true;
    if (p.status && p.status !== "released") started = true;
  }
  const unit = byId("units", unitId);
  const locked = unit ? !floorReleased(unit.floorId) : true;
  const snags = openSnagsFor(unitId).length;
  return { done, total: list.length, fail, started, locked, snags, complete: list.length > 0 && done === list.length };
}

/* Every handoff released to somebody but not yet acknowledged. */
function slowHandoffs() {
  const out = [];
  const push = (targetType, targetId, x) => {
    const p = prog(targetId, x.stage.id);
    if (p.status === "released" && p.rel && !p.ack) {
      const sla = x.map.slaHours || 24;
      const hrs = (Date.now() - p.rel) / HOUR;
      if (hrs >= sla) out.push({ targetType, targetId, stage: x.stage, hrs, sla });
    }
  };
  for (const u of projectUnits()) trackStages("unit").forEach((x) => push("unit", u.id, x));
  for (const f of projectFloors()) trackStages("floor").forEach((x) => push("floor", f.id, x));
  return out.sort((a, b) => b.hrs - a.hrs);
}

function myAssignments(userId) {
  return coll("assignments")
    .filter((a) => a.assignedTo === userId && a.status !== "Done" && a.projectId === currentProjectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}
function mySnags(userId) {
  return coll("snags")
    .filter((s) => s.assignedTo === userId && s.status !== "Closed" && s.projectId === currentProjectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}
/* Stages released to my role that nobody has picked up. */
function myReleases(userId) {
  const u = byId("users", userId);
  if (!u) return [];
  const out = [];
  const scan = (targetType, targetId, list) => {
    list.forEach((x, i) => {
      if (x.stage.role !== u.role && u.role !== "DRI") return;
      const p = prog(targetId, x.stage.id);
      if (p.status === "done") return;
      if (p.status === "released" || p.status === "ack" || p.status === "wip" || p.status === "fail") {
        if (!blockReason(targetType, targetId, i)) out.push({ targetType, targetId, stage: x.stage, p, idx: i });
      }
    });
  };
  for (const un of projectUnits()) scan("unit", un.id, trackStages("unit"));
  for (const f of projectFloors()) scan("floor", f.id, trackStages("floor"));
  return out;
}

/* ================================================================ render */

function renderAll() {
  if (!D()) return;
  paintSync();
  renderUserBar();
  renderDashboard();
  renderWork();
  renderBoard();
  renderSnags();
  renderTeam();
  renderMasters();
  $("workBadge").innerText = myAssignments(currentUserId).length + myReleases(currentUserId).length;
  $("snagBadge").innerText = coll("snags").filter((s) => s.status !== "Closed" && s.projectId === currentProjectId).length;
}

function renderUserBar() {
  const users = coll("users").filter((u) => u.active !== false);
  $("userSel").innerHTML = users.map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.role)}</option>`).join("");
  $("userSel").value = currentUserId;

  const projects = coll("projects").filter((p) => p.active !== false);
  $("projectSel").innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("projectSel").value = currentProjectId;

  const u = me();
  $("userAvatar").innerText = u ? u.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "--";
  $("roleNote").innerText = u && ROLES[u.role] ? ROLES[u.role].note : "";
}

/* ------------------------------------------------------------ dashboard */
function renderDashboard() {
  const units = projectUnits();
  const summaries = units.map((u) => unitSummary(u.id));
  const handed = summaries.filter((s) => s.complete).length;
  const stagesTotal = summaries.reduce((a, s) => a + s.total, 0) || 1;
  const stagesDone = summaries.reduce((a, s) => a + s.done, 0);
  const pct = Math.round((stagesDone / stagesTotal) * 100);
  const openSnags = coll("snags").filter((s) => s.status !== "Closed" && s.projectId === currentProjectId);
  const critical = openSnags.filter((s) => s.severity === "Critical").length;
  const slow = slowHandoffs();
  const castFloors = projectFloors().filter((f) => floorReleased(f.id)).length;

  const stats = [
    { label: "UNITS HANDED OVER", val: handed + "/" + units.length, ok: true, icon: "🏆", foot: pct + "% of all stages complete" },
    { label: "OPEN SNAGS", val: openSnags.length, bad: openSnags.length > 0, icon: "🐞", foot: critical + " critical" },
    { label: "SLOW HANDOFFS", val: slow.length, warn: slow.length > 0, icon: "⏳", foot: "Released past SLA, not acknowledged" },
    { label: "FLOORS CURED", val: castFloors + "/" + projectFloors().length, icon: "🏢", foot: "Bottom-up casting enforced" }
  ];

  $("statsGrid").innerHTML = stats.map((s) => `
    <div class="stat-card ${s.bad ? "bad" : s.warn ? "warn" : s.ok ? "ok" : ""}">
      <div class="micro-label">${s.label}</div>
      <div class="stat-val">${s.val}</div>
      <div class="stat-foot">${esc(s.foot || "")}</div>
      <div class="stat-icon">${s.icon}</div>
    </div>`).join("");

  const myOpen = myAssignments(currentUserId).length + mySnags(currentUserId).length;

  let html = `
    <div class="section-header">
      <div class="section-title">📌 WHAT NEEDS ME</div>
      <div class="section-sub">${myOpen} open item${myOpen === 1 ? "" : "s"} for ${esc(me() ? me().name : "")}</div>
    </div>
    <div class="card">${
      myOpen === 0
        ? `<div class="empty">🎉 Nothing assigned to you right now.</div>`
        : myAssignments(currentUserId).slice(0, 4).map(assignRow).join("") + mySnags(currentUserId).slice(0, 4).map(snagRow).join("")
    }</div>`;

  if (slow.length) {
    html += `
      <div class="section-header">
        <div class="section-title">⏳ SLOW HANDOFFS</div>
        <div class="section-sub">Released to a trade but never acknowledged — these are the huddle agenda</div>
      </div>
      <div class="card">${slow.slice(0, 6).map((s) => {
        const name = s.targetType === "unit" ? refLabel("units", s.targetId) : refLabel("floors", s.targetId);
        return `<div class="qitem warn" onclick="openDrawer('${s.targetType}:${s.targetId}')">
          <div class="qitem-main">
            <div class="qitem-title">${esc(name)} · ${esc(s.stage.name)}</div>
            <div class="qitem-sub">Waiting ${Math.round(s.hrs)}h · SLA ${s.sla}h · owner role ${esc(s.stage.role)}</div>
          </div>
          <span class="badge-tag gate">${Math.round(s.hrs - s.sla)}h OVER</span>
        </div>`;
      }).join("")}</div>`;
  }

  const bySeverity = SEVERITIES.map((sev) => ({ sev, n: openSnags.filter((s) => s.severity === sev).length }));
  html += `
    <div class="section-header"><div class="section-title">📈 FLOOR PROGRESS</div></div>
    <div class="card card-pad">
      ${projectFloors().slice().reverse().map((f) => {
        const us = floorUnits(f.id);
        const s = us.map((u) => unitSummary(u.id));
        const d = s.reduce((a, x) => a + x.done, 0);
        const t = s.reduce((a, x) => a + x.total, 0) || 1;
        const p = Math.round((d / t) * 100);
        return `<div style="margin-bottom:11px;">
          <div style="display:flex; justify-content:space-between; font-size:11.5px; font-weight:700;">
            <span>${esc(f.name)} <span style="color:var(--text-sub); font-weight:600;">· ${us.length} units${floorReleased(f.id) ? "" : " · structure in progress"}</span></span>
            <span style="color:var(--text-muted);">${p}%</span>
          </div>
          <div class="workload-bar"><div class="workload-fill" style="width:${p}%; background:${p === 100 ? "var(--color-pass)" : "var(--theme-primary)"};"></div></div>
        </div>`;
      }).join("")}
      <div class="legend-bar" style="margin-top:6px;">
        ${bySeverity.map((b) => `<div class="legend-item"><span class="badge-tag ${b.sev === "Critical" ? "crit" : b.sev === "Major" ? "gate" : "mute"}">${b.n} ${b.sev}</span></div>`).join("")}
      </div>
    </div>`;

  $("dashPanels").innerHTML = html;
}

/* ------------------------------------------------------------- my work */
function assignRow(a) {
  const d = dueLabel(a.dueAt);
  const target = a.targetType === "unit" ? refLabel("units", a.targetId) : refLabel("floors", a.targetId);
  const mine = a.assignedTo === currentUserId || myRole() === "DRI";
  const actions = mine
    ? (a.status === "Assigned"
        ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); setAssignStatus('${a.id}','Accepted')">Accept</button>`
        : "") +
      `<button class="btn btn-success btn-sm" onclick="event.stopPropagation(); setAssignStatus('${a.id}','Done')">Done</button>`
    : `<span class="badge-tag mute">${esc(a.status)}</span>`;

  return `<div class="qitem ${d.cls === "fail" ? "alert" : ""}" onclick="openDrawer('${a.targetType}:${a.targetId}')">
    <div class="qitem-main">
      <div class="qitem-title">📌 ${esc(target)} · ${esc(refLabel("stages", a.stageId))}</div>
      <div class="qitem-sub">${esc(a.note || "Assigned work")} · from ${esc(refLabel("users", a.assignedBy))} ${ago(a.assignedAt)}</div>
    </div>
    <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
      <span class="badge-tag ${d.cls}">${d.text}</span>
      ${actions}
    </div>
  </div>`;
}

function setAssignStatus(id, status) {
  const a = byId("assignments", id);
  if (!a) return;
  const rec = Object.assign({}, a, { status });
  if (status === "Done") { rec.doneAt = Date.now(); rec.doneBy = currentUserId; }
  Store.apply([
    { op: "upsert", coll: "assignments", rec },
    logEvent("ASSIGN_" + status.toUpperCase(), a.targetId, a.stageId, status + " by " + refLabel("users", currentUserId))
  ]);
  if (openDrawerId) reopenDrawer();
  toast("Assignment marked " + status.toLowerCase());
}

function snagRow(s) {
  const d = dueLabel(s.dueAt);
  return `<div class="qitem ${s.severity === "Critical" ? "alert" : ""}" onclick="event.stopPropagation(); openDrawer('snag:${s.id}')">
    <div class="qitem-main">
      <div class="qitem-title">🐞 ${esc(s.title)}</div>
      <div class="qitem-sub">${esc(snagTarget(s))} · ${esc(refLabel("stages", s.stageId))} · raised by ${esc(refLabel("users", s.raisedBy))} ${ago(s.raisedAt)}</div>
    </div>
    <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
      <span class="badge-tag ${s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute"}">${esc(s.severity)}</span>
      <span class="badge-tag ${d.cls}">${d.text}</span>
    </div>
  </div>`;
}

function renderWork() {
  const asg = myAssignments(currentUserId);
  const sng = mySnags(currentUserId);
  const rel = myReleases(currentUserId);
  $("workSubtitle").innerText = `${asg.length} assigned · ${rel.length} released to your role · ${sng.length} snags on you`;

  const relHtml = rel.length ? rel.map((r) => {
    const name = r.targetType === "unit" ? refLabel("units", r.targetId) : refLabel("floors", r.targetId);
    const st = r.p.status;
    const label = st === "fail" ? "REWORK" : st === "wip" ? "IN PROGRESS" : st === "ack" ? "ACKNOWLEDGED" : "NEW RELEASE";
    return `<div class="qitem ${st === "fail" ? "alert" : ""}" onclick="openDrawer('${r.targetType}:${r.targetId}')">
      <div class="qitem-main">
        <div class="qitem-title">${esc(name)} · ${esc(r.stage.name)}</div>
        <div class="qitem-sub">Released ${ago(r.p.rel)}${r.p.note ? " · " + esc(r.p.note) : ""}</div>
      </div>
      <span class="badge-tag ${st === "fail" ? "fail" : st === "wip" ? "wip" : "gate"}">${label}</span>
    </div>`;
  }).join("") : `<div class="empty">No stages released to your role.</div>`;

  $("workPanels").innerHTML = `
    <div class="section-header"><div class="section-title">📌 ASSIGNED TO ME</div></div>
    <div class="card">${asg.length ? asg.map(assignRow).join("") : `<div class="empty">Nothing assigned to you.</div>`}</div>

    <div class="section-header"><div class="section-title">⚡ RELEASED TO MY ROLE</div></div>
    <div class="card">${relHtml}</div>

    <div class="section-header"><div class="section-title">🐞 SNAGS ON ME</div></div>
    <div class="card">${sng.length ? sng.map(snagRow).join("") : `<div class="empty">No open snags assigned to you.</div>`}</div>`;
}

/* ---------------------------------------------------------- tower board */
function renderBoard() {
  const floors = projectFloors();
  let html = "";

  for (let i = floors.length - 1; i >= 0; i--) {
    const f = floors[i];
    const fstages = trackStages("floor");
    let fdone = 0, ffail = false;
    for (const x of fstages) {
      const p = prog(f.id, x.stage.id);
      if (p.status === "done") fdone++;
      if (p.status === "fail") ffail = true;
    }
    const cured = floorReleased(f.id);
    const below = floorBelow(f.id);
    const canCast = !below || floorReleased(below.id);
    const label = cured ? "CURED ✓" : !canCast ? "LOCKED" : fdone > 0 ? "RCC " + fdone + "/" + fstages.length : "NOT STARTED";

    html += `<div class="floor-row">
      <div class="floor-label" style="${ffail ? "border-color:var(--color-fail); color:var(--color-fail);" : ""}" onclick="openDrawer('floor:${f.id}')">
        ${esc(f.code)}<br><span style="font-size:8px; opacity:0.75;">${label}</span>
      </div>
      <div class="cells-grid">`;

    for (const u of floorUnits(f.id)) {
      const s = unitSummary(u.id);
      let bg = "var(--bg-subtle)";
      if (s.locked) bg = "var(--color-locked)";
      else if (s.fail) bg = "var(--color-fail)";
      else if (s.complete) bg = "var(--color-pass)";
      else if (s.done > 0) bg = "var(--color-mep)";
      const tip = `${u.name} · ${u.type || ""} · ${s.done}/${s.total} stages${s.snags ? " · " + s.snags + " open snag(s)" : ""}`;
      html += `<div class="cell ${s.locked ? "lockedcell" : ""} ${s.fail ? "pulse" : ""}"
          style="background:${bg}" title="${esc(tip)}"
          onclick="${s.locked ? "" : `openDrawer('unit:${u.id}')`}">
        ${esc(u.seq != null ? u.seq : u.code)}${s.snags ? '<span class="snag-dot"></span>' : ""}
      </div>`;
    }
    html += `</div></div>`;
  }

  $("towerBoard").innerHTML = html || `<div class="empty">No floors yet — add them in Masters ▸ Floor.</div>`;
  $("legendBar").innerHTML = `
    <div class="legend-item"><div class="legend-box" style="background:var(--color-pass);"></div> Handed over</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--color-mep);"></div> Trades in progress</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--color-fail);"></div> QC fail / rework</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--bg-subtle); border:1px solid var(--border);"></div> Not started</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--color-locked);"></div> Structure not released</div>
    <div class="legend-item"><span class="snag-dot" style="position:static; display:inline-block;"></span> Open snag</div>`;
}

/* ---------------------------------------------------------------- snags */
function renderSnags() {
  const q = ($("snagSearch").value || "").toLowerCase();
  const fs = $("snagStatusFilter").value;
  const fv = $("snagSevFilter").value;
  const fm = $("snagMineFilter").value;

  let list = coll("snags").filter((s) => s.projectId === currentProjectId);
  if (fs) list = list.filter((s) => s.status === fs);
  if (fv) list = list.filter((s) => s.severity === fv);
  if (fm === "mine") list = list.filter((s) => s.assignedTo === currentUserId);
  if (fm === "raised") list = list.filter((s) => s.raisedBy === currentUserId);
  if (q) {
    list = list.filter((s) =>
      (s.title + " " + (s.description || "") + " " + snagTarget(s)).toLowerCase().includes(q));
  }
  list.sort((a, b) => (b.status === "Closed" ? -1 : 1) - (a.status === "Closed" ? -1 : 1) || (b.raisedAt || 0) - (a.raisedAt || 0));

  const all = coll("snags").filter((s) => s.projectId === currentProjectId);
  const open = all.filter((s) => s.status !== "Closed");
  const overdue = open.filter((s) => s.dueAt && s.dueAt < Date.now());
  $("snagSubtitle").innerText = `${open.length} open · ${overdue.length} overdue · ${all.length - open.length} closed`;

  $("snagList").innerHTML = list.length
    ? list.map((s) => {
        const d = dueLabel(s.dueAt);
        const closed = s.status === "Closed";
        return `<div class="qitem ${!closed && s.severity === "Critical" ? "alert" : ""}" onclick="openDrawer('snag:${s.id}')" style="${closed ? "opacity:0.6;" : ""}">
          <div class="qitem-main">
            <div class="qitem-title">${esc(s.id)} · ${esc(s.title)}</div>
            <div class="qitem-sub">
              ${esc(snagTarget(s))} · ${esc(refLabel("stages", s.stageId))} ·
              ${s.paramId ? esc(refLabel("qparams", s.paramId)) + " · " : ""}
              raised by ${esc(refLabel("users", s.raisedBy))} ${ago(s.raisedAt)} ·
              on ${esc(refLabel("users", s.assignedTo))}
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
            <span class="badge-tag ${s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute"}">${esc(s.severity)}</span>
            <span class="badge-tag ${closed ? "pass" : s.status === "In Progress" ? "wip" : "fail"}">${esc(s.status)}</span>
            ${closed ? "" : `<span class="badge-tag ${d.cls}">${d.text}</span>`}
          </div>
        </div>`;
      }).join("")
    : `<div class="empty">No snags match these filters.</div>`;
}

/* ----------------------------------------------------------------- team */
function renderTeam() {
  const users = coll("users").filter((u) => u.active !== false);
  const rows = users.map((u) => {
    const a = coll("assignments").filter((x) => x.assignedTo === u.id && x.status !== "Done" && x.projectId === currentProjectId);
    const s = coll("snags").filter((x) => x.assignedTo === u.id && x.status !== "Closed" && x.projectId === currentProjectId);
    const overdue = a.filter((x) => x.dueAt && x.dueAt < Date.now()).length + s.filter((x) => x.dueAt && x.dueAt < Date.now()).length;
    return { u, a: a.length, s: s.length, overdue, load: a.length + s.length };
  }).sort((x, y) => y.load - x.load);

  const max = Math.max(1, ...rows.map((r) => r.load));

  $("teamPanels").innerHTML = `
    <div class="card">${rows.map((r) => `
      <div class="qitem ${r.overdue ? "warn" : ""}" onclick="openDrawer('user:${r.u.id}')">
        <div class="qitem-main">
          <div class="qitem-title">${esc(r.u.name)} <span style="color:var(--text-sub); font-weight:600;">· ${esc(ROLES[r.u.role] ? ROLES[r.u.role].name : r.u.role)}</span></div>
          <div class="qitem-sub">${esc(r.u.company || "")}${r.u.phone ? " · " + esc(r.u.phone) : ""}</div>
          <div class="workload-bar" style="max-width:260px;"><div class="workload-fill" style="width:${(r.load / max) * 100}%; background:${r.overdue ? "var(--color-fail)" : "var(--theme-primary)"};"></div></div>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
          <span class="badge-tag mute">${r.a} work</span>
          <span class="badge-tag ${r.s ? "fail" : "mute"}">${r.s} snags</span>
          ${r.overdue ? `<span class="badge-tag gate">${r.overdue} overdue</span>` : ""}
        </div>
      </div>`).join("")}</div>`;
}

/* -------------------------------------------------------------- masters */
function renderMasters() {
  $("masterNav").innerHTML = Object.entries(MASTERS).map(([k, m]) =>
    `<button class="sub-btn ${k === activeMaster ? "active" : ""}" onclick="switchMaster('${k}')">${m.icon} ${esc(m.label)} Master</button>`
  ).join("");
  $("masterSubtitle").innerText = MASTERS[activeMaster].desc;
  $("dangerZone").innerHTML = myRole() === "DRI" ? `
    <button class="btn btn-secondary btn-sm" onclick="if(confirm('Reload the demo data? This replaces the whole board for everyone.')) Store.reset('demo')">↻ Reload demo data</button>
    <button class="btn btn-secondary btn-sm" onclick="if(confirm('Wipe everything and start from a blank board? This cannot be undone.')) Store.reset('blank')">⌫ Start blank board</button>
    <button class="btn btn-secondary btn-sm" onclick="exportSnagCsv()">⬇ Snag register CSV</button>` : "";
  renderMasterTable();
}

function switchMaster(k) { activeMaster = k; $("masterSearch").value = ""; renderMasters(); }

function masterRows() {
  const m = MASTERS[activeMaster];
  let rows = coll(activeMaster).slice();
  // Project-scoped masters only show the active project.
  if (m.fields.some((f) => f.k === "projectId")) rows = rows.filter((r) => !r.projectId || r.projectId === currentProjectId);
  const q = ($("masterSearch").value || "").toLowerCase();
  if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  return rows;
}

function cellValue(rec, key) {
  const m = MASTERS[activeMaster];
  const field = m.fields.find((f) => f.k === key);
  const v = rec[key];
  if (key === "itemCount") return (rec.items || []).length + " lines";
  if (field && field.type === "ref") return esc(refLabel(field.coll, v));
  if (field && field.type === "bool") return v === false ? `<span class="badge-tag mute">Inactive</span>` : `<span class="badge-tag pass">Active</span>`;
  if (key === "isGate" || key === "isHidden") return v ? `<span class="badge-tag gate">Yes</span>` : `<span class="badge-tag mute">No</span>`;
  if (key === "severity") return `<span class="badge-tag ${v === "Critical" ? "crit" : v === "Major" ? "gate" : "mute"}">${esc(v)}</span>`;
  if (key === "track") return `<span class="badge-tag ${v === "unit" ? "wip" : "mute"}">${v === "unit" ? "Unit" : "Floor"}</span>`;
  if (key === "role") return `<span class="badge-tag mute">${esc(v)}</span>`;
  if (v == null || v === "") return `<span style="color:var(--text-sub);">—</span>`;
  return esc(v);
}

function renderMasterTable() {
  const m = MASTERS[activeMaster];
  const rows = masterRows();
  const editable = myRole() === "DRI";
  $("masterAddBtn").style.display = editable ? "inline-flex" : "none";

  if (!rows.length) {
    $("masterTable").innerHTML = `<div class="empty">No ${esc(m.label.toLowerCase())} records yet.</div>`;
    return;
  }
  const head = m.cols.map((c) => {
    const f = m.fields.find((x) => x.k === c);
    return `<th>${esc(f ? f.label : c)}</th>`;
  }).join("") + (editable ? "<th></th>" : "");

  const body = rows.map((r) => `
    <tr>
      ${m.cols.map((c) => `<td>${cellValue(r, c)}</td>`).join("")}
      ${editable ? `<td><div class="row-actions">
        <button class="btn btn-secondary btn-sm" onclick="openRecordModal('${r.id}')">Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="deleteRecord('${r.id}')">Delete</button>
      </div></td>` : ""}
    </tr>`).join("");

  $("masterTable").innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/* ======================================================= record editing */

let editingId = null;

function openRecordModal(id) {
  const m = MASTERS[activeMaster];
  editingId = id;
  const rec = id ? byId(activeMaster, id) : {};
  $("modalSub").innerText = (id ? "EDIT " : "NEW ") + m.label.toUpperCase() + " RECORD";
  $("modalTitle").innerText = id ? (rec.name || rec.code || id) : "New " + m.label;
  $("modalBox").className = "modal-box" + (m.fields.some((f) => f.type === "items") ? " wide" : "");
  $("modalContent").innerHTML = `<div class="form-grid">${m.fields.map((f) => fieldHtml(f, rec)).join("")}</div>`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveRecord()">${id ? "Save changes" : "Create " + esc(m.label)}</button>`;
  showModal();
}

function fieldHtml(f, rec) {
  const v = rec[f.k];
  const full = f.type === "items" || f.type === "textarea" || f.k === "name" ? " full" : "";
  let inner = "";

  if (f.type === "select") {
    inner = `<select class="select" data-k="${f.k}">
      ${f.required ? "" : `<option value="">—</option>`}
      ${f.options.map((o) => `<option value="${esc(o)}" ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
    </select>`;
  } else if (f.type === "ref") {
    let opts = coll(f.coll).filter((r) => r.active !== false);
    if (f.coll === "floors" || f.coll === "units") opts = opts.filter((r) => r.projectId === currentProjectId);
    inner = `<select class="select" data-k="${f.k}">
      <option value="">—</option>
      ${opts.map((o) => `<option value="${o.id}" ${v === o.id ? "selected" : ""}>${esc(refLabel(f.coll, o.id))}</option>`).join("")}
    </select>`;
  } else if (f.type === "bool") {
    return `<div class="field${full}"><div class="check-row">
      <input type="checkbox" id="fld-${f.k}" data-k="${f.k}" ${v !== false ? "checked" : ""}>
      <label for="fld-${f.k}">${esc(f.label)}</label>
    </div></div>`;
  } else if (f.type === "textarea") {
    inner = `<textarea class="textarea" data-k="${f.k}">${esc(v || "")}</textarea>`;
  } else if (f.type === "items") {
    return `<div class="field full">
      <label>${esc(f.label)}</label>
      <div id="itemsEditor">${itemsEditorHtml(rec.items || [])}</div>
      <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="addChecklistItem()">＋ Add line</button>
    </div>`;
  } else {
    const type = f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "color" ? "color" : "text";
    inner = `<input class="input" type="${type}" data-k="${f.k}" value="${esc(v == null ? "" : v)}">`;
  }

  return `<div class="field${full}">
    <label>${esc(f.label)}${f.required ? " *" : ""}</label>
    ${inner}
    ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""}
  </div>`;
}

function itemsEditorHtml(items) {
  const params = coll("qparams").filter((p) => p.active !== false);
  if (!items.length) return `<div class="empty" style="padding:14px;">No lines yet.</div>`;
  return items.map((it, i) => `
    <div class="check-row" data-item style="gap:8px; align-items:flex-start; border-bottom:1px solid var(--border); padding:9px 0;">
      <span style="font-size:11px; font-weight:800; color:var(--text-sub); width:20px; padding-top:9px;">${i + 1}</span>
      <select class="select" data-item-param style="flex:1;">
        ${params.map((p) => `<option value="${p.id}" ${it.paramId === p.id ? "selected" : ""}>${esc(p.code)} · ${esc(p.name)}</option>`).join("")}
      </select>
      <label style="display:flex; align-items:center; gap:5px; font-size:11px; white-space:nowrap; padding-top:9px;">
        <input type="checkbox" data-item-mand ${it.mandatory !== false ? "checked" : ""}> Mandatory
      </label>
      <label style="display:flex; align-items:center; gap:5px; font-size:11px; white-space:nowrap; padding-top:9px;">
        <input type="checkbox" data-item-ev ${it.evidence ? "checked" : ""}> Photo
      </label>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="this.closest('[data-item]').remove()">✕</button>
    </div>`).join("");
}

function addChecklistItem() {
  const cur = readChecklistItems();
  cur.push({ id: "", paramId: (coll("qparams")[0] || {}).id, mandatory: true, evidence: false });
  $("itemsEditor").innerHTML = itemsEditorHtml(cur);
}

function readChecklistItems() {
  const ed = $("itemsEditor");
  if (!ed) return [];
  return Array.from(ed.querySelectorAll("[data-item]")).map((row, i) => ({
    id: (editingId || "CHK") + "-I" + String(i + 1).padStart(2, "0"),
    paramId: row.querySelector("[data-item-param]").value,
    mandatory: row.querySelector("[data-item-mand]").checked,
    evidence: row.querySelector("[data-item-ev]").checked
  }));
}

function saveRecord() {
  const m = MASTERS[activeMaster];
  const rec = editingId ? Object.assign({}, byId(activeMaster, editingId)) : { id: nextId(m.prefix, activeMaster) };

  for (const f of m.fields) {
    if (f.type === "items") { rec.items = readChecklistItems(); continue; }
    const el = $("modalContent").querySelector(`[data-k="${f.k}"]`);
    if (!el) continue;
    let v = f.type === "bool" ? el.checked : el.value;
    if (f.type === "number") v = v === "" ? null : Number(v);
    if (f.required && (v === "" || v == null)) return toast(f.label + " is required");
    rec[f.k] = v;
  }
  if (!rec.code && rec.id) rec.code = rec.id;
  if (m.fields.some((f) => f.k === "projectId") && !rec.projectId) rec.projectId = currentProjectId;

  Store.apply([{ op: "upsert", coll: activeMaster, rec }]);
  closeModal();
  toast((editingId ? "Updated " : "Created ") + (rec.name || rec.code || rec.id));
}

function deleteRecord(id) {
  const m = MASTERS[activeMaster];
  const rec = byId(activeMaster, id);
  if (!confirm(`Delete ${m.label.toLowerCase()} "${rec.name || rec.code || id}"?\n\nThis removes it for everyone on the board.`)) return;
  Store.apply([{ op: "delete", coll: activeMaster, id }]);
  toast("Deleted " + id);
}

/* ============================================================= the drawer */

function openDrawer(ref) {
  openDrawerId = ref;
  const [kind, id] = ref.split(":");
  if (kind === "unit" || kind === "floor") renderTrackDrawer(kind, id);
  else if (kind === "snag") renderSnagDrawer(id);
  else if (kind === "user") renderUserDrawer(id);
  $("overlay").classList.add("open");
  $("sheet").classList.add("open");
}
function reopenDrawer() { if (openDrawerId) openDrawer(openDrawerId); }
function closeDrawer() {
  openDrawerId = null;
  $("overlay").classList.remove("open");
  $("sheet").classList.remove("open");
}

function renderTrackDrawer(kind, id) {
  const track = kind === "unit" ? "unit" : "floor";
  const list = trackStages(track);
  const rec = byId(kind === "unit" ? "units" : "floors", id);
  if (!rec) return;

  $("sheetSub").innerText = kind === "unit"
    ? `${refLabel("floors", rec.floorId)} · ${rec.type || "Unit"}`
    : "RCC STRUCTURE TRACK";
  $("sheetTitle").innerText = rec.name;
  $("sheetFooter").classList.add("hide");

  const snags = kind === "unit" ? openSnagsFor(id) : [];
  let html = "";

  if (snags.length) {
    html += `<div class="note-box" style="margin-bottom:14px;">
      ${snags.length} open snag${snags.length > 1 ? "s" : ""} on this unit — QC gates stay blocked until they are closed.
    </div>`;
  }

  list.forEach((x, idx) => {
    const s = x.stage;
    const p = prog(id, s.id);
    const done = p.status === "done";
    const fail = p.status === "fail";
    const block = blockReason(kind, id, idx);
    const mine = canAct(s);
    const chk = x.map.checklistId ? byId("checklists", x.map.checklistId) : null;

    html += `<div class="stage-row ${block && !done ? "is-locked" : ""}">
      <div class="stage-dot" style="background:${done ? "var(--color-pass)" : fail ? "var(--color-fail)" : s.color || "var(--color-struct)"}">${done ? "✓" : fail ? "✕" : idx + 1}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:800;">${esc(s.name)}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
          ${esc(ROLES[s.role] ? ROLES[s.role].name : s.role)}${s.dwg ? " · 📐 " + esc(s.dwg) : ""}${chk ? " · ✅ " + esc(chk.name) : ""}
        </div>`;

    if (s.isHidden) {
      html += `<div style="margin-top:5px;"><span class="badge-tag ${p.meas ? "meas" : "gate"}">
        ${p.meas ? "📷 Measured " + fmtDT(p.meas) : "⚠️ Hidden work — DET measurement required"}</span></div>`;
    }

    if (p.rel || p.ack || p.start || p.at) {
      html += `<div class="stage-meta">
        ${p.rel ? "Released " + fmtDT(p.rel) + " · " : ""}${p.ack ? "Acknowledged " + fmtDT(p.ack) + " · " : ""}
        ${p.start ? "Started " + fmtDT(p.start) + " · " : ""}${p.at ? "Completed " + fmtDT(p.at) : ""}
        ${p.by ? "<br>By " + esc(refLabel("users", p.by)) : ""}
      </div>`;
    }

    if (fail && p.note) html += `<div class="note-box">Failed: ${esc(p.note)}</div>`;
    if (block && !done) html += `<div class="stage-meta" style="color:var(--color-gate); font-weight:700;">🔒 ${esc(block)}</div>`;

    html += `<div class="stage-actions">`;
    if (!block || done) {
      if (s.isHidden && !p.meas && (myRole() === "MEAS" || myRole() === "DRI")) {
        html += `<button class="btn btn-meas btn-sm" onclick="capturePhoto('${kind}','${id}','${s.id}')">📸 Measure &amp; photograph</button>`;
      }
      if (!done && mine) {
        if (p.rel && !p.ack) html += `<button class="btn btn-secondary btn-sm" onclick="ackStage('${kind}','${id}','${s.id}')">Acknowledge</button>`;
        if (!p.start) html += `<button class="btn btn-secondary btn-sm" onclick="startStage('${kind}','${id}','${s.id}')">Start work</button>`;
        if (s.isGate && chk) {
          html += `<button class="btn btn-primary btn-sm" onclick="openChecklist('${kind}','${id}','${s.id}','${chk.id}')">✅ Run checklist</button>`;
        } else {
          html += `<button class="btn btn-primary btn-sm" onclick="completeStage('${kind}','${id}','${s.id}')">${fail ? "Rework done" : "Mark complete"}</button>`;
        }
        if (s.isGate) html += `<button class="btn btn-danger btn-sm" onclick="failStage('${kind}','${id}','${s.id}')">Fail</button>`;
      }
    }
    html += `<button class="btn btn-secondary btn-sm" onclick="openAssignModal('${kind}','${id}','${s.id}')">👤 Assign</button>`;
    if (kind === "unit") html += `<button class="btn btn-secondary btn-sm" onclick="openSnagModal('${id}','${s.id}')">🐞 Snag</button>`;
    html += `</div></div></div>`;
  });

  $("sheetContent").innerHTML = html || `<div class="empty">No stages mapped for this track. Add them in Masters ▸ Stage Mapping.</div>`;
}

function renderSnagDrawer(id) {
  const s = byId("snags", id);
  if (!s) return;
  $("sheetSub").innerText = "SNAG " + s.id;
  $("sheetTitle").innerText = s.title;
  const d = dueLabel(s.dueAt);
  const closed = s.status === "Closed";

  $("sheetContent").innerHTML = `
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px;">
      <span class="badge-tag ${s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute"}">${esc(s.severity)}</span>
      <span class="badge-tag ${closed ? "pass" : s.status === "In Progress" ? "wip" : "fail"}">${esc(s.status)}</span>
      ${closed ? "" : `<span class="badge-tag ${d.cls}">${d.text}</span>`}
    </div>
    <div style="font-size:13px; line-height:1.6; margin-bottom:16px;">${esc(s.description || "No description.")}</div>
    <div class="card card-pad" style="font-size:12px; line-height:1.9;">
      <div><strong>Location</strong> · ${esc(snagTarget(s))}</div>
      <div><strong>Stage</strong> · ${esc(refLabel("stages", s.stageId))}</div>
      ${s.paramId ? `<div><strong>Parameter</strong> · ${esc(refLabel("qparams", s.paramId))}</div>` : ""}
      <div><strong>Raised by</strong> · ${esc(refLabel("users", s.raisedBy))} ${ago(s.raisedAt)}</div>
      <div><strong>Assigned to</strong> · ${esc(refLabel("users", s.assignedTo))}</div>
      ${s.closedAt ? `<div><strong>Closed</strong> · ${fmtDT(s.closedAt)} by ${esc(refLabel("users", s.closedBy))}</div>` : ""}
    </div>
    ${(s.photos || []).length ? `<div class="photo-strip">${s.photos.map((u) => `<img class="photo-thumb" src="${esc(u)}" onclick="window.open('${esc(u)}','_blank')">`).join("")}</div>` : ""}
    <div style="margin-top:16px;">
      <div class="micro-label">REASSIGN</div>
      <select class="select" id="snagAssignee">${coll("users").filter((u) => u.active !== false).map((u) => `<option value="${u.id}" ${u.id === s.assignedTo ? "selected" : ""}>${esc(u.name)} · ${esc(u.role)}</option>`).join("")}</select>
    </div>`;

  $("sheetFooter").classList.remove("hide");
  $("sheetFooter").innerHTML = `
    <button class="btn btn-secondary btn-sm" onclick="capturePhoto('snag','${s.id}','')">📸 Add photo</button>
    <button class="btn btn-secondary btn-sm" onclick="saveSnagAssignee('${s.id}')">Save assignee</button>
    ${closed
      ? `<button class="btn btn-secondary btn-sm" onclick="setSnagStatus('${s.id}','Open')">Reopen</button>`
      : `<button class="btn btn-secondary btn-sm" onclick="setSnagStatus('${s.id}','In Progress')">In progress</button>
         <button class="btn btn-success btn-sm" onclick="setSnagStatus('${s.id}','Closed')">Close snag</button>`}`;
}

function renderUserDrawer(id) {
  const u = byId("users", id);
  if (!u) return;
  $("sheetSub").innerText = ROLES[u.role] ? ROLES[u.role].name.toUpperCase() : u.role;
  $("sheetTitle").innerText = u.name;
  $("sheetFooter").classList.add("hide");

  const asg = coll("assignments").filter((a) => a.assignedTo === id && a.projectId === currentProjectId && a.status !== "Done");
  const sng = coll("snags").filter((s) => s.assignedTo === id && s.projectId === currentProjectId && s.status !== "Closed");

  $("sheetContent").innerHTML = `
    <div class="card card-pad" style="font-size:12px; line-height:1.9; margin-bottom:16px;">
      <div><strong>Company</strong> · ${esc(u.company || "—")}</div>
      <div><strong>Phone</strong> · ${esc(u.phone || "—")}</div>
      <div><strong>Email</strong> · ${esc(u.email || "—")}</div>
    </div>
    <div class="micro-label">OPEN ASSIGNMENTS (${asg.length})</div>
    <div class="card" style="margin-bottom:16px;">${asg.length ? asg.map(assignRow).join("") : `<div class="empty">None.</div>`}</div>
    <div class="micro-label">OPEN SNAGS (${sng.length})</div>
    <div class="card">${sng.length ? sng.map(snagRow).join("") : `<div class="empty">None.</div>`}</div>
    <button class="btn btn-primary btn-sm" style="margin-top:16px;" onclick="openAssignModal('','','', '${id}')">＋ Assign work to ${esc(u.name.split(" ")[0])}</button>`;
}

/* ============================================================== actions */

function logEvent(action, targetId, stageId, detail) {
  return { op: "event", ev: { ts: Date.now(), userId: currentUserId, action, targetId, stageId, detail } };
}

function ackStage(kind, id, stageId) {
  Store.apply([
    { op: "progress", key: pkey(id, stageId), patch: { status: "ack", ack: Date.now(), by: currentUserId } },
    logEvent("ACK", id, stageId, "Acknowledged release")
  ]);
  reopenDrawer();
  toast("Release acknowledged");
}

function startStage(kind, id, stageId) {
  const p = prog(id, stageId);
  Store.apply([
    { op: "progress", key: pkey(id, stageId), patch: { status: "wip", ack: p.ack || Date.now(), start: Date.now(), by: currentUserId } },
    logEvent("START", id, stageId, "Work started")
  ]);
  reopenDrawer();
  toast("Work started");
}

/* Completing a stage releases the next one — that is the handoff. */
function releaseNextOps(kind, id, stageId) {
  const track = kind === "unit" ? "unit" : "floor";
  const list = trackStages(track);
  const i = list.findIndex((x) => x.stage.id === stageId);
  if (i === -1 || i + 1 >= list.length) return [];
  const nxt = list[i + 1].stage;
  if (prog(id, nxt.id).status) return [];
  return [{ op: "progress", key: pkey(id, nxt.id), patch: { status: "released", rel: Date.now() } }];
}

function completeStage(kind, id, stageId) {
  const ops = [
    { op: "progress", key: pkey(id, stageId), patch: { status: "done", at: Date.now(), by: currentUserId, note: null } },
    logEvent("COMPLETE", id, stageId, "Stage completed")
  ].concat(releaseNextOps(kind, id, stageId));
  Store.apply(ops);
  reopenDrawer();
  toast("Completed · next stage released");
}

function failStage(kind, id, stageId) {
  const reason = prompt("QC failure reason (mandatory):");
  if (!reason) return;
  Store.apply([
    { op: "progress", key: pkey(id, stageId), patch: { status: "fail", at: Date.now(), by: currentUserId, note: reason } },
    logEvent("QC_FAIL", id, stageId, reason)
  ]);
  reopenDrawer();
  toast("Gate failed — raise a snag to track the rework");
  if (kind === "unit") openSnagModal(id, stageId, reason);
}

/* ------------------------------------------------------ gate checklist */
let checklistCtx = null;

function openChecklist(kind, id, stageId, checklistId) {
  const chk = byId("checklists", checklistId);
  if (!chk) return;
  checklistCtx = { kind, id, stageId, checklistId };
  $("modalBox").className = "modal-box wide";
  $("modalSub").innerText = "QUALITY CHECKLIST · " + refLabel(kind === "unit" ? "units" : "floors", id);
  $("modalTitle").innerText = chk.name;
  $("modalContent").innerHTML = `
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:14px; line-height:1.6;">
      Mark each parameter. Any failed line raises a snag automatically and fails the gate.
    </div>
    ${(chk.items || []).map((it, i) => {
      const p = byId("qparams", it.paramId);
      if (!p) return "";
      return `<div style="border-bottom:1px solid var(--border); padding:12px 0;" data-chk data-param="${p.id}">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-size:13px; font-weight:800;">${i + 1}. ${esc(p.name)}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:3px; line-height:1.5;">
              ${esc(p.method || "")}${p.acceptance ? " · Accept: " + esc(p.acceptance) : ""}
            </div>
          </div>
          <span class="badge-tag ${p.severity === "Critical" ? "crit" : p.severity === "Major" ? "gate" : "mute"}">${esc(p.severity)}</span>
        </div>
        <div style="display:flex; gap:6px; margin-top:9px; flex-wrap:wrap;">
          <label class="btn btn-secondary btn-sm"><input type="radio" name="chk${i}" value="pass" data-res checked style="margin-right:5px;">Pass</label>
          <label class="btn btn-secondary btn-sm"><input type="radio" name="chk${i}" value="fail" data-res style="margin-right:5px;">Fail</label>
          ${it.mandatory === false ? `<label class="btn btn-secondary btn-sm"><input type="radio" name="chk${i}" value="na" data-res style="margin-right:5px;">N/A</label>` : ""}
          <input class="input" data-remark placeholder="Observation / remark" style="flex:1; min-width:150px;">
        </div>
      </div>`;
    }).join("")}`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="submitChecklist()">Submit checklist</button>`;
  showModal();
}

function submitChecklist() {
  const rows = Array.from($("modalContent").querySelectorAll("[data-chk]"));
  const results = rows.map((r) => ({
    paramId: r.dataset.param,
    result: (r.querySelector("[data-res]:checked") || {}).value || "pass",
    remark: r.querySelector("[data-remark]").value.trim()
  }));
  const failed = results.filter((r) => r.result === "fail");
  const { kind, id, stageId, checklistId } = checklistCtx;
  const now = Date.now();

  if (!failed.length) {
    const ops = [
      { op: "progress", key: pkey(id, stageId), patch: { status: "done", at: now, by: currentUserId, note: null, checklistId, checklist: results } },
      logEvent("QC_PASS", id, stageId, "Checklist passed (" + results.length + " lines)")
    ].concat(releaseNextOps(kind, id, stageId));
    Store.apply(ops);
    closeModal();
    reopenDrawer();
    return toast("Gate passed · next stage released");
  }

  // Failed lines become snags, assigned to whoever owns that trade.
  const stage = byId("stages", stageId);
  const owner = coll("users").find((u) => u.role === stage.role && u.active !== false) || me();
  const ops = [
    { op: "progress", key: pkey(id, stageId), patch: { status: "fail", at: now, by: currentUserId, checklistId, checklist: results, note: failed.length + " parameter(s) failed" } },
    logEvent("QC_FAIL", id, stageId, failed.length + " parameter(s) failed")
  ];
  let n = 0;
  for (const f of failed) {
    const p = byId("qparams", f.paramId);
    ops.push({
      op: "upsert", coll: "snags",
      rec: {
        id: nextId("SNG", "snags").replace(/(\d+)$/, (m) => String(parseInt(m, 10) + n++).padStart(4, "0")),
        projectId: currentProjectId,
        unitId: kind === "unit" ? id : "",
        stageId, paramId: f.paramId,
        title: p.name + " failed at " + stage.name,
        description: f.remark || (p.name + " outside acceptance criteria (" + (p.acceptance || "as per spec") + ")."),
        severity: p.severity || "Major",
        status: "Open",
        raisedBy: currentUserId, raisedAt: now,
        assignedTo: owner ? owner.id : currentUserId,
        dueAt: now + (p.severity === "Critical" ? 24 : 72) * HOUR,
        photos: [], comments: []
      }
    });
  }
  Store.apply(ops);
  closeModal();
  reopenDrawer();
  toast(failed.length + " snag(s) raised · gate failed");
}

/* ------------------------------------------------------------- assign */
function openAssignModal(kind, targetId, stageId, presetUser) {
  const units = projectUnits(), floors = projectFloors();
  $("modalBox").className = "modal-box";
  $("modalSub").innerText = "ASSIGN WORK";
  $("modalTitle").innerText = "Assign to a team member";
  const dueDefault = new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 16);

  $("modalContent").innerHTML = `<div class="form-grid">
    <div class="field">
      <label>Target type</label>
      <select class="select" id="asgType" onchange="syncAssignTargets()">
        <option value="unit" ${kind !== "floor" ? "selected" : ""}>Unit / Flat</option>
        <option value="floor" ${kind === "floor" ? "selected" : ""}>Floor / Structure</option>
      </select>
    </div>
    <div class="field"><label>Target</label><select class="select" id="asgTarget"></select></div>
    <div class="field"><label>Stage</label><select class="select" id="asgStage"></select></div>
    <div class="field">
      <label>Assign to *</label>
      <select class="select" id="asgUser">
        ${coll("users").filter((u) => u.active !== false).map((u) => `<option value="${u.id}" ${u.id === presetUser ? "selected" : ""}>${esc(u.name)} · ${esc(u.role)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Due by</label><input class="input" type="datetime-local" id="asgDue" value="${dueDefault}"></div>
    <div class="field full"><label>Instruction</label><textarea class="textarea" id="asgNote" placeholder="What exactly needs doing, and any constraint the person should know."></textarea></div>
  </div>`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveAssignment()">Assign work</button>`;
  showModal();
  syncAssignTargets(targetId, stageId);
}

function syncAssignTargets(presetTarget, presetStage) {
  const type = $("asgType").value;
  const targets = type === "unit" ? projectUnits() : projectFloors();
  $("asgTarget").innerHTML = targets.map((t) => `<option value="${t.id}" ${t.id === presetTarget ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const stages = trackStages(type);
  $("asgStage").innerHTML = stages.map((x) => `<option value="${x.stage.id}" ${x.stage.id === presetStage ? "selected" : ""}>${esc(x.stage.name)}</option>`).join("");
}

function saveAssignment() {
  const rec = {
    id: nextId("ASG", "assignments"),
    projectId: currentProjectId,
    targetType: $("asgType").value,
    targetId: $("asgTarget").value,
    stageId: $("asgStage").value,
    assignedTo: $("asgUser").value,
    assignedBy: currentUserId,
    assignedAt: Date.now(),
    dueAt: $("asgDue").value ? new Date($("asgDue").value).getTime() : null,
    status: "Assigned",
    note: $("asgNote").value.trim()
  };
  if (!rec.targetId) return toast("Pick a target first");
  Store.apply([
    { op: "upsert", coll: "assignments", rec },
    logEvent("ASSIGN", rec.targetId, rec.stageId, "Assigned to " + refLabel("users", rec.assignedTo))
  ]);
  closeModal();
  toast("Assigned to " + refLabel("users", rec.assignedTo));
}

/* --------------------------------------------------------------- snags */
function openSnagModal(unitId, stageId, preset) {
  $("modalBox").className = "modal-box";
  $("modalSub").innerText = "RAISE SNAG";
  $("modalTitle").innerText = "New snag";
  const dueDefault = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 16);

  $("modalContent").innerHTML = `<div class="form-grid">
    <div class="field full"><label>Title *</label><input class="input" id="sngTitle" value="${esc(preset || "")}" placeholder="Short, specific: what is wrong and where"></div>
    <div class="field"><label>Unit *</label><select class="select" id="sngUnit">${projectUnits().map((u) => `<option value="${u.id}" ${u.id === unitId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Stage</label><select class="select" id="sngStage">${trackStages("unit").map((x) => `<option value="${x.stage.id}" ${x.stage.id === stageId ? "selected" : ""}>${esc(x.stage.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Quality parameter</label><select class="select" id="sngParam"><option value="">—</option>${coll("qparams").filter((p) => p.active !== false).map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Severity *</label><select class="select" id="sngSev">${SEVERITIES.map((s) => `<option value="${s}" ${s === "Major" ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="field"><label>Assign to *</label><select class="select" id="sngUser">${coll("users").filter((u) => u.active !== false).map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.role)}</option>`).join("")}</select></div>
    <div class="field"><label>Due by</label><input class="input" type="datetime-local" id="sngDue" value="${dueDefault}"></div>
    <div class="field full"><label>Description</label><textarea class="textarea" id="sngDesc" placeholder="Extent, location within the unit, and what rectification is expected."></textarea></div>
  </div>`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveSnag()">Raise snag</button>`;
  showModal();
}

function saveSnag() {
  const title = $("sngTitle").value.trim();
  if (!title) return toast("Give the snag a title");
  const rec = {
    id: nextId("SNG", "snags"),
    projectId: currentProjectId,
    unitId: $("sngUnit").value,
    stageId: $("sngStage").value,
    paramId: $("sngParam").value,
    title,
    description: $("sngDesc").value.trim(),
    severity: $("sngSev").value,
    status: "Open",
    raisedBy: currentUserId,
    raisedAt: Date.now(),
    assignedTo: $("sngUser").value,
    dueAt: $("sngDue").value ? new Date($("sngDue").value).getTime() : null,
    photos: [], comments: []
  };
  Store.apply([
    { op: "upsert", coll: "snags", rec },
    logEvent("SNAG_RAISE", rec.unitId, rec.stageId, title)
  ]);
  closeModal();
  toast("Snag " + rec.id + " raised");
}

function setSnagStatus(id, status) {
  const s = byId("snags", id);
  const patch = Object.assign({}, s, { status });
  if (status === "Closed") { patch.closedAt = Date.now(); patch.closedBy = currentUserId; }
  else { patch.closedAt = null; patch.closedBy = null; } // null clears on merge
  Store.apply([
    { op: "upsert", coll: "snags", rec: patch },
    logEvent("SNAG_" + status.toUpperCase().replace(" ", "_"), s.unitId, s.stageId, s.title)
  ]);
  reopenDrawer();
  toast("Snag " + status.toLowerCase());
}

function saveSnagAssignee(id) {
  const s = byId("snags", id);
  const to = $("snagAssignee").value;
  Store.apply([
    { op: "upsert", coll: "snags", rec: Object.assign({}, s, { assignedTo: to }) },
    logEvent("SNAG_REASSIGN", s.unitId, s.stageId, "to " + refLabel("users", to))
  ]);
  reopenDrawer();
  toast("Reassigned to " + refLabel("users", to));
}

/* --------------------------------------------------------------- photo */
function capturePhoto(kind, id, stageId) {
  const input = $("photoInput");
  input.value = "";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    toast("Processing photo…");
    const dataUrl = await watermark(file, kind === "snag" ? refLabel("snags", id) : refLabel(kind === "unit" ? "units" : "floors", id));
    let url = dataUrl;
    if (Store.mode === "live") {
      try {
        const r = await fetch("/api/photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl })
        });
        const j = await r.json();
        if (j.url) url = j.url;
      } catch {}
    }
    if (kind === "snag") {
      const s = byId("snags", id);
      Store.apply([{ op: "upsert", coll: "snags", rec: Object.assign({}, s, { photos: (s.photos || []).concat([url]) }) }]);
    } else {
      Store.apply([
        { op: "progress", key: pkey(id, stageId), patch: { meas: Date.now(), measBy: currentUserId, photo: url } },
        logEvent("MEASURE", id, stageId, "Hidden work measured and photographed")
      ]);
    }
    reopenDrawer();
    toast("Photo attached");
  };
  input.click();
}

/* Shrink + stamp the image so the evidence carries its own context. */
function watermark(file, label) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1280;
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const pad = Math.round(c.width * 0.02);
      const fs = Math.max(12, Math.round(c.width * 0.028));
      const text = `${label} · ${new Date().toLocaleString("en-IN")} · ${me() ? me().name : ""}`;
      ctx.font = `600 ${fs}px Inter, sans-serif`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(pad, c.height - pad - fs * 1.8, w + fs, fs * 1.8);
      ctx.fillStyle = "#00ff66";
      ctx.fillText(text, pad + fs / 2, c.height - pad - fs * 0.5);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve("");
    img.src = URL.createObjectURL(file);
  });
}

/* ============================================================ CSV export */

function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => {
    const v = c == null ? "" : String(c);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Downloaded " + name);
}

function exportMasterCsv() {
  const m = MASTERS[activeMaster];
  const rows = masterRows();
  const head = m.cols.map((c) => {
    const f = m.fields.find((x) => x.k === c);
    return f ? f.label : c;
  });
  const body = rows.map((r) => m.cols.map((c) => {
    const f = m.fields.find((x) => x.k === c);
    if (c === "itemCount") return (r.items || []).length;
    if (f && f.type === "ref") return refLabel(f.coll, r[c]);
    return r[c];
  }));
  downloadCsv(activeMaster + "-master.csv", [head].concat(body));
}

function exportSnagCsv() {
  const head = ["Snag ID", "Unit", "Floor", "Stage", "Parameter", "Title", "Description", "Severity", "Status",
                "Raised by", "Raised at", "Assigned to", "Due at", "Closed at", "Closed by", "Hours open"];
  const body = coll("snags").filter((s) => s.projectId === currentProjectId).map((s) => {
    const unit = byId("units", s.unitId);
    const end = s.closedAt || Date.now();
    return [
      s.id, snagTarget(s), unit ? refLabel("floors", unit.floorId) : (s.floorId ? refLabel("floors", s.floorId) : ""),
      refLabel("stages", s.stageId), s.paramId ? refLabel("qparams", s.paramId) : "",
      s.title, s.description, s.severity, s.status,
      refLabel("users", s.raisedBy), s.raisedAt ? new Date(s.raisedAt).toISOString() : "",
      refLabel("users", s.assignedTo), s.dueAt ? new Date(s.dueAt).toISOString() : "",
      s.closedAt ? new Date(s.closedAt).toISOString() : "", s.closedBy ? refLabel("users", s.closedBy) : "",
      s.raisedAt ? Math.round((end - s.raisedAt) / HOUR) : ""
    ];
  });
  downloadCsv("snag-register.csv", [head].concat(body));
}

/* ================================================================= chrome */

function switchTab(t) {
  activeTab = t;
  const map = { dash: "Dash", work: "Work", board: "Board", snags: "Snags", team: "Team", masters: "Masters" };
  for (const [key, suffix] of Object.entries(map)) {
    $("view" + suffix).classList.toggle("hide", key !== t);
    $("tab" + suffix).classList.toggle("active", key === t);
  }
}

function showModal() { $("modalOverlay").classList.add("open"); $("modalShell").classList.add("open"); }
function closeModal() { $("modalOverlay").classList.remove("open"); $("modalShell").classList.remove("open"); editingId = null; }

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); closeDrawer(); }
});

/* =================================================================== init */

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

  await Store.init();

  if (!D()) {
    document.querySelector(".wrap").innerHTML =
      `<div class="card card-pad" style="margin-top:40px; text-align:center;">
        <div style="font-size:15px; font-weight:800; margin-bottom:8px;">No board data</div>
        <div style="font-size:13px; color:var(--text-muted); line-height:1.6;">
          Start the server with <code>node server.js</code> and open
          <strong>http://localhost:5173</strong> so every device shares one board.
        </div>
      </div>`;
    return;
  }

  const savedUser = localStorage.getItem("neoteric_user");
  currentUserId = (savedUser && byId("users", savedUser)) ? savedUser : (coll("users")[0] || {}).id;
  currentProjectId = (coll("projects")[0] || {}).id;

  $("userSel").addEventListener("change", (e) => {
    currentUserId = e.target.value;
    try { localStorage.setItem("neoteric_user", currentUserId); } catch {}
    renderAll();
  });
  $("projectSel").addEventListener("change", (e) => { currentProjectId = e.target.value; renderAll(); });

  renderAll();
})();

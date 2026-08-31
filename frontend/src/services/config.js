/* ===========================================================================
   Static configuration extracted from the original app.js — unchanged.
   =========================================================================== */

export const ROLES = {
  DRI:  { name: "Site In-charge (DRI)",              note: "Owns the board. Runs the morning quality huddle, clears slow handoffs." },
  EXE:  { name: "Engineer — Structure & Wet Trades", note: "Columns, slab, masonry, plaster, waterproofing. Needs QC pour permits." },
  MEP:  { name: "Engineer — MEP",                    note: "AC conduits, plumbing and electrical before pour permits close." },
  FIN:  { name: "Engineer — Finishes",               note: "Putty, tiling, windows. Locked until the pre-tiling gate passes." },
  QC:   { name: "QC Engineer",                       note: "Passes/fails gates, issues pour permits. Fails need a written reason." },
  MEAS: { name: "Measurement DET (eMB)",             note: "Measures and photographs hidden work before QC gates." }
};

/* Set window.API_BASE (in index.html) to the backend's URL when the frontend
   is hosted separately, e.g. "https://your-app.onrender.com" on Vercel. Empty
   string keeps same-origin requests for local dev. */
export const API_BASE = (typeof window !== "undefined" && window.API_BASE) || "";

export const SEVERITIES = ["Critical", "Major", "Minor"];
export const SNAG_STATUS = ["Open", "In Progress", "Closed"];
export const ASSIGN_STATUS = ["Assigned", "Accepted", "Done"];
export const HOUR = 3600000;

/* --------------------------------------------------------------- masters */
/* One schema per master drives its table, its form and its CSV export. */
export const MASTERS = {
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

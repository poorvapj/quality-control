/*
 * Master-data definitions + demo seed for the Tower Quality Board.
 * Required by server.js. Everything the app renders comes from here or the API.
 *
 * The demo dataset is generated so that EVERY mapped stage — all 13 unit-track
 * stages and all 9 floor-track stages — has live records against it, in every
 * state the board can show: released, acknowledged, in progress, complete,
 * failed, blocked on hidden work, and blocked on an open snag.
 */

const COLLECTIONS = [
  "projects",     // Project Master
  "floors",       // Floor Master
  "units",        // Unit Master
  "stages",       // Stage Master
  "qparams",      // Quality Master  (inspection parameters)
  "checklists",   // Quality Checklist (parameters grouped per stage)
  "stagemap",     // Stage Mapping   (which stages run, in what order, per project/track)
  "users",        // User Master
  "snags",        // Snag register
  "assignments",  // Work assigned to a person
  "dpr",              // Daily Progress Report — end-of-day site logs
  "drawingRequests",  // Drawing Requests — 4-stage review/approval tickets
  "permissions"        // Per-user fine-grained permission grants (Drawing Requests review stages)
];

/* Roles are a fixed vocabulary — users and stages both point at these. */
const ROLES = {
  DRI:  { name: "Site In-charge (DRI)",              note: "Owns the board. Runs the morning quality huddle, clears slow handoffs." },
  EXE:  { name: "Engineer — Structure & Wet Trades", note: "Columns, slab, masonry, plaster, waterproofing. Needs QC pour permits." },
  MEP:  { name: "Engineer — MEP",                    note: "AC conduits, plumbing and electrical before pour permits close." },
  FIN:  { name: "Engineer — Finishes",               note: "Putty, tiling, windows. Locked until the pre-tiling gate passes." },
  QC:   { name: "QC Engineer",                       note: "Passes/fails gates, issues pour permits. Fails need a written reason." },
  MEAS: { name: "Measurement DET (eMB)",             note: "Measures and photographs hidden work before QC gates." }
};

const TRACKS = { unit: "Unit / Flat trades", floor: "Floor / RCC structure" };

function blankData() {
  const d = { rev: 1, progress: {}, events: [], createdAt: new Date().toISOString() };
  for (const c of COLLECTIONS) d[c] = [];
  return d;
}

/* Deterministic pseudo-randomness — the demo looks varied but reseeds identically. */
function makeRng(seed) {
  let s = seed || 20260817;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/* --------------------------------------------------------------- masters */

function seedStages() {
  const unit = [
    ["mas", "Brick Masonry",              "EXE",  "Civil",     false, false, "DWG-ARCH-01"],
    ["ac",  "AC Conduit",                 "MEP",  "MEP",       false, true,  "DWG-MEP-02"],
    ["plb", "Plumbing + Pressure Test",   "MEP",  "MEP",       false, true,  ""],
    ["ele", "Electrical Wiring",          "MEP",  "MEP",       false, true,  ""],
    ["g1",  "QC GATE 1 · Pre-Plaster",    "QC",   "Gate",      true,  false, ""],
    ["pls", "Plaster",                    "EXE",  "Wet Trade", false, false, ""],
    ["g2",  "QC GATE 2 · Plaster Check",  "QC",   "Gate",      true,  false, ""],
    ["put", "Putty",                      "FIN",  "Finishes",  false, false, ""],
    ["wpf", "Waterproofing + Pond Test",  "EXE",  "Wet Trade", false, true,  ""],
    ["g3",  "QC GATE 3 · Pre-Tiling",     "QC",   "Gate",      true,  false, ""],
    ["til", "Tiling",                     "FIN",  "Finishes",  false, false, "DWG-ARCH-01"],
    ["win", "Windows Installation",       "FIN",  "Finishes",  false, false, ""],
    ["g4",  "QC GATE 4 · Final Handover", "QC",   "Gate",      true,  false, ""]
  ];
  const floor = [
    ["crA",  "Columns Zone A — Rebar & Shuttering", "EXE", "Structure", false, true,  "DWG-STR-01"],
    ["cpA",  "QC PERMIT · Zone A Column Pour",      "QC",  "Permit",    true,  false, ""],
    ["ccA",  "Columns Zone A — Casting",            "EXE", "Structure", false, false, ""],
    ["ssA",  "Slab Pour 1 — Shuttering",            "EXE", "Structure", false, false, "DWG-STR-02"],
    ["srA",  "Slab Pour 1 — Reinforcement",         "EXE", "Structure", false, true,  ""],
    ["svA",  "Slab Pour 1 — MEP Sleeves",           "MEP", "MEP",       false, true,  "DWG-MEP-01"],
    ["spA",  "QC PERMIT · Slab Pour 1",             "QC",  "Permit",    true,  false, ""],
    ["scA",  "Slab Pour 1 — Casting",               "EXE", "Structure", false, false, ""],
    ["cure", "Deshuttering & Curing — Released",    "EXE", "Structure", false, false, ""]
  ];
  const colorFor = (cat) =>
    cat === "Gate" || cat === "Permit" ? "#f97316"
      : cat === "MEP" ? "#3b82f6"
      : cat === "Wet Trade" ? "#eab308"
      : cat === "Finishes" ? "#a855f7"
      : "#64748b";

  const mk = (rows, track) =>
    rows.map(([code, name, role, category, isGate, isHidden, dwg], i) => ({
      id: "STG-" + code.toUpperCase(),
      code, name, track, role, category,
      seq: (i + 1) * 10,
      isGate, isHidden, dwg,
      color: colorFor(category),
      active: true
    }));

  return mk(unit, "unit").concat(mk(floor, "floor"));
}

/* Quality Master — the inspection parameters checklists are built from. */
function seedQParams() {
  const rows = [
    ["QP-01", "Wall Plumb Deviation",       "Civil",     "Plumb bob / spirit level", "± 3 mm per 3 m",          "Major"],
    ["QP-02", "Wall Line & Level",          "Civil",     "String line",              "± 5 mm",                  "Minor"],
    ["QP-03", "Brick Joint Thickness",      "Civil",     "Steel rule",               "10 – 12 mm",              "Minor"],
    ["QP-04", "Diagonal Squareness",        "Civil",     "Tape",                     "± 6 mm",                  "Major"],
    ["QP-05", "Conduit Fixing & Clamping",  "MEP",       "Visual",                   "Clamped @ 600 mm c/c",    "Major"],
    ["QP-06", "Concealed Box Level",        "MEP",       "Spirit level",             "± 2 mm",                  "Minor"],
    ["QP-07", "Plumbing Pressure Test",     "MEP",       "Pressure gauge",           "3 bar / 30 min, no drop", "Critical"],
    ["QP-08", "Electrical Insulation Test", "MEP",       "Megger",                   "≥ 1 MΩ",                  "Critical"],
    ["QP-09", "Slope to Floor Trap",        "Wet Trade", "Water test",               "1 : 100 minimum",         "Major"],
    ["QP-10", "Waterproofing Pond Test",    "Wet Trade", "48 hr ponding",            "No seepage below",        "Critical"],
    ["QP-11", "Plaster Thickness",          "Wet Trade", "Groove / probe",           "12 – 15 mm internal",     "Major"],
    ["QP-12", "Plaster Hollowness",         "Wet Trade", "Tap test",                 "No hollow sound",         "Major"],
    ["QP-13", "Tile Lippage",               "Finishes",  "Straight edge",            "≤ 1 mm",                  "Major"],
    ["QP-14", "Tile Hollowness",            "Finishes",  "Tap test",                 "≤ 5% of area",            "Major"],
    ["QP-15", "Grout Line Uniformity",      "Finishes",  "Visual / rule",            "± 1 mm",                  "Minor"],
    ["QP-16", "Window Frame Plumb",         "Finishes",  "Spirit level",             "± 2 mm",                  "Major"],
    ["QP-17", "Window Sealant Continuity",  "Finishes",  "Visual",                   "Continuous, no gaps",     "Major"],
    ["QP-18", "Rebar Cover Block",          "Structure", "Cover meter / visual",     "As per GFC ± 5 mm",       "Critical"],
    ["QP-19", "Rebar Spacing & Lap Length", "Structure", "Tape",                     "As per GFC",              "Critical"],
    ["QP-20", "Shuttering Alignment",       "Structure", "Plumb / line",             "± 5 mm",                  "Major"]
  ];
  return rows.map(([id, name, category, method, acceptance, severity]) => ({
    id, code: id, name, category, method, acceptance, severity, active: true
  }));
}

/* Quality Checklist — parameters grouped per stage, with evidence rules. */
function seedChecklists() {
  const defs = [
    ["CHK-G1",  "Pre-Plaster Gate Checklist",   "STG-G1",  ["QP-01","QP-02","QP-03","QP-04","QP-05","QP-06","QP-07","QP-08"]],
    ["CHK-G2",  "Plaster Check Checklist",      "STG-G2",  ["QP-11","QP-12","QP-01","QP-02"]],
    ["CHK-G3",  "Pre-Tiling Gate Checklist",    "STG-G3",  ["QP-09","QP-10","QP-02"]],
    ["CHK-G4",  "Final Handover Checklist",     "STG-G4",  ["QP-13","QP-14","QP-15","QP-16","QP-17"]],
    ["CHK-CPA", "Column Pour Permit Checklist", "STG-CPA", ["QP-18","QP-19","QP-20"]],
    ["CHK-SPA", "Slab Pour Permit Checklist",   "STG-SPA", ["QP-18","QP-19","QP-20","QP-05"]]
  ];
  return defs.map(([id, name, stageId, params]) => ({
    id, code: id, name, stageId, active: true,
    items: params.map((pid, i) => ({
      id: id + "-I" + String(i + 1).padStart(2, "0"),
      paramId: pid,
      mandatory: true,
      // Critical params always demand a photo; the rest are spot-checked.
      evidence: i < 3
    }))
  }));
}

function seedStageMap(projectId, stages, checklists) {
  const chkForStage = {};
  for (const c of checklists) chkForStage[c.stageId] = c.id;

  return stages.map((s, i) => ({
    id: "MAP-" + s.code.toUpperCase(),
    projectId,
    track: s.track,
    stageId: s.id,
    seq: s.seq,
    // Strictly linear within a track — predecessor is the previous mapped stage.
    predecessorId: i > 0 && stages[i - 1].track === s.track ? stages[i - 1].id : "",
    checklistId: chkForStage[s.id] || "",
    slaHours: s.isGate ? 24 : 48,
    active: true
  }));
}

function seedUsers() {
  const rows = [
    ["USR-01", "Rahul Gupta",      "DRI",  "Neoteric Group",       "+91 98200 10001"],
    ["USR-02", "Amit Kulkarni",    "EXE",  "Neoteric Group",       "+91 98200 10002"],
    ["USR-03", "Sandeep Rane",     "EXE",  "Neoteric Group",       "+91 98200 10003"],
    ["USR-04", "Priya Nair",       "MEP",  "Neoteric Group",       "+91 98200 10004"],
    ["USR-05", "Imran Shaikh",     "MEP",  "Sunrise MEP Contracts","+91 98200 10005"],
    ["USR-06", "Kavita Deshmukh",  "FIN",  "Neoteric Group",       "+91 98200 10006"],
    ["USR-07", "Ganesh Patil",     "QC",   "Neoteric Group",       "+91 98200 10007"],
    ["USR-08", "Sneha Joshi",      "QC",   "Neoteric Group",       "+91 98200 10008"],
    ["USR-09", "Ravi Yadav",       "MEAS", "Neoteric Group",       "+91 98200 10009"],
    ["USR-10", "Mahesh Bhosale",   "EXE",  "Shreeji Civil Works",  "+91 98200 10010"],
    ["USR-11", "Nitin Chavan",     "EXE",  "Shreeji Civil Works",  "+91 98200 10011"],
    ["USR-12", "Farhan Qureshi",   "MEP",  "Sunrise MEP Contracts","+91 98200 10012"],
    ["USR-13", "Deepa Menon",      "FIN",  "Elegance Interiors",   "+91 98200 10013"],
    ["USR-14", "Suresh Kamble",    "FIN",  "Elegance Interiors",   "+91 98200 10014"],
    ["USR-15", "Anjali Rao",       "QC",   "Neoteric Group",       "+91 98200 10015"],
    ["USR-16", "Vikram Sethi",     "MEAS", "Neoteric Group",       "+91 98200 10016"],
    ["USR-17", "Pooja Salunkhe",   "DRI",  "Neoteric Group",       "+91 98200 10017"]
  ];
  return rows.map(([id, name, role, company, phone]) => ({
    id, code: id, name, role, company, phone,
    email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@neotericgrp.in",
    active: true
  }));
}

/* Realistic snag text per quality parameter, so the register reads like a real one. */
const SNAG_TEXT = {
  "QP-01": ["Wall out of plumb in bedroom", "North wall leans 7 mm over 3 m. Needs cutting back and re-plaster."],
  "QP-02": ["Wall line off at living room junction", "Line deviates 9 mm where the two walls meet."],
  "QP-03": ["Brick joints over-thick in kitchen", "Joints running 16–18 mm against the 12 mm limit."],
  "QP-04": ["Room out of square", "Diagonals differ by 14 mm in bedroom 2."],
  "QP-05": ["AC conduit unclamped", "Conduit run loose over 1.8 m, clamps missing."],
  "QP-06": ["Switch box not level", "Two boxes tilted ~5 mm in the living room."],
  "QP-07": ["Plumbing pressure drop", "Line dropped from 3 bar to 2.1 bar in 30 min. Leak suspected at the tee."],
  "QP-08": ["Low insulation resistance", "Megger reads 0.4 MΩ on the kitchen circuit."],
  "QP-09": ["Insufficient slope to trap", "Water ponds near the shower corner instead of draining."],
  "QP-10": ["Seepage after pond test", "Damp patch visible on the ceiling of the flat below."],
  "QP-11": ["Plaster under thickness", "Measured 8–9 mm against the 12 mm minimum."],
  "QP-12": ["Hollow plaster patches", "Tap test hollow over roughly 0.6 sq m near the window."],
  "QP-13": ["Tile lippage at threshold", "2 mm lippage at the living room door threshold."],
  "QP-14": ["Hollow tiles in bedroom", "Around 8% of the floor sounds hollow — above the 5% limit."],
  "QP-15": ["Uneven grout lines", "Grout varies 1–3 mm across the bathroom wall."],
  "QP-16": ["Window frame out of plumb", "Frame off by 5 mm, shutter does not close flush."],
  "QP-17": ["Sealant discontinuous", "Gaps in the external sealant bead at both bottom corners."],
  "QP-18": ["Cover blocks missing", "Cover blocks absent in a 1.5 m stretch of the slab."],
  "QP-19": ["Rebar spacing off drawing", "Spacing at 180 mm where GFC calls for 150 mm."],
  "QP-20": ["Shuttering misaligned", "Column shutter out by 8 mm at the top."]
};

/* ------------------------------------------------------------------ seed */

function seedData() {
  const d = blankData();
  const rng = makeRng(20260817);
  const now = Date.now(), HR = 3600000, DAY = 86400000;
  const projectId = "PRJ-01";
  const FLOORS = 10, UNITS = 9;

  d.projects = [{
    id: projectId,
    code: "NTA",
    name: "Neoteric Tower A",
    client: "Neoteric Group",
    location: "Kharadi, Pune",
    floorCount: FLOORS,
    unitsPerFloor: UNITS,
    startDate: new Date(now - 300 * DAY).toISOString().slice(0, 10),
    targetDate: new Date(now + 240 * DAY).toISOString().slice(0, 10),
    active: true
  }];

  const fId = (f) => "FLR-" + String(f).padStart(2, "0");
  const uId = (f, u) => "UNT-" + String(f).padStart(2, "0") + String(u).padStart(2, "0");

  for (let f = 1; f <= FLOORS; f++) {
    d.floors.push({
      id: fId(f), projectId, code: "FL" + f,
      name: f === 1 ? "Ground Floor" : "Floor " + f,
      seq: f, unitCount: UNITS, active: true
    });
    for (let u = 1; u <= UNITS; u++) {
      d.units.push({
        id: uId(f, u), projectId, floorId: fId(f),
        code: String(f).padStart(2, "0") + String(u).padStart(2, "0"),
        name: "Flat " + f + String(u).padStart(2, "0"),
        type: u % 3 === 0 ? "3BHK" : "2BHK",
        carpetArea: u % 3 === 0 ? 985 : 720,
        seq: u, active: true
      });
    }
  }

  d.stages = seedStages();
  d.qparams = seedQParams();
  d.checklists = seedChecklists();
  d.stagemap = seedStageMap(projectId, d.stages, d.checklists);
  d.users = seedUsers();

  const unitStages = d.stages.filter((s) => s.track === "unit");   // 13
  const floorStages = d.stages.filter((s) => s.track === "floor");  // 9

  const byRole = {};
  for (const u of d.users) (byRole[u.role] = byRole[u.role] || []).push(u);
  const someone = (role, salt) => {
    const list = byRole[role] || byRole.EXE;
    return list[Math.abs(salt) % list.length].id;
  };
  const qcUser = (salt) => someone("QC", salt);

  const mark = (key, rec) => { d.progress[key] = rec; };
  const ev = (ts, userId, action, targetId, stageId, detail) =>
    d.events.push({ ts, userId, action, targetId, stageId, detail });

  /* ---------------------------------------------------- structure track
   * Floors 1–8 fully cured, floor 9 mid-structure (so the floor track shows
   * live work), floor 10 untouched and locked behind it.
   */
  for (let f = 1; f <= 8; f++) {
    floorStages.forEach((s, i) => {
      const base = now - (30 - f * 3) * DAY + i * 5 * HR;
      mark(fId(f) + "::" + s.id, {
        status: "done",
        rel: base - 6 * HR, ack: base - 4 * HR, start: base - 3 * HR, at: base,
        by: someone(s.role, f * 7 + i),
        meas: s.isHidden ? base - 2 * HR : undefined,
        measBy: s.isHidden ? someone("MEAS", f + i) : undefined
      });
    });
    ev(now - (30 - f * 3) * DAY + 9 * 5 * HR, someone("EXE", f), "COMPLETE", fId(f), "STG-CURE",
       "Floor " + f + " deshuttered and released to trades");
  }

  // Floor 9: five stages done, the sixth acknowledged and in progress.
  floorStages.slice(0, 5).forEach((s, i) => {
    const base = now - (5 - i) * DAY;
    mark(fId(9) + "::" + s.id, {
      status: "done",
      rel: base - 6 * HR, ack: base - 5 * HR, start: base - 4 * HR, at: base,
      by: someone(s.role, 90 + i),
      meas: s.isHidden ? base - 2 * HR : undefined,
      measBy: s.isHidden ? someone("MEAS", i) : undefined
    });
  });
  mark(fId(9) + "::" + floorStages[5].id, {
    status: "wip", rel: now - 2 * DAY, ack: now - 40 * HR, start: now - 30 * HR,
    by: someone(floorStages[5].role, 3)
  });
  ev(now - 30 * HR, someone("MEP", 3), "START", fId(9), floorStages[5].id, "MEP sleeves started on floor 9 slab");

  /* -------------------------------------------------------- unit track
   * 72 unlocked units (floors 1–8) spread across all 13 stages, in every
   * state the board can render. `reached` = stages fully complete.
   */
  const variants = ["released", "slow", "ack", "wip", "fail", "hidden"];
  let unitIdx = 0;

  for (let f = 1; f <= 8; f++) {
    for (let u = 1; u <= UNITS; u++) {
      const id = uId(f, u);
      // Spread 0..13 evenly so every stage is somebody's current stage. The
      // variant cycles on a different modulus so depth and state stay independent.
      let reached = unitIdx % (unitStages.length + 1);
      const variant = variants[unitIdx % variants.length];
      unitIdx++;

      // Park "hidden" units right at a gate whose hidden predecessor was never
      // measured — that is the only position where the hidden-work lock shows.
      let skipMeasIdx = -1;
      if (variant === "hidden") {
        reached = unitIdx % 2 ? 9 : 4;                 // current stage = QC GATE 3 or GATE 1
        skipMeasIdx = reached === 4 ? 3 : 8;           // Electrical Wiring / Waterproofing
      }

      for (let i = 0; i < reached; i++) {
        const s = unitStages[i];
        const base = now - (reached - i) * 2 * DAY - Math.floor(rng() * 6) * HR;
        mark(id + "::" + s.id, {
          status: "done",
          rel: base - 8 * HR, ack: base - 6 * HR, start: base - 5 * HR, at: base,
          by: someone(s.role, f * 11 + u + i),
          meas: s.isHidden && i !== skipMeasIdx ? base - 3 * HR : undefined,
          measBy: s.isHidden && i !== skipMeasIdx ? someone("MEAS", f + u) : undefined
        });
      }

      if (reached >= unitStages.length) {
        ev(now - Math.floor(rng() * 20) * DAY, qcUser(unitIdx), "QC_PASS", id, "STG-G4",
           "Final handover checklist passed — flat released");
        continue; // handed over
      }

      // The current stage carries the variant.
      const s = unitStages[reached];
      const key = id + "::" + s.id;

      if (variant === "released" || variant === "hidden") {
        mark(key, { status: "released", rel: now - Math.floor(2 + rng() * 10) * HR });
      } else if (variant === "slow") {
        // Deliberately past SLA and never acknowledged.
        mark(key, { status: "released", rel: now - Math.floor(30 + rng() * 60) * HR });
      } else if (variant === "ack") {
        const rel = now - Math.floor(10 + rng() * 20) * HR;
        mark(key, { status: "ack", rel, ack: rel + 3 * HR, by: someone(s.role, unitIdx) });
      } else if (variant === "wip") {
        const rel = now - Math.floor(20 + rng() * 30) * HR;
        mark(key, { status: "wip", rel, ack: rel + 2 * HR, start: rel + 4 * HR, by: someone(s.role, unitIdx) });
      } else if (variant === "fail") {
        const rel = now - Math.floor(12 + rng() * 40) * HR;
        if (s.isGate) {
          mark(key, {
            status: "fail", rel, ack: rel + HR, start: rel + 2 * HR, at: rel + 4 * HR,
            by: qcUser(unitIdx), note: "Checklist failed — see linked snags for rectification."
          });
          ev(rel + 4 * HR, qcUser(unitIdx), "QC_FAIL", id, s.id, "Gate failed at " + s.name);
        } else {
          // Non-gate stages cannot fail a gate, so show them mid-work instead.
          mark(key, { status: "wip", rel, ack: rel + 2 * HR, start: rel + 3 * HR, by: someone(s.role, unitIdx) });
        }
      }
    }
  }

  /* ------------------------------------------------------------- snags
   * Spread across parameters, severities, statuses, owners and ages, and
   * anchored to units that have actually reached the relevant stage.
   */
  const paramIds = d.qparams.map((p) => p.id);
  const gateForParam = {
    "QP-01": "STG-G1", "QP-02": "STG-G1", "QP-03": "STG-G1", "QP-04": "STG-G1",
    "QP-05": "STG-G1", "QP-06": "STG-G1", "QP-07": "STG-G1", "QP-08": "STG-G1",
    "QP-11": "STG-G2", "QP-12": "STG-G2",
    "QP-09": "STG-G3", "QP-10": "STG-G3",
    "QP-13": "STG-G4", "QP-14": "STG-G4", "QP-15": "STG-G4", "QP-16": "STG-G4", "QP-17": "STG-G4",
    "QP-18": "STG-SPA", "QP-19": "STG-SPA", "QP-20": "STG-CPA"
  };
  const ownerRoleForParam = {
    Civil: "EXE", MEP: "MEP", "Wet Trade": "EXE", Finishes: "FIN", Structure: "EXE"
  };

  const SNAG_COUNT = 46;
  for (let i = 0; i < SNAG_COUNT; i++) {
    const p = d.qparams[i % paramIds.length];
    const f = 1 + (i * 3) % 8;
    const u = 1 + (i * 5) % UNITS;
    const stageId = gateForParam[p.id] || "STG-G1";
    const isStructural = stageId === "STG-SPA" || stageId === "STG-CPA";
    const [title, description] = SNAG_TEXT[p.id];

    // Age spread: some fresh, some ageing, some long closed.
    const ageH = Math.floor(4 + rng() * 260);
    const raisedAt = now - ageH * HR;
    // Roughly a third closed, a sixth in progress, the rest open.
    const bucket = i % 6;
    const status = bucket === 0 || bucket === 3 ? "Closed" : bucket === 1 ? "In Progress" : "Open";
    const slaH = p.severity === "Critical" ? 24 : p.severity === "Major" ? 72 : 120;

    const rec = {
      id: "SNG-" + String(i + 1).padStart(4, "0"),
      projectId,
      unitId: isStructural ? "" : uId(f, u),
      floorId: isStructural ? fId(f) : "",
      stageId,
      paramId: p.id,
      title: title + (isStructural ? " · " + (f === 1 ? "Ground Floor" : "Floor " + f) : " · Flat " + f + String(u).padStart(2, "0")),
      description,
      severity: p.severity,
      status,
      raisedBy: qcUser(i),
      raisedAt,
      assignedTo: someone(ownerRoleForParam[p.category] || "EXE", i * 3),
      dueAt: raisedAt + slaH * HR,
      photos: [],
      comments: []
    };
    if (status === "Closed") {
      rec.closedAt = raisedAt + Math.floor(slaH * (0.4 + rng() * 0.8)) * HR;
      rec.closedBy = qcUser(i + 1);
    }
    d.snags.push(rec);
    ev(raisedAt, rec.raisedBy, "SNAG_RAISE", rec.unitId || rec.floorId, stageId, rec.title);
    if (status === "Closed") ev(rec.closedAt, rec.closedBy, "SNAG_CLOSED", rec.unitId || rec.floorId, stageId, "Rectified and verified");
  }

  /* ------------------------------------------------------- assignments
   * Every user carries some load; a deliberate few are overdue.
   */
  const ASSIGN_COUNT = 42;
  const workers = d.users.filter((u) => u.role !== "DRI");
  const notes = [
    "Start as soon as the slab below is released.",
    "Material is at the site store — collect against the indent.",
    "Close this before the Friday client walkthrough.",
    "Coordinate with the MEP team so the conduits are not disturbed.",
    "Recheck the levels before you call for inspection.",
    "Take the eMB photos while the work is still open.",
    "This one slipped last week — please prioritise.",
    "Client is visiting this floor, keep the area clean after work.",
    "Use the revised GFC drawing, not the older revision.",
    "Book the DET measurement before you close the wall."
  ];

  for (let i = 0; i < ASSIGN_COUNT; i++) {
    const worker = workers[i % workers.length];
    const useFloor = i % 7 === 0;
    const pool = useFloor ? floorStages : unitStages;
    const stage = pool.filter((s) => s.role === worker.role)[i % Math.max(1, pool.filter((s) => s.role === worker.role).length)]
                  || pool[i % pool.length];
    const f = 1 + (i * 2) % 9;
    const u = 1 + (i * 4) % UNITS;
    const assignedAt = now - Math.floor(2 + rng() * 120) * HR;
    // Mix of comfortably-due, tight and overdue.
    const dueOffset = [-30, -6, 8, 20, 48, 72][i % 6];

    d.assignments.push({
      id: "ASG-" + String(i + 1).padStart(4, "0"),
      projectId,
      targetType: useFloor ? "floor" : "unit",
      targetId: useFloor ? fId(f) : uId(f, u),
      stageId: stage.id,
      assignedTo: worker.id,
      assignedBy: i % 5 === 0 ? "USR-17" : "USR-01",
      assignedAt,
      dueAt: now + dueOffset * HR,
      status: i % 5 === 0 ? "Done" : i % 3 === 0 ? "Accepted" : "Assigned",
      note: notes[i % notes.length]
    });
    ev(assignedAt, "USR-01", "ASSIGN", useFloor ? fId(f) : uId(f, u), stage.id,
       "Assigned to " + worker.name);
  }

  d.events.sort((a, b) => b.ts - a.ts);
  if (d.events.length > 5000) d.events.length = 5000;

  return d;
}

module.exports = { COLLECTIONS, ROLES, TRACKS, seedData, blankData };

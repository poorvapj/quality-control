#!/usr/bin/env node
/*
 * One-off migration: populate checklistGroups / checklistPhases / checklistItems
 * (new Masters ▸ Checklist Groups/Phases/Items collections) with rows that
 * exactly reproduce the content that used to be hardcoded in
 * frontend/src/shared/checklistDefs.ts's FALLBACK_* constants (itself a copy
 * of QualityInspection.tsx's old STANDALONE_CHECKLISTS/PHASE_GROUPS) — same
 * group names, same phase labels/order, same nameOverride, same items in the
 * same order — so every existing qualityInspections.workType string already
 * in the database keeps matching and no phase-gating/history breaks.
 *
 * SAFE TO RE-RUN: skips (no writes at all) if checklistGroups already has
 * any row, so running it twice by mistake does nothing the second time.
 *
 * Run once against the live Atlas cluster (same MONGODB_URI/MONGODB_DB the
 * app already uses):
 *   node backend/seed-checklist-defs.js
 *
 * DO NOT run this against production without the user's explicit go-ahead —
 * see this project's standing rule to confirm before any write to prod data.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { nextSeqId } = require("./idSeq");

const STANDALONE = [
  { name: "Material Testing & Quality Checks", items: [
    "Concrete strength: verify approved mix design, sampling, cube/cylinder casting, identification, curing, and compressive-strength test reports.",
    "Sand: check grading/particle size, silt content, cleanliness, and compliance with approved specifications.",
    "Coarse aggregate (metal): check nominal size, grading, shape/flakiness, cleanliness, and approved test results.",
    "Bricks — strength: verify compressive-strength test results and compliance with specifications.",
    "Bricks — water absorption: check water absorption test results as per applicable standards.",
    "Other required material tests: verify test certificates and approvals before use."
  ] },
  { name: "Column Inspection", items: [
    "Location and dimensions: confirm column position, size, and orientation against approved structural drawings.",
    "Reinforcement steel: verify bar diameter, number, spacing, lap/development length, anchorage, and stirrup spacing.",
    "Concrete cover: check specified cover blocks and required clear cover on all sides.",
    "Shuttering/formwork: verify dimensions, line, level, verticality, rigidity, joints, cleanliness, and application of release agent.",
    "Plumb: check column verticality before concreting and recheck as required."
  ] },
  { name: "Tile Work Inspection", items: [
    "Floor level and slope: verify finished levels and required slope toward floor traps/drains in wet areas.",
    "Tile condition: check tiles for cracks, chips, scratches, stains, and other visible defects before laying.",
    "Base surface: confirm the substrate is sound, clean, level/appropriately sloped, and free of loose material.",
    "Joints and gaps: check uniform joint width, alignment, spacers, and approved grout/filler.",
    "Hollow tiles and finish: tap-test for hollow areas where appropriate; check lippage, cutting, edge finish, and skirting alignment.",
    "Protection and cleaning: clean grout residue and protect finished tiles from damage until handover."
  ] },
  { name: "Finishing & Handover Inspection", items: [
    "All punch list items from earlier stages closed: zero open NCRs, verified by Quality Inspector.",
    "Doors & windows: smooth operation, gaps under 5mm on all sides, locks functional.",
    "All fixtures working: taps, switches, fans, geysers tested — no snag.",
    "Flooring: no hollow tiles, clean grout — 100% tap test on all floor tiles, uniform grout joints.",
    "Paint: no peeling, uniform finish, no patches — visual check in daylight; touch-up not acceptable over peeling.",
    "Customer walkthrough checklist signed: customer signs, any observation noted and resolved before possession."
  ] }
];

const PHASE_GROUPS = [
  {
    name: "R.C.C. Slab Inspection", scope: "floor",
    phases: [
      { label: "Before Pour", items: [
        "Shuttering check: verify slab level, thickness, dimensions, support/props, stability, tight joints, and cleanliness.",
        "Reinforcement steel: check bar diameter, spacing, top and bottom reinforcement, extra bars, laps, anchorage, and openings as per drawings.",
        "Cover and embedded services: verify cover blocks, electrical conduits, sleeves, and other inserts do not displace reinforcement.",
        "Pre-pour approval: confirm inspection clearance, concrete grade, pour sequence, access, and curing arrangements."
      ] },
      { label: "During Pour", items: [
        "Slump test at pour point: record the value and reject the batch if it falls outside the design mix range.",
        "Cube samples taken: minimum 3 cubes per 5 cum, labelled with floor and date.",
        "Vibration done correctly: poker at max 500mm centres, no cold joints — no gap over 30 minutes between layers."
      ] },
      { label: "After Pour", items: ["Curing started within 24 hours of pour: wet gunny or curing compound, minimum 7 days."] }
    ]
  },
  {
    name: "Brickwork", scope: "unit",
    phases: [
      { label: "Before Brickwork", items: ["Brickwork layout: check wall location, thickness, openings, and alignment against approved drawings."] },
      { label: "During Brickwork", items: [
        "Line, level, and plumb: check courses and wall faces regularly using suitable instruments — plumb check every 3 courses, max deviation 3mm per 3m.",
        "Bond and joints: ensure proper bond, staggered vertical joints, uniform joint thickness, and fully filled mortar joints.",
        "Mortar and bricks: verify approved materials, mortar mix, brick condition, and appropriate wetting where specified.",
        "Laying and curing: ensure proper laying technique, toothed/keyed junctions where specified, and curing as required."
      ] },
      { label: "Before Plastering", nameOverride: "Brickwork & Plaster", items: [
        "Pre-plaster services: check plumbing pipes, electrical conduits/boxes, and A.C. pipe/fittings before plastering.",
        "Surface preparation: ensure background is clean, sound, and prepared to the approved method; provide bonding treatment where specified.",
        "Chicken mesh at concrete and brickwork joints.",
        "Surface curing before plastering."
      ] },
      { label: "During Plastering", nameOverride: "Brickwork & Plaster", items: [
        "Finish, level, and plumb: check thickness (12mm internal, verified with pin at 3 points per wall), flatness, corners, edges, line, level, and verticality."
      ] },
      { label: "After Plastering", nameOverride: "Brickwork & Plaster", items: ["Curing: plastered surface cured as required."] }
    ]
  },
  {
    name: "Waterproofing Inspection", scope: "unit-area",
    phases: [
      { label: "Before Application", items: ["All surface cracks sealed before WP coat: approved crack filler; inspector confirms surface is ready."] },
      { label: "During Application", items: ["Two coats applied, turned up 150mm on all walls: overlap 150mm at joints, full turn-up at floor-wall junction."] },
      { label: "After WP / Before Tiling", items: ["Flood test — 50mm water ponding for 24 hours: non-negotiable; inspector present at start and end."] },
      { label: "After 24 Hours", items: [
        "Ceiling below inspected for seepage after 24 hours: zero leaks to proceed; any seepage means redo WP and retest.",
        "Sign-off: flood test result recorded with date, time, and inspector name — photo mandatory."
      ] }
    ]
  },
  {
    name: "Plumbing & Electrical Inspection", scope: "unit",
    phases: [
      { label: "Before Plastering", items: ["Pipe pressure test before concealment: 1.5x working pressure for 30 minutes, zero pressure drop."] },
      { label: "Before Pour", items: ["All sleeves placed before structural pour: DRI confirms — no chasing of RCC members allowed."] },
      { label: "During Installation", items: ["Earthing continuity confirmed floor by floor: continuity tester, each floor signed off separately."] },
      { label: "After Panel Installation", items: ["ELCB trip test done after panel installation: trip time within IS specification, recorded in register."] },
      { label: "Before Handover", items: ["As-built drawing updated and filed before handover: attached to the QC file for this apartment."] }
    ]
  }
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);
  console.log(`Connected to db: ${db.databaseName}`);

  const existing = await db.collection("checklistGroups").countDocuments();
  if (existing > 0) {
    console.log(`checklistGroups already has ${existing} row(s) — nothing to do. Delete them first if you really want to reseed.`);
    await client.close();
    return;
  }

  const now = Date.now();
  let order = 1;
  const groups = [], phases = [], items = [];

  for (const g of STANDALONE) {
    const groupId = await nextSeqId(db, "CKG");
    groups.push({ id: groupId, name: g.name, kind: "standalone", order: order++, active: true, createdAt: now });
    let itemOrder = 1;
    for (const text of g.items) {
      items.push({ id: await nextSeqId(db, "CKI"), groupId, phaseId: null, text, order: itemOrder++, active: true, createdAt: now });
    }
  }

  for (const g of PHASE_GROUPS) {
    const groupId = await nextSeqId(db, "CKG");
    groups.push({ id: groupId, name: g.name, kind: "phased", scope: g.scope, order: order++, active: true, createdAt: now });
    let phaseOrder = 1;
    for (const p of g.phases) {
      const phaseId = await nextSeqId(db, "CKP");
      phases.push({ id: phaseId, groupId, label: p.label, nameOverride: p.nameOverride, order: phaseOrder++, active: true, createdAt: now });
      let itemOrder = 1;
      for (const text of p.items) {
        items.push({ id: await nextSeqId(db, "CKI"), groupId, phaseId, text, order: itemOrder++, active: true, createdAt: now });
      }
    }
  }

  await db.collection("checklistGroups").insertMany(groups);
  await db.collection("checklistPhases").insertMany(phases);
  await db.collection("checklistItems").insertMany(items);

  console.log(`Inserted ${groups.length} checklistGroups, ${phases.length} checklistPhases, ${items.length} checklistItems.`);
  await client.close();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});

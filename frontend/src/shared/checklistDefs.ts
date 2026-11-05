import { useMemo } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "./rules";

// Checklist structure (Work Types / Phases / the items inside each) used to
// be hardcoded in QualityInspection.tsx. It now lives in 3 Masters
// collections (checklistGroups / checklistPhases / checklistItems) so it can
// be managed (add/edit/delete) from Masters ▸ Checklist Groups/Phases/Items
// without a code change. This file builds the SAME shapes the old hardcoded
// constants had (PhaseGroup/PhaseDef/etc.) from that master data, so all the
// gating/scope logic elsewhere in QualityInspection.tsx/Execution.tsx that
// was written against those shapes keeps working unchanged.

export interface PhaseDef { label: string; items: string[]; nameOverride?: string }
export interface PhaseGroup { name: string; scope: "floor" | "unit" | "unit-area"; phases: PhaseDef[] }

export const CHECKLIST_STATUSES = ["OK", "Not OK", "N/A"] as const;

// Fallback used only if the Masters collections are empty (fresh dev DB
// before the one-time migration has run) — identical to the previous
// hardcoded content, so nothing breaks pre-migration.
const FALLBACK_STANDALONE: Record<string, string[]> = {
  "Material Testing & Quality Checks": [
    "Concrete strength: verify approved mix design, sampling, cube/cylinder casting, identification, curing, and compressive-strength test reports.",
    "Sand: check grading/particle size, silt content, cleanliness, and compliance with approved specifications.",
    "Coarse aggregate (metal): check nominal size, grading, shape/flakiness, cleanliness, and approved test results.",
    "Bricks — strength: verify compressive-strength test results and compliance with specifications.",
    "Bricks — water absorption: check water absorption test results as per applicable standards.",
    "Other required material tests: verify test certificates and approvals before use."
  ],
  "Column Inspection": [
    "Location and dimensions: confirm column position, size, and orientation against approved structural drawings.",
    "Reinforcement steel: verify bar diameter, number, spacing, lap/development length, anchorage, and stirrup spacing.",
    "Concrete cover: check specified cover blocks and required clear cover on all sides.",
    "Shuttering/formwork: verify dimensions, line, level, verticality, rigidity, joints, cleanliness, and application of release agent.",
    "Plumb: check column verticality before concreting and recheck as required."
  ],
  "Tile Work Inspection": [
    "Floor level and slope: verify finished levels and required slope toward floor traps/drains in wet areas.",
    "Tile condition: check tiles for cracks, chips, scratches, stains, and other visible defects before laying.",
    "Base surface: confirm the substrate is sound, clean, level/appropriately sloped, and free of loose material.",
    "Joints and gaps: check uniform joint width, alignment, spacers, and approved grout/filler.",
    "Hollow tiles and finish: tap-test for hollow areas where appropriate; check lippage, cutting, edge finish, and skirting alignment.",
    "Protection and cleaning: clean grout residue and protect finished tiles from damage until handover."
  ],
  "Finishing & Handover Inspection": [
    "All punch list items from earlier stages closed: zero open NCRs, verified by Quality Inspector.",
    "Doors & windows: smooth operation, gaps under 5mm on all sides, locks functional.",
    "All fixtures working: taps, switches, fans, geysers tested — no snag.",
    "Flooring: no hollow tiles, clean grout — 100% tap test on all floor tiles, uniform grout joints.",
    "Paint: no peeling, uniform finish, no patches — visual check in daylight; touch-up not acceptable over peeling.",
    "Customer walkthrough checklist signed: customer signs, any observation noted and resolved before possession."
  ]
};

const FALLBACK_PHASE_GROUPS: PhaseGroup[] = [
  {
    name: "R.C.C. Slab Inspection",
    scope: "floor",
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
    name: "Brickwork",
    scope: "unit",
    phases: [
      { label: "Before Brickwork", nameOverride: "", items: ["Brickwork layout: check wall location, thickness, openings, and alignment against approved drawings."] },
      { label: "During Brickwork", nameOverride: "", items: [
        "Line, level, and plumb: check courses and wall faces regularly using suitable instruments — plumb check every 3 courses, max deviation 3mm per 3m.",
        "Bond and joints: ensure proper bond, staggered vertical joints, uniform joint thickness, and fully filled mortar joints.",
        "Mortar and bricks: verify approved materials, mortar mix, brick condition, and appropriate wetting where specified.",
        "Laying and curing: ensure proper laying technique, toothed/keyed junctions where specified, and curing as required."
      ] },
      { label: "Before Plastering", nameOverride: "", items: [
        "Pre-plaster services: check plumbing pipes, electrical conduits/boxes, and A.C. pipe/fittings before plastering.",
        "Surface preparation: ensure background is clean, sound, and prepared to the approved method; provide bonding treatment where specified.",
        "Chicken mesh at concrete and brickwork joints.",
        "Surface curing before plastering."
      ] },
      { label: "During Plastering", nameOverride: "", items: [
        "Finish, level, and plumb: check thickness (12mm internal, verified with pin at 3 points per wall), flatness, corners, edges, line, level, and verticality."
      ] },
      { label: "After Plastering", nameOverride: "", items: ["Curing: plastered surface cured as required."] }
    ]
  },
  {
    name: "Waterproofing Inspection",
    scope: "unit-area",
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
    name: "Plumbing & Electrical Inspection",
    scope: "unit",
    phases: [
      { label: "Before Plastering", items: ["Pipe pressure test before concealment: 1.5x working pressure for 30 minutes, zero pressure drop."] },
      { label: "Before Pour", items: ["All sleeves placed before structural pour: DRI confirms — no chasing of RCC members allowed."] },
      { label: "During Installation", items: ["Earthing continuity confirmed floor by floor: continuity tester, each floor signed off separately."] },
      { label: "After Panel Installation", items: ["ELCB trip test done after panel installation: trip time within IS specification, recorded in register."] },
      { label: "Before Handover", items: ["As-built drawing updated and filed before handover: attached to the QC file for this apartment."] }
    ]
  }
];

// Keyed by the CURRENT work type name a phase displays as; values are every
// name it used to display as (so a record saved under the old name still
// counts toward this phase's gating/lookup logic — see latestResult() in
// QualityInspection.tsx). "Brickwork"/"Brickwork & Plaster" were dropped
// from these 5 phases' displayed names (redundant — the phase label already
// says it), so their old prefixed names move here as legacy equivalents.
export const LEGACY_PHASE_EQUIVALENT: Record<string, string[]> = {
  "Before Brickwork": ["Brickwork — Before Brickwork"],
  "During Brickwork": ["Brickwork — During Brickwork", "Brickwork & Plaster — During Brickwork", "Brickwork Inspection"],
  "Before Plastering": ["Brickwork & Plaster — Before Plastering", "Plastering Inspection"],
  "During Plastering": ["Brickwork & Plaster — During Plastering", "Plastering Inspection"],
  "After Plastering": ["Brickwork & Plaster — After Plastering"],
  "R.C.C. Slab Inspection — After Pour": ["R.C.C. Slab Inspection"],
  "Waterproofing Inspection — After 24 Hours": ["Waterproofing Inspection"],
  "Plumbing & Electrical Inspection — Before Handover": ["Plumbing & Electrical Inspection"]
};

// An explicit "" nameOverride means "no prefix at all" (just the phase
// label) — distinct from no override, which falls back to the group's own
// name (e.g. "R.C.C. Slab Inspection — Before Pour").
export const phaseWorkType = (group: PhaseGroup, phase: PhaseDef) => {
  const prefix = phase.nameOverride !== undefined ? phase.nameOverride : group.name;
  return prefix ? `${prefix} — ${phase.label}` : phase.label;
};

interface RawGroup { id: string; name: string; kind: "standalone" | "phased"; scope?: "floor" | "unit" | "unit-area"; order?: number; active?: boolean }
interface RawPhase { id: string; groupId: string; label: string; nameOverride?: string; order?: number; active?: boolean }
interface RawItem { id: string; groupId: string; phaseId?: string | null; text: string; order?: number; active?: boolean }

function buildFromMasters(groups: RawGroup[], phases: RawPhase[], items: RawItem[]) {
  const liveGroups = groups.filter((g) => g.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const itemsFor = (groupId: string, phaseId?: string | null) =>
    items
      .filter((i) => i.active !== false && i.groupId === groupId && (i.phaseId || null) === (phaseId || null))
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((i) => i.text);

  const standalone: Record<string, string[]> = {};
  const phaseGroups: PhaseGroup[] = [];
  for (const g of liveGroups) {
    if (g.kind === "standalone") {
      standalone[g.name] = itemsFor(g.id, null);
    } else {
      const gPhases = phases
        .filter((p) => p.active !== false && p.groupId === g.id)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((p) => ({ label: p.label, nameOverride: p.nameOverride, items: itemsFor(g.id, p.id) }));
      if (gPhases.length) phaseGroups.push({ name: g.name, scope: g.scope || "floor", phases: gPhases });
    }
  }
  return { standalone, phaseGroups };
}

export function useChecklistDefs() {
  const { data } = useApp();
  const groups = coll(data, "checklistGroups") as unknown as RawGroup[];
  const phases = coll(data, "checklistPhases") as unknown as RawPhase[];
  const items = coll(data, "checklistItems") as unknown as RawItem[];

  return useMemo(() => {
    const hasMasterData = (groups?.length || 0) > 0;
    const { standalone, phaseGroups } = hasMasterData
      ? buildFromMasters(groups, phases || [], items || [])
      : { standalone: FALLBACK_STANDALONE, phaseGroups: FALLBACK_PHASE_GROUPS };

    const PHASE_LOOKUP = new Map<string, { group: PhaseGroup; phaseIndex: number }>();
    for (const group of phaseGroups) {
      group.phases.forEach((phase, phaseIndex) => PHASE_LOOKUP.set(phaseWorkType(group, phase), { group, phaseIndex }));
    }

    const QC_CHECKLISTS: Record<string, string[]> = {
      ...standalone,
      ...Object.fromEntries(phaseGroups.flatMap((group) => group.phases.map((phase) => [phaseWorkType(group, phase), phase.items])))
    };

    const STANDALONE_UNIT_SCOPED = new Set(["Tile Work Inspection", "Finishing & Handover Inspection"]);
    const scopeOf = (wt: string): "floor" | "unit" | "unit-area" => {
      const phase = PHASE_LOOKUP.get(wt);
      if (phase) return phase.group.scope;
      return STANDALONE_UNIT_SCOPED.has(wt) ? "unit" : "floor";
    };
    const isFlatWise = (wt: string) => !!wt && scopeOf(wt) !== "floor";
    const requiresAreas = (wt: string) => !!wt && scopeOf(wt) === "unit-area";

    const standaloneOrder = Object.keys(standalone);
    const firstStandalone = standaloneOrder.filter((n) => n !== "Tile Work Inspection" && n !== "Finishing & Handover Inspection");
    const lastStandalone = standaloneOrder.filter((n) => n === "Tile Work Inspection" || n === "Finishing & Handover Inspection");
    const WORK_TYPES = [...firstStandalone, ...phaseGroups.flatMap((group) => group.phases.map((phase) => phaseWorkType(group, phase))), ...lastStandalone];

    const brickworkGroup = phaseGroups.find((g) => g.name === "Brickwork");
    const MULTI_FLOOR_WORK_TYPES = brickworkGroup ? brickworkGroup.phases.map((p) => phaseWorkType(brickworkGroup, p)) : [];

    const UNIT_FINAL_STAGES = [
      ...phaseGroups.filter((g) => g.scope !== "floor").map((g) => phaseWorkType(g, g.phases[g.phases.length - 1])),
      "Tile Work Inspection"
    ];

    return {
      STANDALONE_CHECKLISTS: standalone,
      PHASE_GROUPS: phaseGroups,
      PHASE_LOOKUP,
      QC_CHECKLISTS,
      WORK_TYPES,
      scopeOf,
      isFlatWise,
      requiresAreas,
      MULTI_FLOOR_WORK_TYPES,
      UNIT_FINAL_STAGES,
      LEGACY_PHASE_EQUIVALENT,
      phaseWorkType,
      usingFallback: !hasMasterData
    };
  }, [groups, phases, items]);
}

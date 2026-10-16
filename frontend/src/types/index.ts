/* ===========================================================================
   Shared data-model types. Mirrors the shapes already produced by
   backend/seed.js and read/written by backend/server.js — nothing here
   changes the wire format, it just names it.
   =========================================================================== */

// The 5 built-in roles are still the ones with real baked-in behavior
// (default Permission Matrix grants, Drawing-Request/DPR bypasses, etc.
// — see shared/permissionMatrix.ts and shared/rules.ts). Widened from a
// fixed union to `string` so Masters ▸ Role Master can add further roles
// (e.g. "GM", "Architect") — a custom role starts with zero default
// module access, same as any user with no explicit grant, and is
// assigned access entirely through the Permission Matrix / per-user
// Drawing Request permissions, same system every role already goes
// through for anything beyond its built-in bypasses.
export type Role = string;
export const BUILT_IN_ROLES = ["DRI", "CRM", "CIVIL", "ADMIN", "SUPERVISOR"] as const;
export type Track = "unit" | "floor";
export type Severity = "Critical" | "Major" | "Minor";
export type SnagStatus = "Open" | "In Progress" | "Closed";
export type AssignStatus = "Assigned" | "Accepted" | "Done";
export type StoreMode = "connecting" | "live" | "local" | "offline";

export interface BaseRecord {
  id: string;
  code?: string;
  name?: string;
  active?: boolean;
  [key: string]: unknown;
}

export interface Project extends BaseRecord {
  code: string;
  name: string;
  client?: string;
  location?: string;
  floorCount?: number;
  unitsPerFloor?: number;
  startDate?: string;
  targetDate?: string;
  active?: boolean;
}

export interface Floor extends BaseRecord {
  projectId: string;
  code: string;
  name: string;
  seq: number;
  unitCount?: number;
  active?: boolean;
}

export interface Unit extends BaseRecord {
  projectId: string;
  floorId: string;
  code: string;
  name: string;
  type?: string;
  carpetArea?: number;
  seq?: number;
  active?: boolean;
}

export interface Stage extends BaseRecord {
  code: string;
  name: string;
  track: Track;
  role: Role;
  category?: string;
  seq?: number;
  isGate?: boolean;
  isHidden?: boolean;
  dwg?: string;
  color?: string;
  active?: boolean;
  /** This stage's progress is driven by a sequenced checklist of items
   *  (ack/start/complete/fail per item, inside ONE progress record's
   *  `checklist[]`) rather than a single stage-level status — e.g. RCC,
   *  Brick, AC, Electric, Plastering. See rules.ts's blockReason()/
   *  unitSummary() and useActions.ts's ackStageItem() family. */
  itemBased?: boolean;
}

export interface QParam extends BaseRecord {
  code: string;
  name: string;
  category?: string;
  method?: string;
  acceptance?: string;
  severity: Severity;
  active?: boolean;
}

export interface ChecklistItem {
  id: string;
  paramId: string;
  mandatory?: boolean;
  evidence?: boolean;
  /** RCC sub-item metadata (CHK-RCC only) — carries over what used to be
   *  separate Stage fields when the 13 unit-track stages were merged
   *  into one STG-RCC stage with a 13-item checklist. */
  isGate?: boolean;
  isHidden?: boolean;
  seq?: number;
  /** Nests this item under one more heading level within its parent group
   *  (e.g. "Brick"/"AC"/"Electric"/"Plastering" under RCC) — items without
   *  one render directly under the parent group, same as before. */
  subgroup?: string;
}

export interface Checklist extends BaseRecord {
  code: string;
  name: string;
  stageId: string;
  items?: ChecklistItem[];
  active?: boolean;
}

export interface StageMap extends BaseRecord {
  projectId: string;
  track: Track;
  stageId: string;
  seq: number;
  predecessorId?: string;
  checklistId?: string;
  slaHours?: number;
  active?: boolean;
}

export interface User extends BaseRecord {
  name: string;
  role: Role;
  company?: string;
  phone?: string;
  email?: string;
  /** Manually-entered Slack user id (e.g. "U0123ABCDE") — lets
   *  backend/server.js's slackUserIdForEmail() skip the live email
   *  lookup when present. Optional; falls back to email lookup as
   *  before when absent. */
  slackId?: string;
  /** Which team (see Team below) this person belongs to — one team per
   *  person, same pattern as `role`. Optional. */
  teamId?: string;
  /** Restricts which projects this person can see/pick anywhere in the
   *  app (project pickers, Tower Board, Dashboard, Raise Snag/Assign
   *  Work's Project field, etc.) — undefined/empty means unrestricted
   *  (sees every active project), same as before this field existed. */
  projectIds?: string[];
  active?: boolean;
}

/** A group of users under one Team Leader — Masters ▸ Teams manages
 *  these; membership is the reverse side, `User.teamId`, not a
 *  memberIds array here, so there's one source of truth to keep in
 *  sync. */
export interface Team extends BaseRecord {
  name: string;
  leaderId?: string;
  // Restricts membership to one Role (built-in or custom, e.g. "Execution")
  // — set so a team meant for one role can never silently pick up a member
  // of a different role (AddUser.tsx only offers teams matching the user's
  // own role, and the team-roster views filter on it too, defensively).
  // Omitted/undefined = unrestricted, matching every team created before
  // this field existed.
  role?: string;
  active?: boolean;
}

/** Vendor/Contractor master, migrated from VMS — code/name/work types
 *  only, no financial or KYC fields (those stay in VMS). Backs DprForm's
 *  contractor dropdown so every VMS contractor shows up here even before
 *  their first DPR. */
export interface Vendor extends BaseRecord {
  vendorCode: string;
  vendorName: string;
  shortCode?: string;
  workTypes?: string[];
  status?: "active" | "inactive";
  source?: string;
}

export interface Photo {
  url: string;
  publicId?: string | null;
}

export interface Snag extends BaseRecord {
  projectId: string;
  unitId?: string;
  floorId?: string;
  stageId: string;
  /** Which CHK-RCC checklist item this snag targets, when
   *  stageId === "STG-RCC" — omitted for Internal/Owner Handover. */
  itemId?: string;
  paramId?: string;
  title: string;
  description?: string;
  severity: Severity;
  status: SnagStatus;
  raisedBy: string;
  raisedAt: number;
  assignedTo: string;
  /** Who last reassigned this snag's `assignedTo`, and when — set by
   *  saveSnagAssignee() in useActions.ts. Powers My Work's "Assigned by me"
   *  section (Snag has no separate `assignedBy` at raise-time like
   *  Assignment does, so this is the only "who handed this to whom" trail). */
  lastReassignedBy?: string | null;
  lastReassignedAt?: number | null;
  dueAt?: number | null;
  closedAt?: number | null;
  closedBy?: string | null;
  /** How many times this snag has been reopened after being Closed, and
   *  when/by whom the most recent reopen happened — set by setSnagStatus()
   *  in useActions.ts, never by the generic status toggle alone. */
  reopenCount?: number;
  reopenedAt?: number | null;
  reopenedBy?: string | null;
  photos?: Photo[];
  comments?: unknown[];
  // Set only for a snag auto-created from a failed Work Quality Inspection
  // (see QualityInspection.linkedSnagId, the reverse pointer) — omitted for
  // every other snag source (QC gate checklist failures, manually raised).
  qualityInspectionId?: string | null;
}

export interface Assignment extends BaseRecord {
  projectId: string;
  targetType: Track;
  targetId: string;
  stageId: string;
  /** Which CHK-RCC checklist item this assignment targets, when
   *  stageId === "STG-RCC" — omitted for Internal/Owner Handover. */
  itemId?: string;
  assignedTo: string;
  assignedBy: string;
  assignedAt: number;
  dueAt?: number | null;
  status: AssignStatus;
  note?: string;
  doneAt?: number;
  doneBy?: string;
}

export type ProgressStatus = "released" | "ack" | "wip" | "done" | "fail";

export interface ProgressHistoryEntry {
  status: ProgressStatus;
  ts: number;
  by?: string;
}

export interface ProgressPatch {
  status?: ProgressStatus;
  rel?: number;
  ack?: number;
  start?: number;
  at?: number;
  by?: string;
  note?: string | null;
  meas?: number;
  measBy?: string;
  photo?: Photo;
  checklistId?: string;
  checklist?: {
    paramId: string; result: string; remark: string;
    /** Present only for room-wise (possession) checklists — per-room
     *  breakdown behind the single rolled-up `result` above. */
    cells?: { room: string; result: "pass" | "fail" | "na" }[];
    /** Evidence photo for this item, if the checklist required one. */
    photo?: Photo;
    /** RCC sub-item lifecycle (STG-RCC only) — each item progresses
     *  through the same released->ack->wip->done/fail states a whole
     *  stage used to, tracked per-item instead of per-stage-record now
     *  that the 13 unit-track stages live as one STG-RCC checklist. */
    itemId?: string;
    status?: ProgressStatus;
    rel?: number; ack?: number; start?: number; at?: number; by?: string;
    meas?: number; measBy?: string;
    note?: string | null;
  }[];
  /** Free-text note attached to a possession-checklist submission
   *  (HandoverChecklist.tsx) — separate from `note`, which holds the
   *  auto-generated "N parameter(s) failed" summary. */
  remarks?: string;
  /** A photo of the owner, captured at the end of the Owner Possession
   *  (STG-HOO) form as proof-of-handover — separate from any per-item
   *  evidence photos, and only ever set on that one stage. */
  ownerPhoto?: Photo;
  /** Every status transition this stage instance has ever gone through, oldest
   *  first — never trimmed on rework. `rel`/`ack`/`start`/`at` above only ever
   *  hold the LATEST cycle's timestamps (each write shallow-merges over the
   *  previous one), so a fail -> rework -> done stage silently loses its
   *  earlier cycle's timing there. This log is the only durable source for
   *  full cycle-time/SLA reporting across rework. */
  history?: ProgressHistoryEntry[];
}

export interface EventLog {
  ts: number;
  userId: string;
  action: string;
  targetId: string;
  stageId: string;
  detail: string;
}

/* ------------------------------------------------ Daily Progress Report */

export type ShiftType = "Day" | "Night";

export interface DprWorkEntry {
  category: string;
  generalPhotos: Photo[];
  beforePhotos: Photo[];
  afterPhotos: Photo[];
  // Quantity of work actually done today against this category — optional,
  // since not every category has a meaningful unit of measure. Feeds the
  // report page's "Work Progress — Planned vs Completed" table by summing
  // against WorkTarget.plannedQty for the same project+category.
  qty?: number;
  unit?: string;
}

export interface DailyProgressReport extends BaseRecord {
  projectId: string;
  projectName: string;
  submittedByUserId: string | null;
  submittedByName: string;
  date: string;
  vendorCode: string;
  vendorName: string;
  shift: ShiftType;
  labourCount: number;
  workEntries: DprWorkEntry[];
  isPublic: boolean;
}

/* A one-time-set target, per project+category, that Daily Progress Report
   submissions' qty entries are measured against. Deliberately NOT a full
   Work Order/contract system (no vendor/scope-item/billing concepts) —
   just enough for a Planned vs Completed rollup on the DPR report page. */
export interface WorkTarget extends BaseRecord {
  projectId: string;
  category: string;
  unit: string;
  plannedQty: number;
  active?: boolean;
}

/* -------------------------------------------------------- Drawing Requests */

export type DrawingType = "Architectural" | "Structural" | "MEP" | "Civil" | "Interior" | "Landscape" | "Shop Drawing" | "As-Built" | "Other";
export type DrawingSource = "Site Visit" | "RFI" | "Client Request" | "Internal Review" | "Other";
export type ReviewStage = "stage-1-screen" | "stage-2-produce" | "stage-3-crosscheck" | "stage-4-final-approve" | "approved" | "returned";
export type ReviewAction = "forwarded" | "submitted" | "approved" | "returned" | "resubmitted";
export type TrackingStatus = "pending" | "committed" | "completed" | "delayed";
export type DrawingPriority = "low" | "medium" | "high" | "urgent";

export interface ReviewHistoryEntry {
  stage: ReviewStage;
  action: ReviewAction;
  by: string | null;
  byName?: string;
  at: number;
  remarks?: string;
}

export interface DrawingFile {
  name: string;
  url: string;
}

export interface DrawingRequest extends BaseRecord {
  ticketNo: string;
  createdAt: number;
  projectId: string;
  projectName: string;
  description: string;
  drawingType: DrawingType;
  source?: DrawingSource | "";
  requesterName: string;
  requestedPriority?: DrawingPriority | ""; // requester's hint at creation — the functional `priority` below is still only set at Stage 4 approval, per spec
  reviewStatus: ReviewStage;
  reviewHistory: ReviewHistoryEntry[];
  files: DrawingFile[];
  assignedTo?: string | null;
  committedDate?: string | null;
  priority?: DrawingPriority | "";
  trackingStatus?: TrackingStatus | "";
  actualCompletionDate?: string | null;
  planningVerified: boolean;
  projectAcknowledged: boolean;
  remarks?: string;
  submittedByUserId: string | null;
  isPublic: boolean;
}

/* ----------------------------------------------- fine-grained permissions */

export interface UserPermission extends BaseRecord {
  userId: string; // ref -> users, separate from this record's own generated id
  canScreenStage1?: boolean;
  canProduceStage2?: boolean;
  canCrosscheckStage3?: boolean;
  canFinalApproveStage4?: boolean;
}

export type ModuleAction = "view" | "create" | "edit" | "delete";

/* One doc per user, admin-managed via pages/PermissionMatrix.tsx — grants
   are ADDITIVE on top of the Role enum (see shared/permissionMatrix.ts):
   they only ever unlock extra access beyond what myRole()==="ADMIN"/canAct()
   already give, never take anything away. */
export interface ModuleGrant extends BaseRecord {
  userId: string; // ref -> users
  roleLabel?: string; // cosmetic display label only, not a real Role
  grants: Record<string, Partial<Record<ModuleAction, boolean>>>; // keyed by MATRIX_MODULES[].key
}

/** Custom role, created via Masters ▸ Role Master — the 5 built-in roles
 *  (BUILT_IN_ROLES above) aren't stored here; this collection only holds
 *  ones an Admin added beyond those. `id` doubles as the role's name/value
 *  stored on User.role (e.g. "GM"), since this app has no separate
 *  role-code vs. role-label concept anywhere else. */
export interface RoleDef extends BaseRecord {
  name: string;
  active?: boolean;
  // Role-wide default grants — every user with this custom role gets these
  // unless a per-user ModuleGrant record overrides a specific module+action
  // (same additive precedence as DEFAULT_ROLE_GRANTS for the 5 built-in
  // roles, see shared/permissionMatrix.ts's hasModuleGrant()).
  grants?: Record<string, Partial<Record<ModuleAction, boolean>>>;
  // Role-wide defaults for the Drawing Requests review chain — same 4
  // stage flags as the per-user `permissions` collection (see
  // shared/permissions.ts's canActOnStage), checked as a fallback when the
  // user has no explicit per-user grant for that stage. Additive only,
  // same as module grants — never a role-based bypass like DRI's.
  canScreenStage1?: boolean;
  canProduceStage2?: boolean;
  canCrosscheckStage3?: boolean;
  canFinalApproveStage4?: boolean;
  // true = this record only stores a Permission Matrix ▸ Role-wise override
  // for one of the 5 BUILT_IN_ROLES (keyed by `name`), not a real selectable
  // custom role — kept out of Masters ▸ Role Master's list and AddUser's
  // role dropdown.
  builtin?: boolean;
}

export type CustomFormFieldType = "text" | "textarea" | "number" | "date" | "select" | "multiselect" | "bool";

export interface CustomFormField {
  key: string;
  label: string;
  type: CustomFormFieldType;
  required?: boolean;
  options?: string[]; // for type "select" / "multiselect"
  // Custom labels for type "bool" — defaults to "Yes"/"No" when unset.
  yesLabel?: string;
  noLabel?: string;
  // Only for type "multiselect" — once an option is checked, show Work/
  // Before/After photo upload groups for it (same pattern as the Daily
  // Progress Report's per-category evidence, components/PhotoGroupUploader).
  photoEvidence?: boolean;
  // Only meaningful when photoEvidence is on — minimum total photos (across
  // Work/Before/After combined) required per selected item before submit is
  // allowed. 0 or unset = fully optional.
  minPhotos?: number;
}

/* Admin-built custom form, created via Masters ▸ Form Master — a generic
   "Google-Forms-style" definition, not tied to any specific module. Can be
   reached both as a standalone no-login page (routes/publicRoutes.tsx,
   /forms/<id>, when isPublic) and from inside the app by any logged-in
   user (Masters ▸ Form Master ▸ Fill form) — the same field-rendering UI
   either way, see components/CustomFormFill.tsx. */
export interface CustomFormDef extends BaseRecord {
  name: string;
  description?: string;
  active?: boolean;
  isPublic?: boolean;
  fields: CustomFormField[];
}

export interface CustomFormSubmission extends BaseRecord {
  formId: string;
  // Loose on purpose — a "select"/"bool" field's value is a plain string/
  // boolean, a "multiselect" field's is a string[], and a "multiselect"
  // field with photoEvidence stores its per-option photos under a sibling
  // key (`${field.key}__photos`) as Record<option, {work,before,after}[]>.
  values: Record<string, any>;
  submittedAt: number;
  submittedByUserId?: string | null;
  isPublic?: boolean;
}

export type QualityInspectionResult = "Pass" | "Fail" | "Rework Required";

/* Anchored to QC's own real Project->Floor->Unit (the same ids Tower Board/
   Handover Checklist use — projectId/floorId/unitId), NOT to a VMS Work
   Order/scope-item. A VMS Work Order has no reliable key back to a QC Unit:
   QC's Unit model has no "tower" concept at all (one QC Project already IS
   one building), while VMS's progressEntries carry free-text tower/floor/
   flatNo typed per entry with no fixed format — so a QC Unit can never be
   safely auto-matched to a VMS scope-item/location. The VMS reference
   (workOrderNo/itemId/...) is therefore kept OPTIONAL and always a manual,
   explicit pick from the Work Quality Inspection / Unit Execution Workflow
   page's VMS item list — never auto-matched, never required. Deliberately
   NOT inferred from DPR qty, checklist completion, floor status, or snag
   status — per the read-only audit this session, none of those are a
   reliable quality signal for a specific executed quantity, so this is
   QC's own, independent record. */
/* Team-leader approval of a team member's inspection / measurement — a
   review flag only (changes no billing, quality status or production
   record). Set by the SERVER on save (backend/approvalRules.js): a record by
   a team member is created "pending" with the team leader as approver; only
   that leader (or Admin) can approve/reject it, never its author. Rejected
   work stays rejected with the remark and the member records a new one.
   Absent = no approval needed (Admin, a team leader, someone on no team, or
   a record from before this existed). */
export interface Approval {
  status: "pending" | "approved" | "rejected";
  approverUserId: string;
  approverName?: string;
  decidedByUserId?: string;
  decidedAt?: number;
  remark?: string;
}

export interface QualityInspection extends BaseRecord {
  projectId: string;
  projectCode: string;
  projectName: string;
  floorId: string;
  floorName: string;
  // Inspections are now recorded at Floor granularity, not per flat/unit —
  // these are kept optional (never written by the current form) only so
  // older records that do have a unit stay displayable/filterable.
  unitId?: string;
  unitCode?: string;
  unitName?: string;
  // The physical QA/QC checklist being inspected against (one of
  // QC_CHECKLISTS' keys in QualityInspection.tsx) — denormalized per-item
  // text + OK/Not OK/N/A status, same pattern as itemDescription elsewhere:
  // the checklist content is reference data, snapshotted at save time so a
  // later edit to the master list never silently rewrites a past record.
  workType?: string;
  contractor?: string;
  // Which of the floor's (fixed) 60 structural columns this inspection
  // covers — only meaningful when workType is "Column Inspection".
  columns?: string[];
  // Which of the floor's (up to 10, or a shared custom-typed one — see
  // CustomSlabName below) RCC slabs this inspection covers — only
  // meaningful when workType is "R.C.C. Slab Inspection".
  slabs?: string[];
  checklistItems?: { text: string; status: "OK" | "Not OK" | "N/A"; remarks?: string }[];
  // Optional, manually-picked reference to a real VMS scope-item/sub-item —
  // never auto-matched to the Unit above. See the interface doc comment.
  workOrderNo?: string;
  itemId?: string;
  itemType?: "scopeItem" | "subItem";
  itemDescription?: string; // denormalized at pick time — VMS's own description, read-only reference
  unit?: string;
  inspectionDate: string; // "YYYY-MM-DD"
  result: QualityInspectionResult;
  remarks?: string; // required by the UI (not the schema) when result !== "Pass"
  photos: Photo[];
  inspectorUserId: string;
  inspectorName: string;
  // Who's responsible and by when — display-only context. The actual
  // open/in-progress/closed state is never duplicated here: it lives on the
  // linked Snag (linkedSnagId) below, which is the single source of truth
  // reused from the existing Snag/DRI/notification system.
  correctiveAction?: {
    assignedToUserId: string;
    assignedToName: string;
    targetDate: string;
  } | null;
  // The real Snag auto-created for a Fail/Rework result — reuses the
  // existing Snag collection, DRI assignment/notification, and My
  // Work/DRI-dashboard surfacing wholesale instead of re-building a
  // parallel one. Created exactly once per failed inspection, at creation
  // time only (inspections are never edited after save, only re-inspected
  // as a brand-new record) — this is what prevents duplicate snags for the
  // same failed inspection.
  linkedSnagId?: string | null;
  // Set when this inspection re-checks a prior Fail/Rework record — a
  // passing result here closes that original's linked Snag server-side
  // (server.js), closing the loop instead of leaving it open forever once
  // the issue is actually fixed.
  reInspectionOf?: string | null;
  approval?: Approval;
  createdAt: number;
}

/* Unit Execution Workflow, measurement step — anchored to the same real QC
   Project->Floor->Unit as QualityInspection (see that interface's doc
   comment for why a VMS Work Order/scope-item can't be the anchor).
   Deliberately independent of QualityInspection's result: a measurement is
   never inferred FROM an inspection (or vice versa) — they're two separate
   real signals, linked only by an optional reference, per the "never
   equate reported execution with independently verified measurement" rule
   this was built under. `storeOutwardRef` is a stable, currently-unused
   placeholder reserved for the deferred Store integration phase — never
   read or written to by anything today, just a reserved column so that
   future phase doesn't need a schema migration to add it. */
export interface MaterialMeasurement extends BaseRecord {
  projectId: string;
  projectCode: string;
  projectName: string;
  floorId: string;
  floorName: string;
  unitId: string;
  unitCode: string;
  unitName: string;
  // Optional, manually-picked reference to a real VMS scope-item/sub-item —
  // never auto-matched to the Unit above.
  workOrderNo?: string;
  itemId?: string;
  itemType?: "scopeItem" | "subItem";
  itemDescription?: string;
  // True when the person typed a work item that isn't in VMS — itemDescription
  // is then their own text and there is no workOrderNo / itemId.
  itemIsCustom?: boolean;
  measurementDate: string; // "YYYY-MM-DD"
  measuredQty: number;
  measuredUnit: string;
  materialConsumedQty: number;
  materialUnit: string;
  unusedBalanceQty: number;
  wastageQty: number;
  remarks?: string;
  qualityInspectionId?: string | null; // optional link to a QualityInspection on the same unit — never assumed, always explicit
  storeOutwardRef?: string | null; // reserved, unused — see doc comment above
  // Reserved placeholder for the planned IMS (Inventory Management System)
  // integration — a Purchase Order reference, same pattern as
  // storeOutwardRef above: never read or written to until the real IMS
  // connection/schema is confirmed (read-only audit first, same as every
  // other external integration in this app), so this never holds a
  // fabricated or guessed value.
  purchaseOrderRef?: string | null;
  recordedByUserId: string;
  recordedByName: string;
  approval?: Approval;
  createdAt: number;
}

/* Measurement module — an independently measured quantity for one Work
   Category at one location, entered WITHOUT a Work Order number. Reference-
   only: it never changes billing, approvals, quality statuses or VMS
   production records. The `linked*` fields are set by the SERVER from live
   VMS data (backend/workMeasurementRules.js), never trusted from the client:
     auto       — exactly one VMS scope item matched (category + location)
     confirmed  — several matched and a person chose one
     ambiguous  — several matched, no choice yet (unlinked, needs confirming)
     unmatched  — nothing in VMS matched (unlinked); linkNote says why */
export type WorkMeasurementLinkStatus = "auto" | "confirmed" | "ambiguous" | "unmatched";
export interface WorkMeasurement extends BaseRecord {
  projectId: string;
  projectCode: string;
  projectName: string;
  location: { tower?: string; floor?: string; flat?: string; area?: string };
  category: string; // a VMS category name, e.g. "Plastering work"
  measurementDate: string; // "YYYY-MM-DD"
  measuredQty: number;
  measuredUnit: string;
  dimensions?: { length?: number; width?: number; height?: number; thickness?: number };
  photos: Photo[];
  remarks?: string;
  recordedByUserId: string;
  recordedByName: string;
  createdAt: number;
  linkStatus?: WorkMeasurementLinkStatus;
  linkNote?: string | null;
  linkedWorkOrderNo?: string | null;
  linkedItemId?: string | null;
  linkedItemType?: "scopeItem" | "subItem" | null;
  linkedItemDescription?: string | null;
  linkedItemUnit?: string | null;
  approval?: Approval;
}

/* Synced from IMS's PO lifecycle webhook (backend/imsWebhook.js sanitizes
   the raw event before it ever reaches this collection) — deliberately a
   narrow, non-financial subset: no vendor GST/PAN/bank details, no payment
   amounts, none of which has a legitimate reason to live in QC (approval
   level status is kept — it's workflow state, not financial). IMS
   references a project by NAME only (no shared code like VMS has), so
   `projectId`/`projectCode` are null whenever that name didn't exactly
   match a real QC project — shown as "Unmatched" in the UI, never guessed
   via a fuzzy/partial match. Not linked to a specific Work Order or
   scope-item: IMS's PO payload has no such reference, so this is shown at
   the project level only. `deleted` is a soft-delete flag (IMS's Recycle
   Bin / permanent delete) — the record is kept, never removed, so a later
   restore event can un-delete it without re-sending the full payload. */
export interface PurchaseOrder extends BaseRecord {
  projectId: string | null;
  projectCode: string | null;
  projectNameRaw: string; // IMS's own project name, as sent — kept even when unmatched, so it's never silently dropped
  deleted: boolean;
  phase?: string;
  workType?: string;
  milestone?: string;
  vendorName?: string;
  status: string; // IMS's own status string (e.g. "Approved", "GRN Fulfilled") — not re-interpreted
  priority?: string;
  date?: string;
  deliveryDate?: string;
  items: { itemName: string; sku: string; category: string; qty: number; unit: string }[];
  approvals?: { l1: { status: string; at: string | null } | null; l2: { status: string; at: string | null } | null; l3: { status: string; at: string | null } | null } | null;
  remark?: string;
  sourceUpdatedAt?: number | null; // IMS's own data.updatedAt, epoch ms — used server-side to drop stale/reordered webhook deliveries
  receivedAt: number;
}

export interface BoardData {
  projects: Project[];
  floors: Floor[];
  units: Unit[];
  stages: Stage[];
  qparams: QParam[];
  checklists: Checklist[];
  stagemap: StageMap[];
  users: User[];
  snags: Snag[];
  assignments: Assignment[];
  dpr: DailyProgressReport[];
  drawingRequests: DrawingRequest[];
  permissions: UserPermission[];
  workTargets: WorkTarget[];
  moduleGrants: ModuleGrant[];
  teams: Team[];
  vendors: Vendor[];
  roles: RoleDef[];
  forms: CustomFormDef[];
  formSubmissions: CustomFormSubmission[];
  qualityInspections: QualityInspection[];
  materialMeasurements: MaterialMeasurement[];
  workMeasurements: WorkMeasurement[];
  purchaseOrders: PurchaseOrder[];
  teamDailyReports: TeamDailyReport[];
  customSlabNames: CustomSlabName[];
  progress: Record<string, ProgressPatch>;
  events: EventLog[];
  [key: string]: unknown;
}

/** One Team's end-of-day activity summary (Masters ▸ Teams), generated
 *  server-side once per team per date (see backend/teamDailyReports.js) and
 *  signed off by the team's own leader from their dashboard — the sign-off
 *  is a record only; it doesn't block or gate anything else. */
export interface TeamDailyReport extends BaseRecord {
  teamId: string;
  teamName: string;
  date: string; // YYYY-MM-DD, IST
  generatedAt: number;
  members: {
    userId: string;
    userName: string;
    assignmentsDone: number;
    snagsClosed: number;
    qualityInspections: number;
    measurementsRecorded: number;
  }[];
  totals: { assignmentsDone: number; snagsClosed: number; qualityInspections: number; measurementsRecorded: number };
  status: "Pending" | "Approved";
  approvedByUserId?: string | null;
  approvedByName?: string | null;
  approvedAt?: number | null;
}

/** A slab name typed via Select Slabs' "Custom…" option, saved once so
 *  every future inspector sees it too instead of just the one inspection
 *  that introduced it — same idea as the Vendor master, just much smaller. */
export interface CustomSlabName extends BaseRecord {
  name: string;
}

export type CollectionName = keyof Omit<BoardData, "progress" | "events">;

export type Op =
  | { op: "upsert"; coll: CollectionName; rec: BaseRecord }
  | { op: "delete"; coll: CollectionName; id: string }
  | { op: "progress"; key: string; patch: Partial<ProgressPatch> }
  | { op: "event"; ev: EventLog };

export type TabKey = "dash" | "misDashboard" | "executionReconciliation" | "qualityInspection" | "qualityFails" | "unitExecutionWorkflow" | "measurement" | "progressAnalysis" | "purchaseOrders" | "work" | "board" | "handoverChecklist" | "handoverInternal" | "handoverOwner" | "snags" | "team" | "masters" | "addUser" | "dpr" | "drawingRequests" | "backups" | "auditLog" | "permissionMatrix";
export type MasterKey = "projects" | "floors" | "units" | "stages" | "qparams" | "checklists" | "stagemap" | "users" | "permissions" | "workTargets" | "teams" | "roles" | "forms";

export type FieldType = "text" | "number" | "date" | "color" | "select" | "ref" | "bool" | "textarea" | "items" | "password" | "permissionGrid" | "formFields";

export interface MasterField {
  k: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  options?: string[];
  coll?: MasterKey;
  default?: boolean; // only used for type "bool" — new-record default (falls back to true if omitted)
}

export interface MasterDef {
  label: string;
  icon: string;
  prefix: string;
  desc: string;
  cols: string[];
  fields: MasterField[];
}

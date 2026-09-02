/* ===========================================================================
   Shared data-model types. Mirrors the shapes already produced by
   backend/seed.js and read/written by backend/server.js — nothing here
   changes the wire format, it just names it.
   =========================================================================== */

export type Role = "DRI" | "EXE" | "MEP" | "FIN" | "QC" | "MEAS";
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
  active?: boolean;
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
}

export interface Assignment extends BaseRecord {
  projectId: string;
  targetType: Track;
  targetId: string;
  stageId: string;
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
  checklist?: { paramId: string; result: string; remark: string }[];
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
  progress: Record<string, ProgressPatch>;
  events: EventLog[];
  [key: string]: unknown;
}

export type CollectionName = keyof Omit<BoardData, "progress" | "events">;

export type Op =
  | { op: "upsert"; coll: CollectionName; rec: BaseRecord }
  | { op: "delete"; coll: CollectionName; id: string }
  | { op: "progress"; key: string; patch: Partial<ProgressPatch> }
  | { op: "event"; ev: EventLog };

export type TabKey = "dash" | "work" | "board" | "snags" | "team" | "masters" | "dpr" | "drawingRequests" | "backups";
export type MasterKey = "projects" | "floors" | "units" | "stages" | "qparams" | "checklists" | "stagemap" | "users" | "permissions";

export type FieldType = "text" | "number" | "date" | "color" | "select" | "ref" | "bool" | "textarea" | "items";

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

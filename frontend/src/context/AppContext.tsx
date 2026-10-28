import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BoardData, Op, Role, StoreMode, TabKey, MasterKey, User } from "../types";
import { API_BASE } from "../services/config";
import { byId, coll } from "../shared/rules";
import { classifyStatus, flushQueue, newBatchId, normalizeQueue, tokenUserId, type QueuedBatch } from "../shared/opQueue";
import { judgeStateResponse, needsFullBoardAfterLogin } from "../shared/stateSync";
import { applyOpsLocal, scrubLocalBoard } from "../shared/applyOpsLocal";
import { buildEventOp } from "../shared/eventLog";

// Human label for the MODULE_VIEW audit event's detail text — purely
// cosmetic (Audit Logs still groups by the raw TabKey), so an entry
// missing here just falls back to the bare key rather than breaking anything.
const TAB_VIEW_LABEL: Partial<Record<TabKey, string>> = {
  dash: "Dashboard", misDashboard: "Quality MIS", userMis: "Users MIS",
  executionReconciliation: "Execution Reconciliation", qualityInspection: "Quality Inspection",
  qualityFails: "Fail Register", caseStudies: "Case Studies", unitExecutionWorkflow: "Measurement (Unit)",
  measurement: "Measurement", progressAnalysis: "Progress Analysis", purchaseOrders: "Purchase Orders",
  work: "My Work", board: "Tower Board", handoverChecklist: "Handover Checklist",
  handoverInternal: "Handover Checklist — Internal", handoverOwner: "Handover Checklist — Owner",
  snags: "Snags", team: "Team", masters: "Masters", addUser: "Add User", dpr: "Daily Progress Report",
  drawingRequests: "Drawing Requests", backups: "Backups", auditLog: "Audit Logs", permissionMatrix: "Permission Matrix"
};
import { addRejected, parseRejected, REJECTED_KEY } from "../shared/rejected";

const LS_KEY = "neoteric_board_v5";
const SESSION_KEY = "neoteric_session";
const TOKEN_KEY = "neoteric_token";
const PENDING_OPS_KEY = "neoteric_pending_ops";

// Whose token is currently stored (null when signed out) — used to stop a
// queued batch made by one person being replayed under another's session.
function currentTokenUser(): string | null {
  try { return tokenUserId(localStorage.getItem(TOKEN_KEY)); } catch { return null; }
}

// Every board fetch carries the session token when there is one, so the server can tell a signed-in user
// from an anonymous caller (public forms / sign-in screen), who may be given a reduced public snapshot.
async function fetchBoard(): Promise<any> {
  const r = await fetch(API_BASE + "/api/state", { cache: "no-store", headers: authHeaders() });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

export function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: "Bearer " + token } : {};
  } catch {
    return {};
  }
}

/* Every background poll re-downloads the ENTIRE state blob (every
 * collection, full documents) as a fresh JSON.parse, so a plain `setData`
 * hands every collection array a brand-new reference even when nothing in
 * it changed — forcing every `useMemo(..., [data])` across the app (DRI
 * score, MIS dashboard, etc.) to recompute on every single poll tick that
 * picked up ANYONE's unrelated write. Reusing the previous array reference
 * per-collection when its content is unchanged lets those memos actually
 * skip recomputation. Cheap: runs once per poll (every 5s, only when the
 * revision changed), not on every render. */
function mergeStableCollections(prev: BoardData | null, next: BoardData): BoardData {
  if (!prev) return next;
  const merged: any = { ...next };
  for (const key of Object.keys(next) as (keyof BoardData)[]) {
    const prevVal = (prev as any)[key];
    const nextVal = (next as any)[key];
    if (prevVal !== undefined && prevVal !== nextVal && JSON.stringify(prevVal) === JSON.stringify(nextVal)) {
      merged[key] = prevVal;
    }
  }
  return merged;
}

interface DrawerRef { kind: "unit" | "floor" | "snag" | "user"; id: string }

export interface AssignModalState { targetType: "unit" | "floor"; targetId: string; stageId: string; itemId?: string; presetUser?: string; projectId?: string }
export interface SnagModalState { unitId: string; stageId: string; itemId?: string; preset?: string }
export interface ChecklistModalState { kind: "unit" | "floor"; id: string; stageId: string; itemId?: string; checklistId: string }
export interface RecordModalState { master: MasterKey; id: string | null }

interface AppContextValue {
  data: BoardData | null;
  rev: number;
  mode: StoreMode;
  // Count of changes saved locally but not yet confirmed on the server —
  // see PendingSyncBadge. 0 once everything's synced.
  pendingCount: number;
  // Changes the server REFUSED, kept in this browser so they can be re-entered (see RejectedChangesBadge)
  rejectedCount: number;
  clearRejected: () => void;
  loggedIn: boolean;
  currentUserId: string | null;
  currentProjectId: string | null;
  activeTab: TabKey;
  activeMaster: MasterKey;
  drawer: DrawerRef | null;
  toastMsg: string | null;
  assignModal: AssignModalState | null;
  snagModal: SnagModalState | null;
  checklistModal: ChecklistModalState | null;
  recordModal: RecordModalState | null;
  // One-shot "open this exact Drawing Request's detail modal" request — set
  // by a dashboard's "Waiting on you" row before switching to the Drawing
  // Requests tab, consumed (and cleared) by that page on mount so a direct
  // link from the dashboard doesn't just land on the unfiltered list.
  openDrawingRequestId: string | null;
  // Same one-shot pattern as openDrawingRequestId above, for "Re-inspect
  // this exact failed inspection" from a dashboard's Recent Inspections
  // row — consumed (and cleared) by QualityInspection.tsx on mount.
  reInspectQualityId: string | null;
  // Same one-shot pattern, for "Write up as Case Study" from a Fail
  // Register row — pre-fills Case Studies' New form with that inspection's
  // project/floor/category and links back to it. Consumed (and cleared) by
  // CaseStudies.tsx on mount.
  caseStudyDraft: { projectId?: string; floorId?: string; category?: string; linkedInspectionId: string } | null;

  setCurrentUserId: (id: string) => void;
  setCurrentProjectId: (id: string) => void;
  setActiveTab: (t: TabKey) => void;
  setActiveMaster: (m: MasterKey) => void;
  openDrawer: (ref: DrawerRef) => void;
  closeDrawer: () => void;
  openAssignModal: (s: AssignModalState) => void;
  closeAssignModal: () => void;
  openSnagModal: (s: SnagModalState) => void;
  closeSnagModal: () => void;
  openChecklistModal: (s: ChecklistModalState) => void;
  closeChecklistModal: () => void;
  openRecordModal: (s: RecordModalState) => void;
  closeRecordModal: () => void;
  setOpenDrawingRequestId: (id: string | null) => void;
  setReInspectQualityId: (id: string | null) => void;
  setCaseStudyDraft: (d: AppContextValue["caseStudyDraft"]) => void;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  toast: (msg: string) => void;
  // Resolves true once the change actually reached the server, false if it
  // was only queued (offline) or rejected — see apply()'s own comment.
  apply: (ops: Op[]) => Promise<boolean>;

  me: () => User | null;
  myRole: () => Role;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

const LOGIN_GATE_ENABLED = true;

export function AppProvider({ children, publicRoute = false }: { children: React.ReactNode; publicRoute?: boolean }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [rev, setRev] = useState(0);
  const [mode, setMode] = useState<StoreMode>("connecting");
  const [currentUserId, setCurrentUserIdState] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dash");
  const [activeMaster, setActiveMaster] = useState<MasterKey>("projects");
  const [drawer, setDrawer] = useState<DrawerRef | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(!LOGIN_GATE_ENABLED);
  const [assignModal, setAssignModal] = useState<AssignModalState | null>(null);
  const [snagModal, setSnagModal] = useState<SnagModalState | null>(null);
  const [checklistModal, setChecklistModal] = useState<ChecklistModalState | null>(null);
  const [recordModal, setRecordModal] = useState<RecordModalState | null>(null);
  const [openDrawingRequestId, setOpenDrawingRequestId] = useState<string | null>(null);
  const [reInspectQualityId, setReInspectQualityId] = useState<string | null>(null);
  const [caseStudyDraft, setCaseStudyDraft] = useState<AppContextValue["caseStudyDraft"]>(null);

  const dataRef = useRef<BoardData | null>(null);
  dataRef.current = data;
  const revRef = useRef(0);
  revRef.current = rev;
  const modeRef = useRef<StoreMode>("connecting");
  modeRef.current = mode;

  const toast = useCallback((msg: string, ms: number = 2600) => {
    setToastMsg(msg);
    window.clearTimeout((toast as any)._t);
    (toast as any)._t = window.setTimeout(() => setToastMsg(null), ms);
  }, []);

  // A save that did NOT reach the server (refused, queued, offline) shows its own explanation, and a page that then
  // says "Saved!" in the same tick used to overwrite it (only the last toast is shown) — so the person believed a
  // refused change was saved. The toast pages get from the context therefore stays silent for a moment after such a
  // failure, leaving the explanation on screen. (Only 2 of ~58 call sites check apply()'s result.)
  const applyFailedAtRef = useRef(0);
  const markApplyFailed = useCallback(() => { applyFailedAtRef.current = Date.now(); }, []);
  const pageToast = useCallback((msg: string) => {
    if (Date.now() - applyFailedAtRef.current < 2000) return;
    toast(msg);
  }, [toast]);
  // Keeps a change the server refused (without any plaintext password) so typed-in data is not simply gone.
  const [rejectedCount, setRejectedCount] = useState<number>(() => { try { return parseRejected(localStorage.getItem(REJECTED_KEY)).length; } catch { return 0; } });
  const rememberRejected = useCallback((ops: Op[], error: string) => {
    try {
      const list = addRejected(localStorage.getItem(REJECTED_KEY), ops, error);
      localStorage.setItem(REJECTED_KEY, JSON.stringify(list));
      setRejectedCount(list.length);
    } catch {}
  }, []);
  const clearRejected = useCallback(() => { try { localStorage.removeItem(REJECTED_KEY); } catch {} setRejectedCount(0); }, []);

  // Public pages (/dpr/new, /forms/…) are served the allow-listed public snapshot; everywhere else a public
  // snapshot means the session expired (see shared/stateSync.ts). Returns whether to use the response.
  const publicRouteRef = useRef(publicRoute);
  // Was the latest state response the reduced public snapshot? (null = none seen yet) Decides whether sign-in must re-fetch the board.
  const lastStatePublicRef = useRef<boolean | null>(null);
  const acceptState = useCallback((s: any): boolean => {
    if (s) lastStatePublicRef.current = !!s.public;
    let hasToken = false;
    try { hasToken = !!localStorage.getItem(TOKEN_KEY); } catch {}
    const v = judgeStateResponse(s, { publicRoute: publicRouteRef.current, hasToken, haveBoard: !!dataRef.current });
    if (v.sessionExpired) {
      try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(TOKEN_KEY); } catch {}
      setLoggedIn(false);
      toast("Your session expired — please sign in again");
    }
    return v.use;
  }, [toast]);

  // This writes the ENTIRE board (every collection) to localStorage — it's
  // only ever read back as a best-effort "show something" fallback for a
  // cold app load with zero connectivity (see the initial-load effect
  // below); it has nothing to do with not losing an offline edit, which is
  // what pendingOpsRef/queueOps below actually guarantees (a tiny array of
  // just the changed ops, not the whole board). Re-serializing and writing
  // the whole thing on every single offline edit got more expensive (and
  // more likely to hit localStorage's quota) as real data grows — throttled
  // to at most once every 15s so a long offline editing session doesn't
  // keep re-writing a multi-MB blob after every tap; the up-to-15s-stale
  // snapshot this can leave behind only ever affects that one fallback
  // display, never whether a save is queued/lost.
  const lastPersistLocalRef = useRef(0);
  const persistLocal = useCallback((d: BoardData) => {
    // never let a public page's reduced snapshot overwrite the full board cached for the signed-in app
    if (publicRouteRef.current) return;
    const now = Date.now();
    if (now - lastPersistLocalRef.current < 15000) return;
    lastPersistLocalRef.current = now;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(d));
    } catch (e: any) {
      // QuotaExceededError specifically means the local copy is too big to
      // save at all (e.g. a failed photo upload embedded its full base64
      // data instead of a Cloudinary URL — see uploadPhoto.ts) — silently
      // swallowing this used to mean an offline change just vanished with
      // no trace, the same failure mode as the queueOps fix below.
      if (e?.name === "QuotaExceededError") toast("Couldn't save locally — storage is full (likely a large photo). Check your connection and try again.");
    }
  }, [toast]);

  // A save made while offline (dropped signal, or the server asleep on a
  // free-tier dyno and the request timing out) used to just sit in this
  // one browser's localStorage blob — and the very next successful
  // /api/state refresh (once back online) would overwrite that blob with
  // the server's real data, silently discarding the change with no error
  // and no record of it anywhere. Queueing the failed ops batch here (and
  // replaying it before trusting any fresh server state) is what actually
  // gets it saved once the connection comes back, instead of just losing
  // it — this is what happened to a Quality Inspection that looked saved
  // on screen but was never in the database.
  // Stored as QueuedBatch[] ({id, ops, by, at}); entries saved by earlier
  // versions (a bare Op[]) are upgraded on read by normalizeQueue().
  const pendingOpsRef = useRef<QueuedBatch[]>((() => {
    try {
      const raw = localStorage.getItem(PENDING_OPS_KEY);
      return raw ? normalizeQueue(JSON.parse(raw)) : [];
    } catch { return []; }
  })());
  // Surfaced in the UI (see PendingSyncBadge) so an unsynced change is
  // never invisible beyond its one 2.6s toast — someone can always glance
  // at the screen and see "N changes waiting to sync" until it clears.
  const [pendingCount, setPendingCount] = useState(pendingOpsRef.current.length);
  const savePendingOps = useCallback(() => {
    try {
      localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(pendingOpsRef.current));
    } catch (e: any) {
      // This is the actual failure mode behind the original incident: a
      // large embedded photo (see uploadPhoto.ts's localOnly fallback)
      // pushes the queued batch over localStorage's quota, this throws,
      // and the queue entry is lost right as we tried to save it for
      // later — now surfaced instead of silently swallowed.
      if (e?.name === "QuotaExceededError") toast("Couldn't save your change for retry — storage is full (likely a large photo). Please check your connection and try again now.");
    }
    setPendingCount(pendingOpsRef.current.length);
  }, [toast]);
  // Another tab (same browser/profile) could have queued or flushed its
  // own ops in between — re-reading the latest localStorage value right
  // before appending, instead of trusting this tab's possibly-stale
  // in-memory snapshot, is what stops one tab's queued save from silently
  // clobbering (overwriting, not merging) the other's when both write.
  const reloadPendingOpsFromStorage = useCallback(() => {
    try {
      const raw = localStorage.getItem(PENDING_OPS_KEY);
      pendingOpsRef.current = raw ? normalizeQueue(JSON.parse(raw)) : [];
    } catch {}
    setPendingCount(pendingOpsRef.current.length);
  }, []);
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === PENDING_OPS_KEY) reloadPendingOpsFromStorage();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reloadPendingOpsFromStorage]);
  // `id` is the same batch id the first (failed) attempt sent to the server, so
  // a replay of a request the server already applied is recognised as a repeat.
  const queueOps = useCallback((ops: Op[], id: string) => {
    reloadPendingOpsFromStorage();
    pendingOpsRef.current = [...pendingOpsRef.current, { id, ops, by: currentTokenUser(), at: Date.now() }];
    savePendingOps();
  }, [reloadPendingOpsFromStorage, savePendingOps]);
  // Replays queued batches in order, oldest first. Stops (returns false) on
  // the first one that still can't reach the server — anything after it
  // stays queued for the next retry, so nothing is sent out of order.
  // Guarded against running twice at once (the initial-load effect and the
  // 5s poll interval can both try to flush around the same moment while
  // mode is still settling) — without this, both calls could read and send
  // the same queued batch before either removed it, double-posting it.
  const isFlushingRef = useRef(false);
  const flushPendingOps = useCallback(async (): Promise<boolean> => {
    if (isFlushingRef.current) return false;
    isFlushingRef.current = true;
    try {
      // The rules (what is kept, what is dropped, ordering, who may send
      // what) live in shared/opQueue.ts. In short: only a definitive refusal
      // from the server (a 4xx other than 401/408/425/429) drops a batch — an
      // expired session (401), an overloaded or sleeping server (5xx/429) or a
      // network failure all KEEP it. Every attempt carries the batch's id, so a
      // request the server already applied is never applied twice.
      return await flushQueue({
        getQueue: () => pendingOpsRef.current,
        remove: (id) => {
          pendingOpsRef.current = pendingOpsRef.current.filter((b) => b.id !== id);
          savePendingOps();
        },
        send: async (batch) => {
          const r = await fetch(API_BASE + "/api/ops", {
            method: "POST",
            // a batch made while signed out (public form) is replayed signed out too
            headers: { "Content-Type": "application/json", ...(batch.by === null ? {} : authHeaders()) },
            body: JSON.stringify({ ops: batch.ops, batchId: batch.id })
          });
          let error: string | undefined;
          if (!r.ok) { try { error = (await r.json()).error; } catch {} }
          return { status: r.status, error };
        },
        currentTokenUser: currentTokenUser(),
        onRejected: (batch, error) => { rememberRejected(batch.ops, error); toast("A change saved earlier was refused by the server and could not be applied: " + error, 8000); }
      });
    } finally {
      isFlushingRef.current = false;
    }
  }, [savePendingOps, toast, rememberRejected]);

  // Returns whether the change actually reached the server just now (true)
  // or was only queued/rejected (false) — callers that show their own
  // "Saved!"/"Submitted" toast right after awaiting apply() need this,
  // because that toast fires in the same tick as apply()'s own "Offline —
  // will save automatically" toast and simply overwrites it (toast() only
  // ever shows the LAST call) — without checking this, the user sees a
  // plain success message even when the save only got queued, not synced.
  // This is what made an offline-queued submission still say "Submitted".
  const apply = useCallback(async (ops: Op[]): Promise<boolean> => {
    const d = dataRef.current;
    if (!d) return false;
    const next = structuredClone(d);
    applyOpsLocal(next, ops);
    setData(next);
    dataRef.current = next;
    // One id per user action, reused by every retry of it (see shared/opQueue.ts).
    const batchId = newBatchId();

    if (modeRef.current === "local" || modeRef.current === "offline") {
      // Already offline — queue it (after anything already queued, so
      // order is preserved) instead of only writing to this browser's
      // local blob, which the next reconnect would otherwise overwrite.
      queueOps(ops, batchId);
      persistLocal(next);
      markApplyFailed();
      toast("Offline — your change is saved on this device and will sync automatically", 5000);
      return false;
    }
    try {
      const r = await fetch(API_BASE + "/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ops, batchId })
      });
      const j = await r.json();
      if (!r.ok) {
        if (r.status !== 401 && classifyStatus(r.status) === "retry-later") {
          // 5xx / 429 / 408: the server couldn't take it right now — that is not
          // a verdict on the change. Keep it queued (same batch id, so a retry
          // after a commit whose reply was lost can't apply it twice).
          queueOps(ops, batchId);
          persistLocal(next);
          markApplyFailed();
          toast("The server is busy — your change is saved and will be retried automatically", 5000);
          return false;
        }
        if (r.status === 401) {
          // An expired/invalid session (JWTs last 7 days — plausible for a
          // tab left open that long), NOT a real rejection of the action
          // itself — discarding the change here (like a genuine permission
          // rejection below) would silently lose real work just because the
          // token aged out mid-session. Queue it instead: once the user
          // signs back in, the poll loop's own pending-ops retry (above)
          // sends it with the fresh token.
          queueOps(ops, batchId);
          persistLocal(next);
          markApplyFailed();
          toast("Your session expired — please sign in again. This will finish submitting once you do.", 6000);
          return false;
        }
        // The optimistic local update above already applied — the server
        // rejected it (e.g. not admin), so re-sync from the real server
        // state instead of leaving the UI showing a change that never
        // actually persisted.
        // (guarded: if this re-sync itself fails it must not fall through to the
        // network-failure branch below and queue a change the server just refused)
        const fresh = await fetchBoard().catch(() => null);
        if (fresh && fresh.data && acceptState(fresh)) { setData(fresh.data); dataRef.current = fresh.data; setRev(fresh.rev); }
        rememberRejected(ops, j.error || "rejected by the server");
        markApplyFailed();
        toast(j.error || "That action isn't allowed", 7000);
        return false;
      }
      if (j.data && acceptState(j)) { setData(j.data); dataRef.current = j.data; setRev(j.rev); }
      return true;
    } catch {
      // A network failure, NOT a rejection — e.g. the signal dropped, or a
      // free-tier server was asleep and the request timed out. Queue it so
      // it actually reaches the server once the connection's back, instead
      // of silently vanishing the next time a fresh /api/state overwrites
      // this device's local copy.
      queueOps(ops, batchId);
      modeRef.current = "offline";
      setMode("offline");
      markApplyFailed();
      toast("Offline — will save automatically once back online", 5000);
      return false;
    }
  }, [persistLocal, queueOps, toast, acceptState, markApplyFailed, rememberRejected]);

  // "Who's opening which module" had no trail at all before this — Audit
  // Logs only ever recorded create/edit/delete actions, never a view.
  // Logged once per tab per browser session (not on every click back to a
  // tab already seen) so normal navigating around the app doesn't flood the
  // shared events collection — it's a bounded, server-side-capped log
  // (MAX_EVENTS in server.js), and real action events must not get crowded
  // out by someone just clicking through tabs.
  const loggedTabsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!loggedIn || !currentUserId || loggedTabsRef.current.has(activeTab)) return;
    loggedTabsRef.current.add(activeTab);
    apply([buildEventOp(currentUserId, "MODULE_VIEW", activeTab, "", `Opened ${TAB_VIEW_LABEL[activeTab] || activeTab}`)]);
  }, [activeTab, loggedIn, currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Initial load + poll */
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const j = await fetchBoard();
        if (stopped) return;
        acceptState(j); // first load: always shown (sign-in screen needs data) but a stale token is dropped
        setData(j.data); dataRef.current = j.data;
        setRev(j.rev); revRef.current = j.rev;
        setMode("live"); modeRef.current = "live";
        // Anything queued from a previous offline session (app was closed
        // before the connection came back) gets its chance to actually
        // reach the server now, before anyone starts making new changes.
        if (pendingOpsRef.current.length > 0 && await flushPendingOps()) {
          const s = await fetchBoard();
          if (!stopped && acceptState(s)) { setData(s.data); dataRef.current = s.data; setRev(s.rev); revRef.current = s.rev; }
          toast("Synced changes saved while you were offline");
        }
      } catch {
        const raw = localStorage.getItem(LS_KEY);
        let local: BoardData | null = null;
        if (raw) { try { local = scrubLocalBoard(JSON.parse(raw)); } catch {} }
        if (stopped) return;
        if (local) { setData(local); dataRef.current = local; setMode("local"); modeRef.current = "local"; }
        else { setMode("offline"); modeRef.current = "offline"; }
      }
    })();

    const iv = window.setInterval(async () => {
      // A save that only got queued because the session had expired mid-use
      // (a 401, not a network failure — see apply()'s !r.ok branch) never
      // flips mode to "offline", so it would otherwise sit queued forever:
      // retry it here too, independent of the live/offline branch below,
      // once the user's re-signed in and authHeaders() has a fresh token.
      if (modeRef.current === "live" && pendingOpsRef.current.length > 0) {
        await flushPendingOps();
      }
      if (modeRef.current === "live") {
        try {
          const r = await fetch(API_BASE + "/api/rev", { cache: "no-store" });
          const j = await r.json();
          if (j.rev !== revRef.current) {
            const s = await fetchBoard();
            if (acceptState(s)) {
              const merged = mergeStableCollections(dataRef.current, s.data);
              setData(merged); dataRef.current = merged;
              setRev(s.rev); revRef.current = s.rev;
            }
          }
        } catch {
          modeRef.current = "offline";
          setMode("offline");
        }
        return;
      }

      // Offline/local — used to just sit there forever until a full page
      // reload, with no way back even once the connection returned. Retry
      // every tick instead: flush anything queued, then pull real server
      // state (which now includes what was just flushed) rather than
      // trusting the local copy made while disconnected.
      try {
        const ok = await flushPendingOps();
        if (!ok) return;
        const s = await fetchBoard();
        if (acceptState(s)) { setData(s.data); dataRef.current = s.data; }
        setRev(s.rev); revRef.current = s.rev;
        modeRef.current = "live"; setMode("live");
        toast("Back online — your changes were saved");
      } catch {
        // still offline, try again next tick
      }
    }, 5000);

    return () => { stopped = true; window.clearInterval(iv); };
  }, []);

  /* Pick a default user/project once data first arrives */
  const initedDefaults = useRef(false);
  useEffect(() => {
    if (!data || initedDefaults.current) return;
    initedDefaults.current = true;
    const savedUser = localStorage.getItem("neoteric_user");
    const users = coll(data, "users");
    const validUser = savedUser && byId(users, savedUser);
    const initialUserId = validUser ? savedUser : (users[0]?.id ?? null);
    setCurrentUserIdState(initialUserId);
    // Default project respects that user's projectIds restriction (see
    // shared/rules.ts's myProjects()) — never defaults to a project they
    // aren't allowed to see.
    const initialUser = initialUserId ? byId(users, initialUserId) : null;
    const projects = coll(data, "projects").filter((p) => p.active !== false);
    const allowedProjects = initialUser?.projectIds?.length && initialUserId !== "U-ADMIN"
      ? projects.filter((p) => initialUser.projectIds!.includes(p.id))
      : projects;
    setCurrentProjectIdState((allowedProjects[0] ?? projects[0])?.id ?? null);

    if (LOGIN_GATE_ENABLED) {
      const sessionActive = localStorage.getItem(SESSION_KEY) === "1";
      // A session flag with no stored token (e.g. from before auth used
      // real tokens, or if it was ever cleared independently) would show
      // the UI as "logged in" while every admin-gated request silently
      // 401s. Require both, and if the token's missing, force a fresh
      // login instead of a session that looks fine but can't do anything.
      const hasToken = !!localStorage.getItem(TOKEN_KEY);
      setLoggedIn(!!(sessionActive && validUser && hasToken));
    }
  }, [data]);

  const setCurrentUserId = useCallback((id: string) => {
    setCurrentUserIdState(id);
    try { localStorage.setItem("neoteric_user", id); } catch {}
    // If this user's projectIds restriction excludes whatever project was
    // showing, jump to their first allowed one instead of silently
    // leaving them looking at a project they can't pick from any dropdown.
    const d = dataRef.current;
    const user = id !== "U-ADMIN" ? byId(coll(d, "users"), id) : null;
    if (user?.projectIds?.length) {
      setCurrentProjectIdState((cur) => {
        if (cur && user.projectIds!.includes(cur)) return cur;
        const allowed = coll(d, "projects").filter((p) => p.active !== false && user.projectIds!.includes(p.id));
        return allowed[0]?.id ?? cur;
      });
    }
  }, []);
  const setCurrentProjectId = useCallback((id: string) => setCurrentProjectIdState(id), []);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await fetch(API_BASE + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error || "Invalid email or password";
      }
      const { user, token } = await res.json();
      try {
        localStorage.setItem(SESSION_KEY, "1");
        if (token) localStorage.setItem(TOKEN_KEY, token);
      } catch {}
      // The board loaded before sign-in may be the reduced public snapshot (see backend/publicState.js) —
      // fetch the real one now that there is a token, BEFORE selecting the user (which reads the user's
      // project restrictions from it). Skipped when the board already in memory is the full one (the normal case
      // while the snapshot feature is off) — then sign-in makes no extra request and waits for nothing.
      if (needsFullBoardAfterLogin(lastStatePublicRef.current)) {
        try {
          const s = await fetchBoard();
          if (s && s.data && !s.public) {
            lastStatePublicRef.current = false;
            const merged = mergeStableCollections(dataRef.current, s.data);
            setData(merged); dataRef.current = merged;
            setRev(s.rev); revRef.current = s.rev;
          }
        } catch {}
      }
      setCurrentUserId(user.id);
      try {
        // A fresh real login is never mid-impersonation — clears any stale
        // flag from a previous admin session on a shared browser, so
        // Header.tsx's "Back to Admin" never shows to someone who didn't
        // actually switch there from Admin this session.
        localStorage.removeItem("neoteric_impersonating_from");
      } catch {}
      setLoggedIn(true);
      return null;
    } catch {
      return "Can't reach the server. Try again.";
    }
  }, [setCurrentUserId]);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch {}
    setLoggedIn(!LOGIN_GATE_ENABLED ? true : false);
  }, []);

  const openDrawer = useCallback((ref: DrawerRef) => setDrawer(ref), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openAssignModal = useCallback((s: AssignModalState) => setAssignModal(s), []);
  const closeAssignModal = useCallback(() => setAssignModal(null), []);
  const openSnagModal = useCallback((s: SnagModalState) => setSnagModal(s), []);
  const closeSnagModal = useCallback(() => setSnagModal(null), []);
  const openChecklistModal = useCallback((s: ChecklistModalState) => setChecklistModal(s), []);
  const closeChecklistModal = useCallback(() => setChecklistModal(null), []);
  const openRecordModal = useCallback((s: RecordModalState) => setRecordModal(s), []);
  const closeRecordModal = useCallback(() => setRecordModal(null), []);

  const me = useCallback((): User | null => byId(coll(dataRef.current, "users"), currentUserId), [currentUserId]);
  const myRole = useCallback((): Role => me()?.role ?? "ADMIN", [me]);

  const value: AppContextValue = {
    data, rev, mode, pendingCount, rejectedCount, clearRejected, loggedIn, currentUserId, currentProjectId, activeTab, activeMaster, drawer, toastMsg,
    assignModal, snagModal, checklistModal, recordModal, openDrawingRequestId, reInspectQualityId, caseStudyDraft,
    setCurrentUserId, setCurrentProjectId, setActiveTab, setActiveMaster, openDrawer, closeDrawer,
    openAssignModal, closeAssignModal, openSnagModal, closeSnagModal,
    openChecklistModal, closeChecklistModal, openRecordModal, closeRecordModal, setOpenDrawingRequestId, setReInspectQualityId, setCaseStudyDraft,
    login, logout, toast: pageToast, apply, me, myRole
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

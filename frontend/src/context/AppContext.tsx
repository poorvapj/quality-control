import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BoardData, Op, Role, StoreMode, TabKey, MasterKey, User } from "../types";
import { API_BASE } from "../services/config";
import { byId, coll } from "../shared/rules";

const LS_KEY = "neoteric_board_v5";
const SESSION_KEY = "neoteric_session";
const TOKEN_KEY = "neoteric_token";
const PENDING_OPS_KEY = "neoteric_pending_ops";

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

/* Mirror of the server's op handler so optimistic updates match exactly. */
function applyOpsLocal(d: BoardData, ops: Op[]) {
  for (const op of ops) {
    if (op.op === "upsert") {
      const list = ((d as any)[op.coll] = (d as any)[op.coll] || []);
      const i = list.findIndex((r: any) => r.id === op.rec.id);
      const merged = i === -1 ? op.rec : Object.assign({}, list[i], op.rec);
      for (const k of Object.keys(merged)) if ((merged as any)[k] === null) delete (merged as any)[k];
      if (i === -1) list.push(merged);
      else list[i] = merged;
    } else if (op.op === "delete") {
      (d as any)[op.coll] = ((d as any)[op.coll] || []).filter((r: any) => r.id !== op.id);
    } else if (op.op === "progress") {
      const next = Object.assign({}, d.progress[op.key] || {}, op.patch);
      for (const k of Object.keys(next)) if ((next as any)[k] === null) delete (next as any)[k];
      d.progress[op.key] = next;
    } else if (op.op === "event") {
      d.events.unshift(op.ev);
      if (d.events.length > 5000) d.events.length = 5000;
    }
  }
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
  apply: (ops: Op[]) => Promise<void>;

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

export function AppProvider({ children }: { children: React.ReactNode }) {
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

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout((toast as any)._t);
    (toast as any)._t = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const persistLocal = useCallback((d: BoardData) => {
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
  const pendingOpsRef = useRef<Op[][]>((() => {
    try {
      const raw = localStorage.getItem(PENDING_OPS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  })());
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
  }, [toast]);
  // Another tab (same browser/profile) could have queued or flushed its
  // own ops in between — re-reading the latest localStorage value right
  // before appending, instead of trusting this tab's possibly-stale
  // in-memory snapshot, is what stops one tab's queued save from silently
  // clobbering (overwriting, not merging) the other's when both write.
  const reloadPendingOpsFromStorage = useCallback(() => {
    try {
      const raw = localStorage.getItem(PENDING_OPS_KEY);
      pendingOpsRef.current = raw ? JSON.parse(raw) : [];
    } catch {}
  }, []);
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === PENDING_OPS_KEY) reloadPendingOpsFromStorage();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reloadPendingOpsFromStorage]);
  const queueOps = useCallback((ops: Op[]) => {
    reloadPendingOpsFromStorage();
    pendingOpsRef.current = [...pendingOpsRef.current, ops];
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
      while (pendingOpsRef.current.length > 0) {
        const batch = pendingOpsRef.current[0];
        try {
          const r = await fetch(API_BASE + "/api/ops", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ ops: batch })
          });
          if (!r.ok) {
            // Rejected by the server (not a network failure) — retrying it
            // forever would never succeed, so drop it rather than blocking
            // every batch queued after it.
            pendingOpsRef.current = pendingOpsRef.current.slice(1);
            savePendingOps();
            continue;
          }
          pendingOpsRef.current = pendingOpsRef.current.slice(1);
          savePendingOps();
        } catch {
          return false;
        }
      }
      return true;
    } finally {
      isFlushingRef.current = false;
    }
  }, [savePendingOps]);

  const apply = useCallback(async (ops: Op[]) => {
    const d = dataRef.current;
    if (!d) return;
    const next = structuredClone(d);
    applyOpsLocal(next, ops);
    setData(next);
    dataRef.current = next;

    if (modeRef.current === "local" || modeRef.current === "offline") {
      // Already offline — queue it (after anything already queued, so
      // order is preserved) instead of only writing to this browser's
      // local blob, which the next reconnect would otherwise overwrite.
      queueOps(ops);
      persistLocal(next);
      return;
    }
    try {
      const r = await fetch(API_BASE + "/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ops })
      });
      const j = await r.json();
      if (!r.ok) {
        // The optimistic local update above already applied — the server
        // rejected it (e.g. not signed in / not admin), so re-sync from the
        // real server state instead of leaving the UI showing a change that
        // never actually persisted.
        const fresh = await fetch(API_BASE + "/api/state", { cache: "no-store" }).then((x) => x.json());
        setData(fresh.data); dataRef.current = fresh.data; setRev(fresh.rev);
        toast(j.error || "That action isn't allowed");
        return;
      }
      if (j.data) { setData(j.data); dataRef.current = j.data; setRev(j.rev); }
    } catch {
      // A network failure, NOT a rejection — e.g. the signal dropped, or a
      // free-tier server was asleep and the request timed out. Queue it so
      // it actually reaches the server once the connection's back, instead
      // of silently vanishing the next time a fresh /api/state overwrites
      // this device's local copy.
      queueOps(ops);
      modeRef.current = "offline";
      setMode("offline");
      toast("Offline — will save automatically once back online");
    }
  }, [persistLocal, queueOps, toast]);

  /* Initial load + poll */
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const r = await fetch(API_BASE + "/api/state", { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        if (stopped) return;
        setData(j.data); dataRef.current = j.data;
        setRev(j.rev); revRef.current = j.rev;
        setMode("live"); modeRef.current = "live";
        // Anything queued from a previous offline session (app was closed
        // before the connection came back) gets its chance to actually
        // reach the server now, before anyone starts making new changes.
        if (pendingOpsRef.current.length > 0 && await flushPendingOps()) {
          const s = await (await fetch(API_BASE + "/api/state", { cache: "no-store" })).json();
          if (!stopped) { setData(s.data); dataRef.current = s.data; setRev(s.rev); revRef.current = s.rev; }
          toast("Synced changes saved while you were offline");
        }
      } catch {
        const raw = localStorage.getItem(LS_KEY);
        let local: BoardData | null = null;
        if (raw) { try { local = JSON.parse(raw); } catch {} }
        if (stopped) return;
        if (local) { setData(local); dataRef.current = local; setMode("local"); modeRef.current = "local"; }
        else { setMode("offline"); modeRef.current = "offline"; }
      }
    })();

    const iv = window.setInterval(async () => {
      if (modeRef.current === "live") {
        try {
          const r = await fetch(API_BASE + "/api/rev", { cache: "no-store" });
          const j = await r.json();
          if (j.rev !== revRef.current) {
            const s = await (await fetch(API_BASE + "/api/state", { cache: "no-store" })).json();
            const merged = mergeStableCollections(dataRef.current, s.data);
            setData(merged); dataRef.current = merged;
            setRev(s.rev); revRef.current = s.rev;
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
        const s = await (await fetch(API_BASE + "/api/state", { cache: "no-store" })).json();
        setData(s.data); dataRef.current = s.data;
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
      setCurrentUserId(user.id);
      try {
        localStorage.setItem(SESSION_KEY, "1");
        if (token) localStorage.setItem(TOKEN_KEY, token);
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
    data, rev, mode, loggedIn, currentUserId, currentProjectId, activeTab, activeMaster, drawer, toastMsg,
    assignModal, snagModal, checklistModal, recordModal, openDrawingRequestId, reInspectQualityId, caseStudyDraft,
    setCurrentUserId, setCurrentProjectId, setActiveTab, setActiveMaster, openDrawer, closeDrawer,
    openAssignModal, closeAssignModal, openSnagModal, closeSnagModal,
    openChecklistModal, closeChecklistModal, openRecordModal, closeRecordModal, setOpenDrawingRequestId, setReInspectQualityId, setCaseStudyDraft,
    login, logout, toast, apply, me, myRole
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

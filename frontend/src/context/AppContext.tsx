import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BoardData, Op, Role, StoreMode, TabKey, MasterKey, User } from "../types";
import { API_BASE } from "../services/config";
import { byId, coll } from "../shared/rules";

const LS_KEY = "neoteric_board_v5";
const SESSION_KEY = "neoteric_session";
const TOKEN_KEY = "neoteric_token";

export function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: "Bearer " + token } : {};
  } catch {
    return {};
  }
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

export interface AssignModalState { targetType: "unit" | "floor"; targetId: string; stageId: string; presetUser?: string }
export interface SnagModalState { unitId: string; stageId: string; preset?: string }
export interface ChecklistModalState { kind: "unit" | "floor"; id: string; stageId: string; checklistId: string }
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
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  toast: (msg: string) => void;
  apply: (ops: Op[]) => Promise<void>;
  reset: (mode: "demo" | "blank") => Promise<void>;

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
    try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {}
  }, []);

  const apply = useCallback(async (ops: Op[]) => {
    const d = dataRef.current;
    if (!d) return;
    const next = structuredClone(d);
    applyOpsLocal(next, ops);
    setData(next);
    dataRef.current = next;

    if (modeRef.current === "local" || modeRef.current === "offline") {
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
      modeRef.current = "offline";
      setMode("offline");
      toast("Offline — change kept on this device only");
    }
  }, [persistLocal, toast]);

  const reset = useCallback(async (mode: "demo" | "blank") => {
    if (modeRef.current !== "live") { toast("Reset needs the server"); return; }
    const r = await fetch(API_BASE + "/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ mode })
    });
    const j = await r.json();
    if (!r.ok) { toast(j.error || "Reset isn't allowed"); return; }
    setData(j.data); dataRef.current = j.data; setRev(j.rev);
    toast(mode === "blank" ? "Blank board created" : "Demo data reloaded");
  }, [toast]);

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
      if (modeRef.current !== "live") return;
      try {
        const r = await fetch(API_BASE + "/api/rev", { cache: "no-store" });
        const j = await r.json();
        if (j.rev !== revRef.current) {
          const s = await (await fetch(API_BASE + "/api/state", { cache: "no-store" })).json();
          setData(s.data); dataRef.current = s.data;
          setRev(s.rev); revRef.current = s.rev;
        }
      } catch {
        modeRef.current = "offline";
        setMode("offline");
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
    setCurrentUserIdState(validUser ? savedUser : (users[0]?.id ?? null));
    const projects = coll(data, "projects");
    setCurrentProjectIdState(projects[0]?.id ?? null);

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
  const myRole = useCallback((): Role => me()?.role ?? "DRI", [me]);

  const value: AppContextValue = {
    data, rev, mode, loggedIn, currentUserId, currentProjectId, activeTab, activeMaster, drawer, toastMsg,
    assignModal, snagModal, checklistModal, recordModal,
    setCurrentUserId, setCurrentProjectId, setActiveTab, setActiveMaster, openDrawer, closeDrawer,
    openAssignModal, closeAssignModal, openSnagModal, closeSnagModal,
    openChecklistModal, closeChecklistModal, openRecordModal, closeRecordModal,
    login, logout, toast, apply, reset, me, myRole
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

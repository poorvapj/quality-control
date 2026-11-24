import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BoardData, Op, Role, StoreMode, TabKey, MasterKey, User } from "../types";
import { API_BASE } from "../services/config";
import { byId, coll } from "../shared/rules";
import { classifyStatus, flushQueue, newBatchId, normalizeQueue, tokenUserId, type QueuedBatch } from "../shared/opQueue";
import { judgeStateResponse, needsFullBoardAfterLogin } from "../shared/stateSync";
import { applyOpsLocal, scrubLocalBoard } from "../shared/applyOpsLocal";
import { buildEventOp } from "../shared/eventLog";
import { resolveIdsInPlace } from "../shared/helpers";

// Human label for the MODULE_VIEW audit event's detail text — purely
// cosmetic (Audit Logs still groups by the raw TabKey), so an entry
// missing here just falls back to the bare key rather than breaking anything.
const TAB_VIEW_LABEL: Partial<Record<TabKey, string>> = {
  dash: "Dashboard", misDashboard: "Quality MIS", userMis: "Users MIS",
  executionReconciliation: "Execution Reconciliation", qualityInspection: "Quality Inspection", execution: "Execution",
  qualityFails: "Fail Register", caseStudies: "Case Studies", unitExecutionWorkflow: "Measurement (Unit)",
  measurement: "Measurement", progressAnalysis: "Progress Analysis", purchaseOrders: "Purchase Orders",
  work: "My Work", board: "Tower Board", handoverChecklist: "Handover Checklist",
  handoverInternal: "Handover Checklist — Internal", handoverOwner: "Handover Checklist — Owner",
  snags: "Snags", team: "Team", masters: "Masters", addUser: "Add User", dpr: "Daily Progress Report",
  drawingRequests: "Drawing Requests", backups: "Backups", auditLog: "Audit Logs", permissionMatrix: "Permission Matrix"
};
import { addRejected, parseRejected, REJECTED_KEY } from "../shared/rejected";

// How often the 5s poll is allowed to pull the FULL board (dpr/qualityInspections/
// events) in response to a revision change — every rev change still gets the
// small `lite` refresh immediately, but the heavy collections only resync at
// most this often, no matter how many revisions land in between. Collapsing
// many potential ~9MB full-state downloads into one every minute was the
// single largest source of this app's bandwidth (see server.js's
// LITE_SKIP_COLLECTIONS doc comment for the same measurement).
const HEAVY_REFRESH_MS = 60000;
// The real bug behind every "data was there, then disappeared again"
// report this session (2026-11-23): a `lite=1` response's dpr/
// qualityInspections/purchaseOrders/events are genuinely `[]` — not because
// they're empty, but because the server was told to skip them — but
// mergeStableCollections has no way to know that. It only keeps the
// PREVIOUS value when the two are byte-identical, so the very next
// rev-changing poll (or a login) merged that `[]` straight over whatever
// real data the earlier background top-up fetch had just loaded, silently
// erasing it. apply()'s /api/ops patch-back loop already solved this for
// save responses; it was never applied to a lite /api/state response
// merged directly into state (the poll tick, and login) — see
// patchLiteResponse below, now used at both of those call sites.
const LITE_RESPONSE_PLACEHOLDER_COLLS = ["dpr", "qualityInspections", "purchaseOrders", "events"];
function patchLiteResponse(liteData: any, prev: BoardData | null): any {
  if (!prev) return liteData;
  const patched = { ...liteData };
  for (const c of LITE_RESPONSE_PLACEHOLDER_COLLS) {
    if ((prev as any)[c] !== undefined) patched[c] = (prev as any)[c];
  }
  return patched;
}
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
// `lite`: skips the server's heaviest collections (dpr, qualityInspections,
// purchaseOrders, events — measured as most of the whole board's byte size
// on a real project) — see ensureHeavy() below for how/when those actually
// get loaded.
//
// RE-ARCHITECTED 2026-11-24 after 3 separate live incidents from the old
// "fetch lite now, automatically fetch the FULL board moments later" design
// (permanently-empty heavy collections from a silent no-retry; a too-short
// timeout against a 113-118s real full-rebuild; a fresh session dropped into
// full offline mode). That automatic full-board top-up is GONE — lite is now
// the only thing ever fetched automatically (login, initial load, poll).
// Heavy collections load on demand instead: a page that actually needs
// dpr/qualityInspections/purchaseOrders/events calls ensureHeavy([...]),
// which fetches ONLY those specific collections (via `?include=`, not the
// whole board) and only once per collection per session unless the poll's
// own throttled refresh (HEAVY_REFRESH_MS) sees a rev change and tops up
// whichever ones are already loaded.
//
// A plain (non-lite, no include) fetchBoard() still exists for the handful
// of rare, non-routine full-board reads (recovering from a rejected op,
// flushing queued offline ops, reconnecting after being offline) — those
// are correctness-critical one-offs, not routine background noise, so they
// keep the long timeout below.
const FULL_FETCH_TIMEOUT_MS = 240000;
// RAISED 2026-11-23: 30s was too tight — on a fresh/incognito session (no
// localStorage fallback) a lite fetch this slow doesn't just feel slow, it
// drops the WHOLE APP into offline mode on first load (the initial-load
// effect's catch block falls back to localStorage, then to "offline" if
// there's nothing there — see below). The lite path had no timing log of
// its own until now (see server.js's `[lite-state]` log added alongside
// this), so there's no real number yet for how slow it actually gets — this
// is a safe interim ceiling, not a measured value like FULL_FETCH_TIMEOUT_MS
// above. Tighten it again once real `[lite-state]` numbers come in.
const LITE_FETCH_TIMEOUT_MS = 90000;
// `includeHeavy` (2026-11-24): asks the lite endpoint to also include one or
// more specific normally-skipped heavy collections (dpr/qualityInspections/
// purchaseOrders/events) — see ensureHeavy() below, the on-demand loader
// that uses this instead of ever fetching the whole board just to top up
// heavy data. Only meaningful together with `lite`.
async function fetchBoard(lite = false, includeHeavy?: string[]): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), lite ? LITE_FETCH_TIMEOUT_MS : FULL_FETCH_TIMEOUT_MS);
  try {
    let url = API_BASE + "/api/state";
    const qs: string[] = [];
    if (lite) qs.push("lite=1");
    if (lite && includeHeavy && includeHeavy.length) qs.push("include=" + includeHeavy.map(encodeURIComponent).join(","));
    if (qs.length) url += "?" + qs.join("&");
    const r = await fetch(url, { cache: "no-store", headers: authHeaders(), signal: controller.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: "Bearer " + token } : {};
  } catch {
    return {};
  }
}

// A callback a direct fetch OUTSIDE apply()/the ops queue (uploadPhoto.ts,
// useActions.ts's capturePhoto) can reach for on a 401, so a dead session
// found there forces the same real sign-in screen as a dead-session data
// save does, instead of just falling back to "kept locally, try
// re-uploading" — which otherwise never actually told the user WHY it kept
// failing, nor gave them a way to stop it.
let notifySessionExpiredImpl: (() => void) | null = null;
export function notifySessionExpired(): void {
  notifySessionExpiredImpl?.();
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
// The background full-state fetch (tops up dpr/qualityInspections/purchaseOrders/events
// after the initial/login/poll lite fetch) used to be a single try with a silent
// `.catch(() => {})` — one network blip or slow-server hiccup and those collections
// stayed empty (grey Tower Board cells, "0 logs" Audit Logs) until the next
// rev-changing poll tick happened to land within the heavy-refresh window, which
// could be minutes or never on a quiet board. Retry a few times with a short
// backoff before giving up — the next poll tick (throttled to HEAVY_REFRESH_MS)
// will still pick it up eventually either way, but this closes the common case.
// Only 2 attempts (not 3) now that each one can itself take up to
// FULL_FETCH_TIMEOUT_MS (240s, see fetchBoard) — a real production full
// rebuild takes 113-118s, so a 2nd attempt is a reasonable safety net
// without piling on a 3rd multi-minute wait for no real extra benefit.
// Also used for the INITIAL load's lite fetch (2026-11-23): that one single
// attempt had no retry at all — one slow/dropped lite request and a FRESH
// session (nothing in localStorage yet) fell straight through to full
// "offline" mode, not just a slow load. A lite attempt is cheap (~10-25s
// measured in production) so 2 attempts here costs little even in the worst
// case, and closes that gap.
async function fetchBoardWithRetry(attempts = 2, lite = false, includeHeavy?: string[]): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchBoard(lite, includeHeavy);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

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
export interface RecordModalState { master: MasterKey; id: string | null; defaults?: Record<string, any> }

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
  // On-demand loader for a normally-lite-skipped heavy collection
  // ("dpr" | "qualityInspections" | "purchaseOrders" | "events") — call once
  // in a page's own mount effect for whatever it actually reads. A no-op
  // once that collection has already been loaded this session.
  ensureHeavy: (names: string[]) => void;
  // Reactive: true once every named collection has actually loaded this
  // session — use alongside ensureHeavy() to show a loading state instead
  // of a premature "no records" while the fetch is still in flight.
  isHeavyLoaded: (names: string[]) => boolean;
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
  // A 401 on a save means the stored token itself is dead (expired/invalid) —
  // queuing it and toasting "please sign in again" every single time it's
  // retried (every 5s poll tick, or every tap of a stuck Submit button) just
  // repeats the same toast forever while the user stays on a screen that
  // still claims to be signed in, with no real way out of the loop. Flagged
  // once: force the sign-in screen so re-authenticating actually clears it,
  // instead of nagging on a dead session indefinitely. Reset on a fresh sign-in.
  const sessionExpiredFlaggedRef = useRef(false);
  const flagSessionExpired = useCallback(() => {
    if (sessionExpiredFlaggedRef.current) return;
    sessionExpiredFlaggedRef.current = true;
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    setLoggedIn(false);
    toast("Your session expired — please sign in again. Your unsaved changes are kept and will finish submitting once you do.", 8000);
  }, [toast]);
  useEffect(() => {
    notifySessionExpiredImpl = flagSessionExpired;
    return () => { if (notifySessionExpiredImpl === flagSessionExpired) notifySessionExpiredImpl = null; };
  }, [flagSessionExpired]);
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

  // Per-collection revision safety (2026-11-24, fixing a race a regression
  // audit confirmed): every merge site below is an async response that can
  // resolve out of order — a slower request started earlier can resolve
  // AFTER a faster one that started later and already reflects a newer
  // revision. Blindly overwriting dataRef.current/revRef.current with
  // whatever arrives last can regress both.
  //
  // Checking the response's own `rev` against a single global "last
  // applied" number is NOT enough on its own: two concurrent requests for
  // DIFFERENT collections (e.g. one ensureHeavy batch for "dpr", another for
  // "qualityInspections") can legitimately resolve in either order without
  // either being stale relative to the other — only a request for the SAME
  // collection reporting an OLDER revision than one already applied to it
  // is truly stale. collectionRevRef tracks that per collection key.
  //
  // "progress" is exempt from the per-collection check (not from the global
  // monotonic one) — matches apply()'s own pre-existing reasoning: server.js
  // always reads it in full regardless of lite/onlyColls, so it is never a
  // stale partial read and should always be trusted as-is.
  //
  // Every merge site passes its own already-patched data (placeholder
  // collections already restored from dataRef.current by patchLiteResponse/
  // the touched-set logic, exactly as before this fix) — this only adds the
  // monotonic safety net on top, it does not change what each site
  // considers "real" vs "placeholder" data.
  const collectionRevRef = useRef<Record<string, number>>({});
  // `freshKeys` (2026-11-24 — fixing a confirmed bug, found via a live
  // production repro, not speculation): omitted entirely, EVERY key in
  // `incomingData` is trusted as genuinely fresh (a true full-board fetch —
  // initial load's own direct path, offline recovery, pending-ops flush —
  // every collection really was just read from the database). When
  // provided, ONLY the keys it names are genuinely fresh for THIS response;
  // every other key present in `incomingData` is a mere carried-forward
  // placeholder (already correctly restored from dataRef.current by the
  // CALLER's own existing patch logic — patchLiteResponse, or the
  // touched-set loop in apply()/flushHeavyBatch) and must NOT be allowed to
  // stamp collectionRevRef or participate in the staleness check at all.
  //
  // Root cause this fixes: a page's own MODULE_VIEW audit-log write (fired
  // on every tab navigation — see the loggedTabsRef effect below) bumps the
  // global revision just like any other write, and its own /api/ops
  // response carries every OTHER collection back as a placeholder (since
  // that write's `touched` set is empty — it's an `{op:"event"}`, not an
  // upsert naming a `coll`). If that write's response happened to resolve
  // BEFORE a concurrent ensureHeavy() fetch for, say, "qualityInspections"
  // (exactly what happens on every real page load — the MODULE_VIEW log and
  // ensureHeavy() both fire from the same page mount), the OLD code would
  // stamp collectionRevRef["qualityInspections"] from that write's
  // placeholder `[]`, at that write's own (newer) revision — then the real,
  // slightly-older-revision ensureHeavy() response would be judged "stale"
  // against that false stamp and rejected outright, even though it was the
  // first genuine fetch of that collection all session. Confirmed via a
  // real browser repro against production (231 real records fetched
  // directly, same endpoint, same auth — but the page itself showed 0).
  const applyStateSafely = useCallback((incomingRev: number, incomingData: any, freshKeys?: Set<string>): any => {
    const safe: any = { ...incomingData };
    for (const key of Object.keys(incomingData)) {
      if (key === "progress") continue;
      if (freshKeys && !freshKeys.has(key)) continue; // not genuinely fetched by THIS response — leave it exactly as the caller's own patch logic already set it, never stamp or stale-check it here
      const lastRev = collectionRevRef.current[key] ?? -1;
      if (incomingRev < lastRev) {
        // Stale for THIS collection specifically — keep whatever's already
        // there rather than regress it; the global rev below still only
        // ever moves forward regardless.
        if (dataRef.current && (dataRef.current as any)[key] !== undefined) safe[key] = (dataRef.current as any)[key];
      } else {
        collectionRevRef.current[key] = incomingRev;
      }
    }
    const merged = mergeStableCollections(dataRef.current, safe);
    setData(merged); dataRef.current = merged;
    const nextRev = Math.max(revRef.current, incomingRev);
    setRev(nextRev); revRef.current = nextRev;
    return merged;
  }, []);
  // Shared helper for every lite-style call site: everything EXCEPT the
  // normally-skipped heavy collections is genuinely fresh in a lite
  // response; `extraFresh` adds back whichever heavy collection(s) THIS
  // particular request actually included (`?include=...`).
  const freshKeysForLite = useCallback((data: any, extraFresh: string[] = []): Set<string> => {
    return new Set(Object.keys(data).filter((k) => !LITE_RESPONSE_PLACEHOLDER_COLLS.includes(k) || extraFresh.includes(k)));
  }, []);

  // On-demand heavy-collection loader (2026-11-24) — see the fetchBoard()
  // doc comment above for why this replaced the old automatic full-board
  // top-up. A page that needs dpr/qualityInspections/purchaseOrders/events
  // calls ensureHeavy([...]) on mount; this fetches ONLY the collections not
  // already loaded this session, via `?include=`, never the whole board.
  //
  // True single-flight per collection name (2026-11-24, fixing a gap a
  // regression review found): the original version only batched calls
  // arriving within the same 50ms window — a second ensureHeavy() call for a
  // name whose FIRST request had already left that window (i.e. was already
  // in flight on the network) was not recognized as a duplicate and fired
  // its own request. heavyInFlightRef now tracks exactly which names are
  // currently being fetched by an in-progress batch, for the batch's entire
  // network round trip, not just its 50ms collection window.
  const heavyLoadedRef = useRef<Set<string>>(new Set());
  const heavyPendingRef = useRef<Set<string>>(new Set());
  const heavyInFlightRef = useRef<Set<string>>(new Set());
  const heavyFlushTimerRef = useRef<number | null>(null);
  // heavyLoadedRef is a ref (no re-render on change) — this mirrors it in
  // actual React state so a page can show a loading indicator instead of a
  // misleadingly-final "No records found" while its own ensureHeavy() call
  // is still in flight (2026-11-24, UX request after the on-demand load
  // made that first few-second wait newly visible on pages that previously
  // always had every collection ready immediately).
  const [loadedHeavyKeys, setLoadedHeavyKeys] = useState<Set<string>>(new Set());
  const flushHeavyBatch = useCallback(async () => {
    const names = [...heavyPendingRef.current];
    heavyPendingRef.current.clear();
    heavyFlushTimerRef.current = null;
    if (names.length === 0) return;
    for (const n of names) heavyInFlightRef.current.add(n);
    try {
      const s = await fetchBoardWithRetry(2, true, names);
      if (!acceptState(s)) return; // not marked loaded — see the `finally` below
      for (const n of names) heavyLoadedRef.current.add(n);
      setLoadedHeavyKeys((prev) => {
        const next = new Set(prev);
        for (const n of names) next.add(n);
        return next;
      });
      // Keep every OTHER heavy collection exactly as it already was — this
      // response only asked for `names`, so the rest come back as `[]`
      // placeholders, not real emptiness (same reasoning as
      // patchLiteResponse, scoped to just the collections not requested).
      // Reads dataRef.current fresh at THIS resolution, not a snapshot taken
      // when the batch started, so two overlapping batches for different
      // collections patch/merge correctly regardless of which settles first.
      const patched: any = { ...s.data };
      for (const c of LITE_RESPONSE_PLACEHOLDER_COLLS) {
        if (!names.includes(c) && dataRef.current && (dataRef.current as any)[c] !== undefined) {
          patched[c] = (dataRef.current as any)[c];
        }
      }
      applyStateSafely(s.rev, patched, freshKeysForLite(patched, names));
    } catch {
      // Left out of heavyLoadedRef, so the next ensureHeavy() call for the
      // same name(s) retries instead of silently giving up forever. Local
      // state (dataRef.current) is never touched on failure, so whatever was
      // already loaded stays exactly as it was.
    } finally {
      // Always runs, success or failure — a name must never stay stuck
      // "in flight" forever (that would permanently block retries), and a
      // name that just succeeded is now in heavyLoadedRef so leaving the
      // in-flight marker on it one tick longer would be harmless anyway.
      for (const n of names) heavyInFlightRef.current.delete(n);
    }
  }, [acceptState, applyStateSafely, freshKeysForLite]);
  const ensureHeavy = useCallback((names: string[]) => {
    const missing = names.filter((n) => !heavyLoadedRef.current.has(n) && !heavyInFlightRef.current.has(n));
    if (missing.length === 0) return;
    for (const n of missing) heavyPendingRef.current.add(n);
    if (heavyFlushTimerRef.current == null) {
      heavyFlushTimerRef.current = window.setTimeout(flushHeavyBatch, 50);
    }
  }, [flushHeavyBatch]);
  // Reactive companion to ensureHeavy() — true once every named collection
  // has actually been loaded this session, so a page can show a loading
  // indicator instead of treating "nothing here yet" as a final empty state
  // during the few seconds ensureHeavy()'s own fetch is still in flight.
  const isHeavyLoaded = useCallback((names: string[]): boolean => {
    return names.every((n) => loadedHeavyKeys.has(n));
  }, [loadedHeavyKeys]);

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
  // Counts only batches THIS signed-in person can actually do anything
  // about (their own, or ownerless legacy/public ones) — a shared device
  // can be left holding a previous person's still-queued batch (their
  // session died before it ever reached the server, then someone else
  // signed in on the same browser); opQueue.ts's canSendNow correctly
  // refuses to replay it under the new person's token, but counting it in
  // the total showed the new person a permanently stuck "N waiting to
  // sync" badge for a change that was never theirs and that their own
  // re-login could never clear.
  const countMine = useCallback(() => {
    const me = currentTokenUser();
    return pendingOpsRef.current.filter((b) => b.by === undefined || b.by === null || b.by === me).length;
  }, []);
  const [pendingCount, setPendingCount] = useState(() => countMine());
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
    setPendingCount(countMine());
  }, [toast, countMine]);
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
    setPendingCount(countMine());
  }, [countMine]);
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
          if (r.status === 401 && batch.by !== null) flagSessionExpired();
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
  }, [savePendingOps, toast, rememberRejected, flagSessionExpired]);

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
          flagSessionExpired();
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
      if (j.data && acceptState(j)) {
        // The server's own response (2026-11-23: generalized from just the
        // heavy collections to ALL of them) now only includes the
        // collection(s) this very batch's ops actually named via `coll` —
        // see sendOpsStateResponse/getState's `onlyColls` in server.js.
        // Everything else comes back as `[]`, NOT because it's actually
        // empty, so patch every one of those back from what's already in
        // memory (the optimistic update above, or whatever the last
        // full/lite fetch had) before merging, or this would silently wipe
        // out real local data for every collection a batch didn't touch.
        const touched = new Set(ops.filter((o): o is typeof o & { coll: string } => "coll" in o).map((o) => o.coll));
        const patched: any = { ...j.data };
        for (const c of Object.keys(patched)) {
          // "progress" is a special case: server.js's getState() always reads
          // it in full regardless of `onlyColls` (it's small, and a plain
          // "progress" op — see eventLog.ts/server.js — never shows up in
          // `touched` since it isn't an upsert-with-coll). Patching it back
          // from local state here would silently throw away genuinely fresh
          // server data for no reason, so it's never eligible to be patched.
          if (c === "progress") continue;
          if (!touched.has(c) && dataRef.current && (dataRef.current as any)[c] !== undefined) {
            patched[c] = (dataRef.current as any)[c];
          }
        }
        applyStateSafely(j.rev, patched, touched);
      }
      // A record created with makeTempId() (shared/helpers.ts) got its real
      // id from the server just now — fix up the SAME ops/rec objects the
      // caller built so its own closure (a toast, a returned ticket number)
      // shows that real id instead of the placeholder it would otherwise
      // never learn was replaced.
      if (j.resolvedIds) resolveIdsInPlace(ops, j.resolvedIds);
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
  }, [persistLocal, queueOps, toast, acceptState, markApplyFailed, rememberRejected, flagSessionExpired, applyStateSafely]);

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
  const lastHeavyRefreshRef = useRef(0);

  // Cross-tab poll coordination (2026-11-24) — SAFE polling coordination
  // only, as scoped by this project's own risk assessment: N open tabs each
  // independently hitting GET /api/rev every poll tick is pure duplicate
  // traffic for a value every tab would get the exact same answer to. This
  // elects one "leader" tab (via BroadcastChannel) to make that one cheap
  // request and broadcast the result; followers reuse a recent-enough
  // broadcast instead of asking themselves. Deliberately NOT extended to
  // sharing actual board/heavy-collection DATA across tabs — different tabs
  // can represent different logged-in sessions in the same browser, and
  // sharing fetched data (not just a bare revision number) would risk
  // leaking one session's data into another's tab; that's reported as
  // deferred, not implemented, rather than guessed at.
  //
  // Fails open to EXACTLY today's behavior (every tab polls independently)
  // whenever anything about the coordination can't be trusted: no
  // BroadcastChannel support, no heartbeat seen yet, or the "leader"
  // has gone quiet (closed/crashed/backgrounded) for longer than
  // LEADER_TIMEOUT_MS — another tab always picks the baton back up within
  // one heartbeat interval, never leaving every tab silently stuck.
  const TAB_ID = useRef(Math.random().toString(36).slice(2) + Date.now().toString(36)).current;
  const HEARTBEAT_MS = 4000;
  const LEADER_TIMEOUT_MS = 12000; // 3 missed heartbeats
  const FOLLOWER_REV_FRESHNESS_MS = 15000; // a touch over one poll interval
  const pollChannelRef = useRef<BroadcastChannel | null>(null);
  const knownTabsRef = useRef<Map<string, number>>(new Map()); // tabId -> last heartbeat ts
  const lastBroadcastRevRef = useRef<{ rev: number; ts: number } | null>(null);
  const isLeader = useCallback((): boolean => {
    if (!pollChannelRef.current) return true; // no BroadcastChannel support — every tab acts alone, same as before this feature existed
    const now = Date.now();
    const alive = [TAB_ID];
    for (const [id, ts] of knownTabsRef.current) {
      if (now - ts < LEADER_TIMEOUT_MS) alive.push(id);
    }
    alive.sort();
    return alive[0] === TAB_ID;
  }, [TAB_ID]);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const j = await fetchBoardWithRetry(2, true);
        if (stopped) return;
        acceptState(j); // first load: always shown (sign-in screen needs data) but a stale token is dropped
        applyStateSafely(j.rev, j.data, freshKeysForLite(j.data));
        setMode("live"); modeRef.current = "live";
        // No automatic heavy top-up here any more — the lite fetch above is
        // ALL that's ever fetched automatically now. Whichever page mounts
        // first (Dashboard, Tower Board, etc.) calls ensureHeavy() for
        // whatever it actually needs; see its own doc comment above.
        // Anything queued from a previous offline session (app was closed
        // before the connection came back) gets its chance to actually
        // reach the server now, before anyone starts making new changes.
        if (pendingOpsRef.current.length > 0 && await flushPendingOps()) {
          const s = await fetchBoard();
          if (!stopped && acceptState(s)) { applyStateSafely(s.rev, s.data); }
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

    // A background/inactive tab polling /api/rev every 5s forever was pure
    // waste — request COUNT (not just payload size) kept climbing with every
    // extra tab left open, whether or not anyone was looking at it. Skipping
    // the tick entirely while the tab is hidden costs nothing: nothing the
    // user does in a hidden tab needs sub-5s freshness, and the moment the
    // tab becomes visible again the visibilitychange listener below fires an
    // immediate tick instead of waiting up to 5s for the next one.
    const pollTick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
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
          // Leader does the real request and tells everyone else; a
          // follower reuses that answer if it's recent enough, otherwise
          // falls back to asking itself (same as if coordination didn't
          // exist at all) — see the doc comment above isLeader().
          let rev: number;
          const freshBroadcast = lastBroadcastRevRef.current && Date.now() - lastBroadcastRevRef.current.ts < FOLLOWER_REV_FRESHNESS_MS;
          if (isLeader() || !freshBroadcast) {
            const r = await fetch(API_BASE + "/api/rev", { cache: "no-store" });
            const j = await r.json();
            rev = j.rev;
            lastBroadcastRevRef.current = { rev, ts: Date.now() };
            pollChannelRef.current?.postMessage({ type: "rev", rev, ts: Date.now() });
          } else {
            rev = lastBroadcastRevRef.current!.rev;
          }
          if (rev !== revRef.current) {
            // Every tab re-fetching the FULL ~9MB board on every single
            // revision bump (literally any write by anyone) was most of
            // this app's egress — measured at Render as tens of full
            // fetches/hour across open tabs. dpr/qualityInspections/events
            // don't need sub-minute freshness for other users (the author's
            // own change already shows locally via the optimistic apply()
            // update) — so a rev change always pulls the small `lite` state
            // right away, and only whichever heavy collections a page has
            // actually asked for (ensureHeavy) get topped up, at most once
            // every HEAVY_REFRESH_MS, however many revisions passed in
            // between — see below.
            const s = await fetchBoard(true);
            if (acceptState(s)) {
              applyStateSafely(s.rev, patchLiteResponse(s.data, dataRef.current), freshKeysForLite(s.data));
            }
            // Top up only whichever heavy collections a page has already
            // asked for (ensureHeavy) — never the ones nobody's using — and
            // only once every HEAVY_REFRESH_MS regardless of how many
            // revisions passed in between.
            const now = Date.now();
            if (heavyLoadedRef.current.size > 0 && now - lastHeavyRefreshRef.current >= HEAVY_REFRESH_MS) {
              lastHeavyRefreshRef.current = now;
              const names = [...heavyLoadedRef.current];
              fetchBoardWithRetry(2, true, names).then((full) => {
                if (!acceptState(full)) return;
                const patched: any = { ...full.data };
                for (const c of LITE_RESPONSE_PLACEHOLDER_COLLS) {
                  if (!names.includes(c) && dataRef.current && (dataRef.current as any)[c] !== undefined) {
                    patched[c] = (dataRef.current as any)[c];
                  }
                }
                applyStateSafely(full.rev, patched, freshKeysForLite(patched, names));
              }).catch(() => {});
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
        if (acceptState(s)) {
          applyStateSafely(s.rev, s.data);
        } else {
          // Data rejected (e.g. a stale/public snapshot), but the revision
          // number itself is still safe to acknowledge — same monotonic
          // guard, just without touching dataRef/setData.
          const nextRev = Math.max(revRef.current, s.rev);
          setRev(nextRev); revRef.current = nextRev;
        }
        modeRef.current = "live"; setMode("live");
        toast("Back online — your changes were saved");
      } catch {
        // still offline, try again next tick
      }
    };

    // Raised from 5s (2026-11-23) — Atlas dashboard confirmed the free (M0)
    // cluster is under real connection/load pressure (~150-200 concurrent
    // connections); every open tab's own poll is part of that load. 10s
    // roughly halves how often every tab hits the server, at the cost of
    // real-time updates feeling a little less instant — a worthwhile trade
    // while on a free tier (see the tab-hidden pause above, which already
    // skips this entirely for backgrounded tabs).
    const iv = window.setInterval(pollTick, 10000);
    const onVisible = () => { if (!document.hidden) pollTick(); };
    document.addEventListener("visibilitychange", onVisible);

    // BroadcastChannel setup for the leader-election coordination above —
    // feature-detected; `pollChannelRef.current` simply stays null (the
    // permanent fail-open state, isLeader() always true) on any browser/
    // context without support (e.g. some private-browsing modes), so this
    // whole block is additive and never required for correctness.
    let heartbeatIv: number | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("neoteric-poll-leader");
      pollChannelRef.current = channel;
      channel.onmessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "hb" && typeof msg.tabId === "string") {
          knownTabsRef.current.set(msg.tabId, Date.now());
        } else if (msg.type === "rev" && typeof msg.rev === "number") {
          // Any tab's own successful /api/rev read is just as trustworthy
          // as this tab's would have been — take the newest one seen,
          // whoever made the request.
          if (!lastBroadcastRevRef.current || msg.rev !== lastBroadcastRevRef.current.rev || msg.ts > lastBroadcastRevRef.current.ts) {
            lastBroadcastRevRef.current = { rev: msg.rev, ts: msg.ts };
          }
        }
      };
      const sendHeartbeat = () => {
        knownTabsRef.current.set(TAB_ID, Date.now());
        try { channel.postMessage({ type: "hb", tabId: TAB_ID }); } catch {}
      };
      sendHeartbeat(); // announce immediately, don't wait for the first interval tick
      heartbeatIv = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
    }

    return () => {
      stopped = true;
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
      if (heartbeatIv != null) window.clearInterval(heartbeatIv);
      pollChannelRef.current?.close();
      pollChannelRef.current = null;
    };
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
      // `lite`: same reasoning as the initial-load effect — don't make the
      // Sign In button sit on dpr/qualityInspections/events over a slow
      // connection when nothing right after login needs them yet. No
      // automatic heavy top-up here any more — whichever page renders after
      // login calls ensureHeavy() for what it actually needs.
      if (needsFullBoardAfterLogin(lastStatePublicRef.current)) {
        try {
          const s = await fetchBoardWithRetry(2, true);
          if (s && s.data && !s.public) {
            lastStatePublicRef.current = false;
            applyStateSafely(s.rev, patchLiteResponse(s.data, dataRef.current), freshKeysForLite(s.data));
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
      sessionExpiredFlaggedRef.current = false;
      setLoggedIn(true);
      // The freshly-stored token changes whose batches count as "mine" —
      // recompute right away so someone signing into a device that still
      // holds a PREVIOUS person's stuck queue doesn't see that badge.
      setPendingCount(countMine());
      return null;
    } catch {
      return "Can't reach the server. Try again.";
    }
  }, [setCurrentUserId, countMine, applyStateSafely, freshKeysForLite]);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch {}
    setLoggedIn(!LOGIN_GATE_ENABLED ? true : false);
    setPendingCount(countMine()); // no token now — only ownerless/legacy batches still count
  }, [countMine]);

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
    login, logout, toast: pageToast, apply, me, myRole, ensureHeavy, isHeavyLoaded
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

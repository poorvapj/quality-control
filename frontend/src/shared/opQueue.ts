import type { Op } from "../types";

/* Pure logic for the offline/retry queue (AppContext.tsx owns the React state
   and localStorage; this file owns the rules, so they can be unit-tested
   without a browser — see frontend/tests/opQueue.test.mjs).

   Why batches carry an id: a request can be applied by the server while the
   response is lost (dropped signal, sleeping free-tier dyno, 5xx after commit).
   Replaying it must not apply it twice — the server remembers the id of every
   batch it has applied (POST /api/ops `batchId`) and treats a repeat as done. */

export interface QueuedBatch {
  id: string;
  ops: Op[];
  /** userId of the token the batch was created under; null = created signed-out (public form); undefined = legacy entry */
  by?: string | null;
  at?: number;
}

/* ------------------------------------------------------------------ ids */

export function newBatchId(): string {
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

// Deterministic (FNV-1a) so two tabs that both upgrade the same legacy queue
// entry derive the SAME id and the server can de-duplicate them.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/* The queue used to be stored as Op[][] (an array of bare ops arrays). Entries
   in that shape are upgraded in place; the new shape is {id, ops, by, at}. */
export function normalizeQueue(raw: unknown): QueuedBatch[] {
  if (!Array.isArray(raw)) return [];
  const out: QueuedBatch[] = [];
  raw.forEach((entry, i) => {
    if (Array.isArray(entry)) {
      if (entry.length) out.push({ id: "legacy-" + fnv1a(JSON.stringify(entry)) + "-" + i, ops: entry as Op[] });
    } else if (entry && typeof entry === "object" && Array.isArray((entry as any).ops) && typeof (entry as any).id === "string") {
      out.push(entry as QueuedBatch);
    }
  });
  return out;
}

/* Who owns a JWT — read from its (unverified) payload, only to decide whether
   a queued batch may be sent with the current token. The server still verifies
   the token; this never grants anything. */
export function tokenUserId(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = decodeURIComponent(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")).split("").map((ch) => "%" + ("00" + ch.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    const id = JSON.parse(json).userId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- outcomes */

export type SendOutcome = "sent" | "retry-later" | "rejected";

/* What an HTTP status from POST /api/ops means for a queued batch.
   - 2xx                         applied → remove it
   - 401, 408, 425, 429, 5xx     NOT a verdict on the edit itself (expired session, overloaded or
                                 sleeping server) → keep it and try again later
   - any other 4xx               the server examined and refused it (validation, permission,
                                 stage conflict…); retrying can never succeed → remove it
   Network failures never reach here (fetch throws) and are always "retry later". */
export function classifyStatus(status: number, unauthorizedRetryable = true): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 401) return unauthorizedRetryable ? "retry-later" : "rejected";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry-later";
  return "rejected";
}

/* A 401 only means "session expired, sign in again" when there IS a session
   that can be renewed: the batch was made under a user's token and a token is
   still stored. For a batch made signed-out (the public DPR / drawing-request /
   form pages) — or with no token stored at all — a 401 is the server's final
   answer (e.g. "that id already exists, sign-in required"); retrying can never
   succeed and would block every batch queued behind it. */
export function unauthorizedIsRetryable(batch: QueuedBatch, currentTokenUser: string | null): boolean {
  return batch.by !== null && currentTokenUser !== null;
}

/* May this batch be sent right now? A batch made by user A must never be
   replayed under user B's token (approvals and permissions are decided from the
   token). Signed-out batches (public forms) and legacy entries stay sendable. */
export function canSendNow(batch: QueuedBatch, currentTokenUser: string | null): boolean {
  if (batch.by === undefined || batch.by === null) return true;
  return batch.by === currentTokenUser;
}

export interface FlushDeps {
  getQueue(): QueuedBatch[];
  /** remove one batch (by id) from the persisted queue */
  remove(id: string): void;
  /** POST the batch; throws on a network failure */
  send(batch: QueuedBatch): Promise<{ status: number; error?: string }>;
  currentTokenUser: string | null;
  onRejected?(batch: QueuedBatch, error: string): void;
}

/* Replays queued batches oldest-first. Stops at the first batch that could not
   be delivered so nothing is sent out of order; batches that belong to another
   signed-in user are left alone (and skipped over). Returns true only when the
   queue is completely empty afterwards. */
export async function flushQueue(deps: FlushDeps): Promise<boolean> {
  const skipped = new Set<string>();
  for (;;) {
    const next = deps.getQueue().find((b) => !skipped.has(b.id));
    if (!next) break;
    if (!canSendNow(next, deps.currentTokenUser)) { skipped.add(next.id); continue; }
    let res: { status: number; error?: string };
    try {
      res = await deps.send(next);
    } catch {
      return false; // network failure — keep everything, try again next tick
    }
    const outcome = classifyStatus(res.status, unauthorizedIsRetryable(next, deps.currentTokenUser));
    if (outcome === "retry-later") return false;
    deps.remove(next.id);
    if (outcome === "rejected" && deps.onRejected) deps.onRejected(next, res.error || "rejected by the server");
  }
  return deps.getQueue().length === 0;
}

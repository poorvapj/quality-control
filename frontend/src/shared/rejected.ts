import type { Op } from "../types";

/* A change the server REFUSED (a 4xx: not allowed, id already exists, validation...) is removed from the screen and from
   the offline queue — but it used to vanish without a trace, so the typed-in data was gone for good. It is now also kept
   in a small, bounded list in this browser (localStorage "neoteric_rejected_ops") so it can be looked at and re-entered.

   Plaintext passwords are NEVER kept (same rule as the local board, see applyOpsLocal.ts): a `users` upsert is stored
   without its `password`. Pure helpers here; AppContext.tsx owns the storage. Tested in tests/rejected.test.mjs. */
export interface RejectedEntry {
  at: number;
  error: string;
  ops: Op[];
}

export const REJECTED_KEY = "neoteric_rejected_ops";
export const REJECTED_CAP = 25;

/* Deep-copies the ops, dropping every `password` field of a users upsert. */
export function redactOps(ops: Op[]): Op[] {
  let copy: Op[];
  try { copy = JSON.parse(JSON.stringify(ops)); } catch { return []; }
  for (const op of copy as any[]) {
    if (op && op.op === "upsert" && op.coll === "users" && op.rec && typeof op.rec === "object" && "password" in op.rec) delete op.rec.password;
  }
  return copy;
}

export function parseRejected(raw: unknown): RejectedEntry[] {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v.filter((e) => e && typeof e === "object" && Array.isArray((e as any).ops) && typeof (e as any).at === "number") as RejectedEntry[];
}

/* Returns the new list (newest last), keeping at most `cap` entries. */
export function addRejected(raw: unknown, ops: Op[], error: string, at: number = Date.now(), cap: number = REJECTED_CAP): RejectedEntry[] {
  const list = parseRejected(raw);
  list.push({ at, error: String(error || "rejected by the server").slice(0, 300), ops: redactOps(ops) });
  return list.slice(-cap);
}

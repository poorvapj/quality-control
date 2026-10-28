import type { BoardData, Op } from "../types";

/* Mirror of the server's op handler so optimistic updates match exactly.
   (Moved out of context/AppContext.tsx unchanged, apart from the password rule below,
   so it can be unit-tested without React — see frontend/tests/applyOpsLocal.test.mjs.)

   PASSWORDS: a `users` upsert from Add User / Masters carries a plaintext `password`
   (the server hashes it and never stores or returns it). The board kept in the browser
   — in memory and in the localStorage snapshot — must never hold it, so it is left out
   of the LOCAL copy. The `ops` array itself is NOT modified: the request (and an
   offline-queued batch, which has to keep it until it is delivered) still carries it
   to the server. */
export function localRecord(coll: string, rec: any): any {
  if (coll === "users" && rec && Object.prototype.hasOwnProperty.call(rec, "password")) {
    const { password: _omitted, ...rest } = rec;
    return rest;
  }
  return rec;
}

/* Removes a plaintext password from every user in a board snapshot (defensive: a snapshot
   written by an older version of the app may contain one). Mutates and returns the board. */
export function scrubLocalBoard<T extends { users?: any[] } | null>(board: T): T {
  if (board && Array.isArray((board as any).users)) {
    for (const u of (board as any).users) if (u && typeof u === "object" && "password" in u) delete u.password;
  }
  return board;
}

/* A key like "grants.masters" (set by the Permission Matrix so two admins editing the same user's access do not
   overwrite each other) sets ONE nested entry; a null value removes it. Copy-on-write along the path, so objects shared
   with the previous board state are never mutated. Mutates `rec` (a fresh copy made by the caller). */
export function applyDottedKeys(rec: Record<string, any>) {
  for (const key of Object.keys(rec)) {
    if (!key.includes(".") || key.startsWith(".") || key.endsWith(".") || key.startsWith("$")) continue;
    const value = rec[key];
    delete rec[key];
    const parts = key.split(".");
    let cur: any = rec;
    for (let j = 0; j < parts.length - 1; j++) {
      const p = parts[j];
      cur[p] = cur[p] && typeof cur[p] === "object" && !Array.isArray(cur[p]) ? { ...cur[p] } : {};
      cur = cur[p];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete cur[last]; else cur[last] = value;
  }
}

export function applyOpsLocal(d: BoardData, ops: Op[]) {
  for (const op of ops) {
    if (op.op === "upsert") {
      const list = ((d as any)[op.coll] = (d as any)[op.coll] || []);
      const rec = localRecord(String(op.coll), op.rec);
      const i = list.findIndex((r: any) => r.id === rec.id);
      const pushed = (op as any).push;
      // a copy when something is appended, so the op that is sent to the server keeps its rec exactly as built
      const hasDotted = Object.keys(rec).some((k) => k.includes("."));
      const merged = i === -1 ? (pushed || hasDotted ? Object.assign({}, rec) : rec) : Object.assign({}, list[i], rec);
      if (pushed && typeof pushed === "object") {
        for (const [k, v] of Object.entries(pushed)) (merged as any)[k] = (Array.isArray((merged as any)[k]) ? (merged as any)[k] : []).concat([v]);
      }
      applyDottedKeys(merged as any);
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

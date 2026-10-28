import type { Approval, Op } from "../types";

/* The save that records an approval decision: ONLY the id and the decision, never the whole record as it was on this
   screen. The server validates it against the STORED record (approval rules, and the measurement's own validation), so
   another person's change to any other field of the same record is not written back with an old value.
   (Kept free of other imports so it can be unit-tested — tests/dataIntegrity.test.mjs.) */
export function buildDecisionOp(coll: string, rec: { id: string; approval?: Approval }, status: "approved" | "rejected", remark?: string, base?: Approval): Op {
  return { op: "upsert", coll, rec: { id: rec.id, approval: { ...((base ?? rec.approval) as Approval), status, remark: remark?.trim() || undefined } } } as unknown as Op;
}

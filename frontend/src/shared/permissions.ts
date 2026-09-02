/* ===========================================================================
   Fine-grained, per-user permission grants for the Drawing Requests review
   chain. Deliberately NOT tied to the coarse `role` field on User — more than
   one person can share a role but only some are authorized for a given
   stage. Stored in a standalone `permissions` collection (one record per
   user, id === userId), separate from the User master record.

   DRI does NOT get a role-based bypass here, unlike the rest of the app —
   Drawing Request review/approval is deliberately restricted to the Admin
   account (U-ADMIN) plus whoever is explicitly granted a stage via the
   per-user `permissions` collection (e.g. a GM reviewing Stage 1
   screening). A DRI account only gets a stage if they're also granted it
   there.
   =========================================================================== */

import type { BoardData, Role, UserPermission } from "../types";
import { coll } from "./rules";

export type StageKey = "canScreenStage1" | "canProduceStage2" | "canCrosscheckStage3" | "canFinalApproveStage4";

export function getUserPermission(data: BoardData | null, userId: string | null): UserPermission | null {
  if (!userId) return null;
  return coll(data, "permissions").find((p) => p.userId === userId) || null;
}

export function canActOnStage(data: BoardData | null, userId: string | null, role: Role, stageKey: StageKey): boolean {
  if (userId === "U-ADMIN") return true; // Admin account bypass
  const p = getUserPermission(data, userId);
  return !!p && !!p[stageKey];
}

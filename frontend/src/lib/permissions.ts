/* ===========================================================================
   Fine-grained, per-user permission grants for the Drawing Requests review
   chain. Deliberately NOT tied to the coarse `role` field on User — more than
   one person can share a role but only some are authorized for a given
   stage. Stored in a standalone `permissions` collection (one record per
   user, id === userId), separate from the User master record.

   The existing "DRI" role already acts as the board's owner/super-admin
   everywhere else in this app (Masters edit rights, resets, etc.) — the spec
   says a super-admin/owner role must always bypass the per-user check, so
   DRI is that bypass role here too, for consistency with the rest of the app.
   =========================================================================== */

import type { BoardData, Role, UserPermission } from "../types";
import { coll } from "./rules";

export type StageKey = "canScreenStage1" | "canProduceStage2" | "canCrosscheckStage3" | "canFinalApproveStage4";

export function getUserPermission(data: BoardData | null, userId: string | null): UserPermission | null {
  if (!userId) return null;
  return coll(data, "permissions").find((p) => p.userId === userId) || null;
}

export function canActOnStage(data: BoardData | null, userId: string | null, role: Role, stageKey: StageKey): boolean {
  if (role === "DRI") return true; // super-admin/owner bypass
  const p = getUserPermission(data, userId);
  return !!p && !!p[stageKey];
}

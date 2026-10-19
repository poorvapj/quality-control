/* Leader approval for a team member's Quality Inspections and Measurements.

   Rule: a record saved by someone who belongs to a Team (and isn't that team's
   leader) is created "pending" and names the leader as its approver. Only that
   leader (or an Admin) can approve or reject it, never the person who made it.
   "Leader" means the team's CURRENT leader, so changing a team's leader moves
   its pending work to the new one.
   Rejected work is sent back: the record stays "rejected" with the leader's
   remark and the member records a new one. Records saved before this existed
   (no approval on them) can still be decided by their author's team leader. Records by Admins, leaders, or
   people on no team carry no approval at all.

   Approval is a REVIEW FLAG only — it changes nothing else: no billing,
   no quality status, no snag, no production record is touched by it.

   This is pure and server-authoritative: whatever approval fields a browser
   sends are ignored on create and only status changes by the right person
   are honoured on update, so a member can neither skip review nor approve
   their own work. */

const STATUSES = ["pending", "approved", "rejected"];
const MAX_REMARK = 500;

/** What approval a brand-new record by `creatorId` must be created with (null = none). */
function deriveApprovalOnCreate({ creatorId, users, teams }) {
  const user = (users || []).find((u) => u.id === creatorId);
  if (!user || !user.teamId) return null;
  const team = (teams || []).find((t) => t.id === user.teamId);
  if (!team || !team.leaderId || team.leaderId === creatorId) return null;
  const leader = (users || []).find((u) => u.id === team.leaderId);
  return { status: "pending", approverUserId: team.leaderId, approverName: (leader && leader.name) || "" };
}

/** What approval an UPDATED record may end up with.
 *  existing = stored record; incoming = what the client sent; session = {userId, isAdmin}.
 *  Returns { ok:true, approval } (approval may be undefined = none) or { ok:false, status, error }. */
function resolveApprovalOnUpdate({ existing, incoming, session, creatorId, now, users, teams }) {
  let before = existing && existing.approval;
  const wanted = incoming && incoming.approval;

  // A record saved BEFORE approval existed carries none. If its author is on a
  // team, it counts as awaiting that team's leader, so the leader can still
  // approve or reject it — otherwise everything recorded before the feature
  // went live could never be reviewed. (Only a decision creates the approval;
  // a client can't attach a "pending" one.) Records by non-team people stay free.
  if (!before && wanted && wanted.status !== "pending" && users && teams) {
    before = deriveApprovalOnCreate({ creatorId, users, teams }) || undefined;
  }

  // never let a client add approval to a record that has none
  if (!before) return { ok: true, approval: undefined };

  // WHO may decide is the author's team leader NOW, not whoever was leader when
  // the record was saved: if a team's leader is set or changed later, its
  // pending work moves to the new leader. (Falls back to the stored approver
  // when the author is no longer on a team, or no team data was supplied.)
  const current = users && teams ? deriveApprovalOnCreate({ creatorId, users, teams }) : null;
  const approverId = (current && current.approverUserId) || before.approverUserId;
  const approverName = (current && current.approverName) || before.approverName || "";
  // no change requested (or fields tampered while status is unchanged) -> keep exactly what is stored
  if (!wanted || wanted.status === before.status) return { ok: true, approval: before };
  if (!STATUSES.includes(wanted.status)) return { ok: false, status: 400, error: "Invalid approval status" };

  // a stale copy that still says "pending" never reopens anything — keep what is stored
  if (wanted.status === "pending") return { ok: true, approval: before };
  // only pending work can be decided; approved/rejected are final (a redo is a new record)
  if (before.status !== "pending") {
    return { ok: false, status: 403, error: `This record is already ${before.status}` };
  }

  const isApprover = !!session && (session.isAdmin || session.userId === approverId);
  if (!isApprover) return { ok: false, status: 403, error: "Only this person's team leader can approve or reject it" };
  if (session.userId === creatorId) return { ok: false, status: 403, error: "You can't approve your own work" };

  const remark = typeof wanted.remark === "string" ? wanted.remark.trim().slice(0, MAX_REMARK) : "";
  if (wanted.status === "rejected" && !remark) return { ok: false, status: 400, error: "A remark is required when rejecting" };
  return {
    ok: true,
    approval: {
      status: wanted.status,
      approverUserId: approverId,
      approverName,
      decidedByUserId: session.userId,
      decidedAt: now || Date.now(),
      remark: remark || undefined
    }
  };
}

/** Every record that is waiting on someone right now, and who holds it.
 *  records = { <collection>: [record, …], … }. A record counts if it has a pending
 *  approval, OR if it has none at all (saved before approval existed) but its
 *  author is on a team — those are decided by that team's leader too. The holder
 *  is the author's CURRENT team leader, falling back to the approver stored on
 *  the record. Never the author themselves. */
function findPendingApprovals({ records, users, teams }) {
  const out = [];
  for (const coll of Object.keys(records || {})) {
    for (const rec of records[coll] || []) {
      const creatorId = rec.inspectorUserId || rec.recordedByUserId;
      const current = deriveApprovalOnCreate({ creatorId, users, teams });
      let approverUserId;
      if (rec.approval) {
        if (rec.approval.status !== "pending") continue;
        approverUserId = (current && current.approverUserId) || rec.approval.approverUserId;
      } else {
        if (!current) continue;
        approverUserId = current.approverUserId;
      }
      if (!approverUserId || approverUserId === creatorId) continue;
      out.push({ coll, rec, approverUserId });
    }
  }
  return out;
}

module.exports = { deriveApprovalOnCreate, resolveApprovalOnUpdate, findPendingApprovals, STATUSES };

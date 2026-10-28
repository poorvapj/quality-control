#!/usr/bin/env node
/*
 * Neoteric Tower Quality Board — API server.
 * Storage: MongoDB (Atlas). Photos: Cloudinary. Node 18+.
 *
 *   node server.js              # http://localhost:5173
 *   node server.js --port 8080
 *
 * Serves the sibling ../frontend folder as static files (handy for local dev,
 * so one `node server.js` gives you the whole app) AND exposes the shared
 * board state as a JSON API backed by MongoDB, so every device that points
 * at this server's URL reads and writes ONE board, live (5s poll).
 *
 * Required env (see .env.example):
 *   MONGODB_URI, MONGODB_DB, CLOUDINARY_URL, ALLOWED_ORIGIN, JWT_SECRET
 *
 * Cloudinary credentials are read ONLY from CLOUDINARY_URL (the SDK picks it
 * up automatically) — never split into separate cloud_name/key/secret vars.
 * Every upload lands under ProjectQuality/<type> in your Cloudinary account,
 * alongside (not touching) any existing VMS assets in other folders.
 *
 * API
 *   GET  /api/rev           -> {rev}                          cheap poll
 *   GET  /api/state         -> {rev, data}                     full snapshot (password hashes stripped)
 *   POST /api/login         -> {user} | 401                    email+password check (scrypt, server-side only)
 *   POST /api/ops           -> {rev, data}                     apply ops, bump rev
 *   POST /api/photo         -> {url, publicId}                 upload to Cloudinary
 *   POST /api/reset         -> {rev, data}                     reseed or blank
 *   POST /api/backups       -> {id, createdAt, ...}            create a backup now (admin)
 *   GET  /api/backups       -> {backups: [...]}                list backups, newest first (admin)
 *   GET  /api/backups/:id   -> {collections, progress}         one backup's data, passwords stripped (admin)
 *   POST /api/backups/:id/restore -> {rev, data}                overwrite the live board with a backup (admin)
 *   DELETE /api/backups/:id -> {ok}                              permanently remove a backup (admin)
 *   GET  /api/backup/scheduled    -> {id, createdAt, ...}       cron-triggered backup, no login — needs
 *                                                                X-Cron-Secret header matching BACKUP_CRON_SECRET
 *   POST /api/automation/drawing-requests/:id/decision -> {request}  approve/return/resubmit a drawing
 *                                                                request from an unattended caller (e.g. n8n
 *                                                                reacting to a Slack button click) — needs
 *                                                                X-Automation-Secret header matching
 *                                                                AUTOMATION_SECRET. Fires N8N_WEBHOOK_URL (if
 *                                                                set) on every real reviewStatus change, from
 *                                                                this route AND from a normal /api/ops upsert.
 *
 * n8n / Slack notifications (see notifyEvent, below): if N8N_WEBHOOK_URL is
 * set, every drawing-request stage change, new/reassigned work assignment,
 * new/reassigned snag, and snag reopen POSTs one JSON event there —
 * {eventType, ...}. Routing that to an actual DM + a shared Slack channel is
 * an n8n workflow, not this server; each payload carries the target's
 * *Email field so n8n can resolve them to a Slack user.
 */

require("dotenv").config();

const http = require("http");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const cloudinary = require("cloudinary").v2;
const { seedData, blankData, COLLECTIONS } = require("./seed.js");
const { handleVmsDprSync, vmsSyncWroteRecord } = require("./vmsDprApiHandler.js");
const { getExecutionReconciliation, requiresAdmin } = require("./executionReconciliation.js");
const { getVmsWorkItems } = require("./vmsWorkItems.js");
const { shouldResolveOriginal, enforceResultFromChecklist } = require("./qualityInspectionRules.js");
const { validateMeasurement } = require("./materialMeasurementRules.js");
const { getProgressAnalysis } = require("./progressAnalysis.js");
const workMeasurements = require("./workMeasurementRules.js");
const { getVmsDrawingRequests } = require("./vmsDrawingRequests.js");
const { deriveApprovalOnCreate, resolveApprovalOnUpdate, findPendingApprovals } = require("./approvalRules.js");
const approvalSlack = require("./approvalSlack.js");
const { createOpsBatchStore, isValidBatchId } = require("./opsBatch.js");
const { classifyError } = require("./errorMap.js");
const backups = require("./backups.js");
const { createStateBuilder } = require("./stateBuilder.js");
const { createSaveDiagnostics, isEnabled: saveDiagnosticsEnabled } = require("./saveDiagnostics.js");
// OFF unless SAVE_DIAGNOSTICS=1. Log-only comparison of the proposed "clean save" rule against what the server really
// does to a saved batch (see saveDiagnostics.js and docs/save-diagnostics.md). Never changes a response or a write.
const saveDiag = saveDiagnosticsEnabled()
  ? createSaveDiagnostics({
      collections: COLLECTIONS,
      summaryEvery: parseInt(process.env.SAVE_DIAGNOSTICS_SUMMARY_EVERY, 10) || 25,
      examplesPerKey: parseInt(process.env.SAVE_DIAGNOSTICS_EXAMPLES, 10) || 3
    })
  : null;
if (saveDiag) console.log("  save diagnostics: ON (log-only, bounded; see docs/save-diagnostics.md)");
const { createPhotoGuard, clientIp, guardLogLine } = require("./photoGuard.js");
const { buildPublicState } = require("./publicState.js");
// OFF by default. Turning it on makes GET /api/state and the /api/ops reply return only the allow-listed public
// snapshot (publicState.js) to callers without a valid session. Older frontends fetch /api/state WITHOUT a token,
// so enabling this before the new frontend is live (and old tabs have reloaded) would blank their board.
// Order: deploy backend -> deploy frontend -> wait for old tabs to reload -> set PUBLIC_STATE_ENFORCE=1.
const PUBLIC_STATE_ENFORCE = process.env.PUBLIC_STATE_ENFORCE === "1";
const photoGuard = createPhotoGuard();
// Which X-Forwarded-For entry is the real client (1 = last, added by the nearest trusted proxy). Unset = leftmost.
// Check what Render sends for this service before setting it; the global upload cap protects either way.
// Monitor-only until PHOTO_GUARD_ENFORCE=1: older frontends send no token on /api/photo, so a signed-in
// user looks anonymous to the server. Deploy the frontend that sends the token first, check the logs
// for "monitor-only, would refuse" lines, then set the flag.
const PHOTO_GUARD_ENFORCE = process.env.PHOTO_GUARD_ENFORCE === "1";
const CLIENT_IP_HOPS_FROM_RIGHT = parseInt(process.env.CLIENT_IP_HOPS_FROM_RIGHT, 10) || 0;
const opsBatch = createOpsBatchStore(() => mongoDb); // /api/ops retry idempotency, see opsBatch.js
// Both OFF unless set to exactly "1" (docs/data-integrity-fixes.md):
//  OPS_ATOMIC=1            a whole /api/ops batch is written in ONE database transaction (all or nothing); Slack
//                          notifications are sent after it commits. Needs a replica set (Atlas is); falls back to the old
//                          non-atomic writes if transactions are unavailable.
//  PROGRESS_CELL_MERGE=1   an item-based stage's checklist (cells keyed by itemId) is MERGED cell by cell on the server
//                          instead of the whole array being replaced, so two people working on different items of the
//                          same unit/stage cannot overwrite each other.
const OPS_ATOMIC = process.env.OPS_ATOMIC === "1";
const PROGRESS_CELL_MERGE = process.env.PROGRESS_CELL_MERGE === "1";
//  EVENTS_ARCHIVE_DAYS=N   when the audit log is trimmed to its 5000 newest events, the trimmed ones are MOVED to
//                          collection eventsArchive and kept N days (instead of being deleted). Unset/0 = old behaviour.
const EVENTS_ARCHIVE_DAYS = Math.max(0, parseInt(process.env.EVENTS_ARCHIVE_DAYS, 10) || 0);
const { sanitizePoEvent, matchProjectByName, isStaleUpdate } = require("./imsWebhook.js");
const { buildTeamDailyReport, slackSummaryFor } = require("./teamDailyReports.js");
const { verifySlackSignature, parseSlackActionPayload, parseActionId, snagCloseBlocks, teamReportApproveBlocks } = require("./slackActions.js");

/* ------------------------------------------------------------- passwords
   Node's built-in scrypt is our own hashing scheme going forward. Plaintext
   passwords are NEVER stored or returned; only passwordHash/passwordSalt
   live in Mongo, and getState() strips both before any /api/state response
   leaves the server.

   legacyPasswordHash: a small number of imported users carry their real
   bcrypt hash from a previous system (their actual password was never
   known to us — bcrypt hashes can't be converted to scrypt directly). On
   their first successful login we verify against bcrypt, then transparently
   re-hash to scrypt and drop the legacy field, so every account converges
   on the same scheme within one login. */
const bcrypt = require("bcryptjs");

/* --------------------------------------------------------------- sessions
   Signed JWTs — stateless, so "who's admin" is a real server-verified
   claim (not a client-held convenience) that also survives a server
   restart/redeploy without forcing every signed-in user to log in again,
   unlike an in-memory session store.

   ADMIN_USER_ID names the one account whose token is trusted for
   admin-gated ops (deletes, and any write to the users collection) —
   matches the frontend's existing "U-ADMIN" convention.

   Tradeoff to know: a JWT can't be revoked before it expires — deactivating
   a user or changing their password doesn't invalidate a token they already
   hold. SESSION_TTL bounds how long that window can last. */
const jwt = require("jsonwebtoken");
const ADMIN_USER_ID = "U-ADMIN";
const SESSION_TTL = "7d";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not set — see .env.example. Refusing to start with no signing key.");
}
const JWT_SECRET = process.env.JWT_SECRET;

function issueSession(user) {
  return jwt.sign({ userId: user.id, isAdmin: user.id === ADMIN_USER_ID }, JWT_SECRET, { expiresIn: SESSION_TTL });
}

/* --------------------------------------------------- drawing-request review
   Stage transitions used to exist ONLY on the frontend (hooks/useDrawing
   RequestActions.ts) — the generic /api/ops upsert endpoint accepted any
   reviewStatus a client sent, with no server-side check that it was a real
   transition from the record's current stage. That's fine for a normal
   logged-in user (the UI only ever offers the valid next step), but it's not
   safe to expose to an unattended caller like an n8n workflow: a leaked or
   guessed AUTOMATION_SECRET should only ever be able to advance a ticket
   through its real state machine, never jump it anywhere.

   This map is the single source of truth for "what's a legal next stage" —
   both the generic ops path (assertOpAllowed, below) and the dedicated
   automation endpoint (performDrawingRequestDecision) check against it. */
const DRAWING_TRANSITIONS = {
  "stage-1-screen": ["stage-2-produce", "returned"],
  "stage-2-produce": ["stage-3-crosscheck"],
  "stage-3-crosscheck": ["stage-4-final-approve", "stage-2-produce"],
  "stage-4-final-approve": ["approved", "stage-2-produce"],
  returned: ["stage-1-screen"],
  approved: []
};

/* Which per-user `permissions` grant (frontend/src/shared/permissions.ts)
   authorizes moving a ticket FORWARD off a given stage. Mirrors that
   file's canActOnStage() exactly — this is now checked server-side too
   (see assertOpAllowed), not just used to decide what the UI shows. */
const STAGE_TO_PERMISSION_KEY = {
  "stage-1-screen": "canScreenStage1",
  "stage-2-produce": "canProduceStage2",
  "stage-3-crosscheck": "canCrosscheckStage3",
  "stage-4-final-approve": "canFinalApproveStage4"
};

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const AUTOMATION_SECRET = process.env.AUTOMATION_SECRET || "";
// Phase 2 VMS->QC API sync — same shared-secret convention as
// AUTOMATION_SECRET/BACKUP_CRON_SECRET above (no user session; VMS is an
// unattended server-to-server caller, not a logged-in person).
const VMS_SYNC_SECRET = process.env.VMS_SYNC_SECRET || "";
// .trim() defends against a trailing newline/space from pasting the value
// into a dashboard's env-var field — a very common way this silently
// breaks without ever showing up when you look at the value.
const IMS_WEBHOOK_SECRET = (process.env.IMS_WEBHOOK_SECRET || "").trim();

/* ------------------------------------------------------- Slack (no n8n)
   Talks to Slack's Web API directly with a bot token — no middleman
   workflow tool needed. Two things a bot token can do that's enough here:
     - users.lookupByEmail  turns an app user's email into a Slack user id
     - chat.postMessage     to that user id opens/reuses a DM; to a channel
                             id posts there — same call either way
   SLACK_BOT_TOKEN needs scopes: chat:write, users:read.email
   Both env vars optional — everything below is a no-op with either unset. */
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "";
// Separate from the bot token — this is the Slack app's "Signing Secret"
// (Basic Information page), used only to verify that a POST to
// /api/slack/actions genuinely came from Slack. Required for the
// Close Snag / Approve Report buttons below to work at all; that endpoint
// 501s without it. Also needs Slack's own "Interactivity & Shortcuts" On
// with its Request URL pointed at /api/slack/actions — a one-time setup
// step only the Slack app's owner can do.
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

// email -> Slack user id | null. Small and long-lived (emails rarely change
// Slack accounts) — avoids one lookupByEmail call per notification.
const slackUserIdByEmail = new Map();

async function slackUserIdForEmail(email, knownSlackId) {
  // A manually-entered Slack Member ID on the user record (Masters ▸ User /
  // Add New User) skips the live lookupByEmail call entirely — also covers
  // accounts where the Slack profile's email doesn't match this app's.
  if (knownSlackId) return knownSlackId;
  if (!email || !SLACK_BOT_TOKEN) return null;
  if (slackUserIdByEmail.has(email)) return slackUserIdByEmail.get(email);
  try {
    const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });
    const json = await res.json();
    const id = json.ok ? json.user.id : null;
    if (!json.ok) console.error("Slack users.lookupByEmail:", json.error, email);
    slackUserIdByEmail.set(email, id);
    return id;
  } catch (e) {
    console.error("Slack users.lookupByEmail failed:", e.message);
    return null;
  }
}

// Everyone listed here gets a text-only COPY of every Slack notification the app
// sends to anyone else (Poorva, by default). Set SLACK_COPY_TO_EMAILS to a
// comma-separated list to change who, or to an empty value to switch it off.
const SLACK_COPY_TO_EMAILS = (process.env.SLACK_COPY_TO_EMAILS !== undefined ? process.env.SLACK_COPY_TO_EMAILS : "poorva@neotericgrp.in")
  .split(",").map((e) => e.trim()).filter(Boolean);

// Only the real production database should ever page a real person on
// Slack — a local/dev run (MONGODB_DB unset or pointing at a dev/test
// database) talks to test data, and a stray approval ping from that to
// someone's actual Slack DM is confusing at best. Checked once, here, at
// the one place a message is actually sent — not by chasing down every
// call site that might send one.
const LIVE_SLACK_DB = "project_quality";
const slackEnabledForThisDb = process.env.MONGODB_DB === LIVE_SLACK_DB;

// The one place a message is actually sent. Returns Slack's reply (it carries the
// DM channel id and the message ts, needed to update the message later).
async function slackPostRaw(channel, text, blocks) {
  if (!slackEnabledForThisDb) { console.log(`Slack message suppressed (MONGODB_DB=${process.env.MONGODB_DB || "unset"}, not ${LIVE_SLACK_DB}):`, text); return null; }
  if (!SLACK_BOT_TOKEN || !channel) return null;
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(blocks ? { channel, text, blocks } : { channel, text })
    });
    const json = await res.json();
    if (!json.ok) console.error("Slack chat.postMessage:", json.error, channel);
    return json;
  } catch (e) {
    console.error("Slack chat.postMessage failed:", e.message);
    return null;
  }
}

// Every notification goes through here, so the copy to the observers happens
// for all of them — current and future — without each call site remembering.
// A copy is plain text (no buttons: it must never be clickable as the real
// request), is skipped when the observer IS the recipient (no double message),
// and is never itself copied. `opts.to` is just a label for who it went to.
async function slackPostMessage(channel, text, blocks, opts = {}) {
  const posted = await slackPostRaw(channel, text, blocks);
  if (!opts.noCopy) {
    for (const email of SLACK_COPY_TO_EMAILS) {
      try {
        const uid = await slackUserIdForEmail(email);
        if (!uid || uid === channel) continue;
        // the copy keeps the buttons (the server still checks who may press them), so an
        // observer who is allowed to decide can act from her own copy
        const label = opts.to ? `📋 _Copy of a Slack notification sent to *${opts.to}*_` : "📋 _Copy of a Slack notification_";
        await slackPostRaw(uid, approvalSlack.observerCopyText(opts.to || "", text), blocks && blocks.length ? [{ type: "context", elements: [{ type: "mrkdwn", text: label }] }, ...blocks] : undefined);
      } catch (e) {
        console.error("Slack observer copy failed:", e.message);
      }
    }
  }
  return posted;
}

async function slackOpenView(triggerId, view) {
  if (!SLACK_BOT_TOKEN || !triggerId) return;
  try {
    const res = await fetch("https://slack.com/api/views.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ trigger_id: triggerId, view })
    });
    const json = await res.json();
    if (!json.ok) console.error("Slack views.open:", json.error);
  } catch (e) {
    console.error("Slack views.open failed:", e.message);
  }
}

// Replaces a message we sent earlier with plain text (drops its buttons).
async function slackUpdateMessage(channel, ts, text) {
  if (!slackEnabledForThisDb) { console.log(`Slack update suppressed (MONGODB_DB=${process.env.MONGODB_DB || "unset"}, not ${LIVE_SLACK_DB}):`, text); return; }
  if (!SLACK_BOT_TOKEN || !channel || !ts) return;
  try {
    const res = await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, ts, text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] })
    });
    const json = await res.json();
    if (!json.ok) console.error("Slack chat.update:", json.error);
  } catch (e) {
    console.error("Slack chat.update failed:", e.message);
  }
}

// Reverse of slackUserIdForEmail — given the Slack user id who clicked an
// interactive button, finds which app User that is, by their Slack
// profile's email. Needed because Slack's action payload only ever carries
// its own internal user id, never anything of ours. Small/long-lived
// cache, same reasoning as slackUserIdByEmail above.
const emailBySlackUserId = new Map();
async function appUserForSlackUserId(slackUserId) {
  if (!SLACK_BOT_TOKEN || !slackUserId) return null;
  let email = emailBySlackUserId.get(slackUserId);
  if (email === undefined) {
    try {
      const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
      });
      const json = await res.json();
      email = json.ok ? json.user?.profile?.email || null : null;
      if (!json.ok) console.error("Slack users.info:", json.error, slackUserId);
    } catch (e) {
      console.error("Slack users.info failed:", e.message);
      email = null;
    }
    emailBySlackUserId.set(slackUserId, email);
  }
  if (!email) return null;
  return mongoDb.collection("users").findOne({ email: new RegExp("^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
}

/* One line of Slack copy per event type, plus who the DM goes to. Returning
   null means "nothing worth telling a human" (e.g. an intermediate drawing
   stage most people don't need pinged for). */
function slackMessageFor(eventType, payload) {
  switch (eventType) {
    case "drawing_request_stage_change":
      if (payload.reviewStatus === "approved") {
        return { text: `✅ Drawing request *${payload.ticketNo}* (${payload.projectName}) is fully *approved*.`, recipientEmail: payload.requesterEmail, recipientSlackId: payload.requesterSlackId, who: payload.requesterName };
      }
      if (payload.reviewStatus === "returned") {
        return { text: `↩️ Drawing request *${payload.ticketNo}* (${payload.projectName}) was *returned* to ${payload.requesterName} for changes.`, recipientEmail: payload.requesterEmail, recipientSlackId: payload.requesterSlackId, who: payload.requesterName };
      }
      return null;
    case "work_assigned":
      return {
        text: `🔧 *${payload.assignedByName}* assigned *${payload.assignedToName}* a new task (stage \`${payload.stageId}\`)`
          + (payload.dueAt ? `, due ${new Date(payload.dueAt).toLocaleString()}` : "")
          + (payload.note ? `.\n> ${payload.note}` : "."),
        recipientEmail: payload.assignedToEmail,
        recipientSlackId: payload.assignedToSlackId,
        who: payload.assignedToName
      };
    case "snag_assigned": {
      const text = `🐞 Snag *${payload.title}* (${payload.projectName || "—"}) — raised by *${payload.raisedByName || "—"}* — assigned to *${payload.assignedToName}*.`;
      return {
        text, recipientEmail: payload.assignedToEmail, recipientSlackId: payload.assignedToSlackId, who: payload.assignedToName,
        blocks: snagCloseBlocks(text, payload.id)
      };
    }
    case "snag_reopened":
      return { text: `⚠️ Snag *${payload.title}* (${payload.projectName || "—"}) was *reopened* — assigned to *${payload.assignedToName}*, needs attention.`, recipientEmail: payload.assignedToEmail, recipientSlackId: payload.assignedToSlackId, who: payload.assignedToName };
    default:
      return null;
  }
}

async function notifySlack(eventType, payload) {
  if (!SLACK_BOT_TOKEN) return;
  try {
    const msg = slackMessageFor(eventType, payload);
    if (!msg) return;
    const tasks = [];
    if (msg.recipientEmail || msg.recipientSlackId) {
      tasks.push(
        slackUserIdForEmail(msg.recipientEmail, msg.recipientSlackId).then((uid) => uid && slackPostMessage(uid, msg.text, msg.blocks, { to: msg.who }))
      );
    }
    if (SLACK_CHANNEL_ID) {
      tasks.push(slackPostMessage(SLACK_CHANNEL_ID, msg.text, msg.blocks, { to: "the team channel" }));
    }
    await Promise.all(tasks);
  } catch (e) {
    console.error(`notifySlack failed (${eventType}):`, e.message);
  }
}

// The only two collections the public, no-login submission forms write to —
// and only ever to CREATE a new ticket, never to edit one that already
// exists. Everything else through /api/ops (including a second write to an
// existing dpr/drawingRequests row) needs a real signed-in session.
const PUBLIC_CREATE_ONLY = ["dpr", "drawingRequests"];

// Collections that belong to one project — cascade-deleted when that
// project itself is deleted, so removing a project doesn't leave its
// floors/units/snags/etc. as orphaned records with a projectId that no
// longer resolves to anything.
const PROJECT_SCOPED_COLLECTIONS = ["floors", "units", "snags", "assignments", "dpr", "drawingRequests", "stagemap", "workTargets"];

// Every Masters collection except "users" (already admin-gated above) —
// frontend/src/pages/Masters.tsx only shows its "+ New"/edit/delete
// controls when `myRole() === "ADMIN"`, but that was UI-only: any other
// signed-in session could still upsert/delete these directly via
// /api/ops. Mirrored here server-side (see assertOpAllowed).
const MASTER_ROLE_GATED_COLLECTIONS = ["projects", "floors", "units", "stages", "qparams", "checklists", "stagemap", "permissions", "workTargets", "teams", "roles", "forms"];

const roleCache = new Map(); // userId -> role, cleared per request is overkill; a stale role for a few seconds is an acceptable tradeoff for not hitting Mongo on every single op in a batch
async function getUserRole(userId) {
  if (!userId) return null;
  if (roleCache.has(userId)) return roleCache.get(userId);
  const user = await mongoDb.collection("users").findOne({ id: userId }, { projection: { role: 1 } });
  const role = user ? user.role : null;
  roleCache.set(userId, role);
  setTimeout(() => roleCache.delete(userId), 10000); // short TTL — a role change (rare) is visible within 10s, not stuck forever
  return role;
}

// A custom role (Masters ▸ Roles) can opt in to Civil Engineer's site stage
// access with its "actsLikeCivil" flag — mirrors isCivilLikeRole() in
// frontend/src/shared/rules.ts. Same short cache as getUserRole().
const civilLikeRoleCache = new Map(); // role name -> boolean
async function roleActsLikeCivil(role) {
  if (!role) return false;
  if (role === "CIVIL" || role === "SUPERVISOR") return true;
  if (civilLikeRoleCache.has(role)) return civilLikeRoleCache.get(role);
  const rec = await mongoDb.collection("roles").findOne({ name: role }, { projection: { actsLikeCivil: 1 } });
  const v = !!(rec && rec.actsLikeCivil);
  civilLikeRoleCache.set(role, v);
  setTimeout(() => civilLikeRoleCache.delete(role), 10000);
  return v;
}

// Mirrors frontend/src/shared/permissionMatrix.ts's MATRIX_MODULES — an
// admin-managed, per-user, per-module grant that only ever ADDS access on
// top of what a user's Role already allows (never narrows). Only the
// "masters" module is enforced server-side for now (the one Masters-CRUD
// gate below); other modules are UI-visibility toggles only, same as
// every other read-only tab gate in this app.
const moduleGrantCache = new Map(); // userId -> grants object
async function getModuleGrant(userId, moduleKey) {
  if (!userId) return null;
  let grants = moduleGrantCache.get(userId);
  if (grants === undefined) {
    const rec = await mongoDb.collection("moduleGrants").findOne({ userId });
    grants = rec ? rec.grants || {} : null;
    moduleGrantCache.set(userId, grants);
    setTimeout(() => moduleGrantCache.delete(userId), 10000);
  }
  return grants ? grants[moduleKey] || null : null;
}

/* Same constant-time comparison already used for password hashes
   (verifyPassword, below) — the cron/automation secret checks used to do a
   plain `!==`, which leaks timing information proportional to how many
   leading characters match. Low practical risk for a random 32+ byte
   secret, but there's no reason for the two secret-checking code paths in
   this file to have different security postures. */
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) {
    // Still do a comparison (against bufA itself) so a length mismatch
    // doesn't return measurably faster than a same-length mismatch.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/* Fire-and-forget notification on every real event worth telling someone
   about — never blocks or fails the request that triggered it (a Slack
   outage or a misconfigured webhook must never stop someone from approving
   a drawing, or assigning work, on the board itself).

   Two independent, both-optional sinks for the same {eventType, ...}
   payload: notifySlack talks to Slack directly (SLACK_BOT_TOKEN); the n8n
   webhook below is only for anyone who'd rather route it through n8n
   instead. Either, both, or neither can be configured. */
function notifyEvent(eventType, payload) {
  notifySlack(eventType, payload);
  if (!N8N_WEBHOOK_URL) return;
  fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ eventType }, payload))
  }).catch((e) => console.error(`n8n webhook notify failed (${eventType}):`, e.message));
}

async function notifyDrawingRequestStageChange(doc) {
  // Callers fire this without awaiting it (see below) — never let a lookup
  // failure here surface as an unhandled rejection and crash the process.
  try {
    // submittedByUserId, not requesterName (a free-typed string), is the
    // reliable link back to a real account — resolve it here so n8n can
    // match the requester to Slack by email without guessing off the name.
    const requester = doc.submittedByUserId
      ? await mongoDb.collection("users").findOne({ id: doc.submittedByUserId }, { projection: { email: 1, slackId: 1 } })
      : null;
    notifyEvent("drawing_request_stage_change", {
      id: doc.id,
      ticketNo: doc.ticketNo,
      projectName: doc.projectName,
      description: doc.description,
      reviewStatus: doc.reviewStatus,
      priority: doc.priority || doc.requestedPriority || null,
      requesterName: doc.requesterName,
      requesterEmail: requester?.email || null,
      requesterSlackId: requester?.slackId || null,
      assignedTo: doc.assignedTo || null,
      lastHistoryEntry: doc.reviewHistory?.[doc.reviewHistory.length - 1] || null
    });
  } catch (e) {
    console.error("notifyDrawingRequestStageChange failed:", e.message);
  }
}

async function notifyAssignmentTarget(eventType, rec) {
  try {
    const [assignee, assigner] = await Promise.all([
      mongoDb.collection("users").findOne({ id: rec.assignedTo }, { projection: { name: 1, email: 1, slackId: 1 } }),
      rec.assignedBy ? mongoDb.collection("users").findOne({ id: rec.assignedBy }, { projection: { name: 1 } }) : null
    ]);
    notifyEvent(eventType, {
      id: rec.id,
      projectId: rec.projectId || null,
      targetType: rec.targetType || null,
      targetId: rec.targetId || null,
      stageId: rec.stageId || null,
      note: rec.note || "",
      dueAt: rec.dueAt || null,
      assignedToId: rec.assignedTo,
      assignedToName: assignee?.name || rec.assignedTo,
      assignedToEmail: assignee?.email || null,
      assignedToSlackId: assignee?.slackId || null,
      assignedByName: assigner?.name || "Someone"
    });
  } catch (e) {
    console.error(`notifyAssignmentTarget failed (${eventType}):`, e.message);
  }
}

async function notifySnagTarget(eventType, rec, existing) {
  try {
    const assignedTo = rec.assignedTo || existing?.assignedTo || null;
    const raisedBy = rec.raisedBy || existing?.raisedBy || null;
    const projectId = rec.projectId || existing?.projectId || null;
    const [assignee, raiser, project] = await Promise.all([
      assignedTo ? mongoDb.collection("users").findOne({ id: assignedTo }, { projection: { name: 1, email: 1, slackId: 1 } }) : null,
      raisedBy ? mongoDb.collection("users").findOne({ id: raisedBy }, { projection: { name: 1 } }) : null,
      projectId ? mongoDb.collection("projects").findOne({ id: projectId }, { projection: { name: 1 } }) : null
    ]);
    notifyEvent(eventType, {
      id: rec.id,
      title: rec.title || existing?.title || "",
      projectId,
      projectName: project?.name || null,
      raisedByName: raiser?.name || null,
      assignedToId: assignedTo,
      assignedToName: assignee?.name || assignedTo,
      assignedToEmail: assignee?.email || null,
      assignedToSlackId: assignee?.slackId || null
    });
  } catch (e) {
    console.error(`notifySnagTarget failed (${eventType}):`, e.message);
  }
}

// Every Work Quality Inspection submission — not just a Fail — goes to
// Poorva directly (not role-based like the other Slack notifications,
// since this one's addressed to a specific person rather than "whoever's
// affected"), with its photos shown inline. She isn't a User record in
// this app (just an email on file), so this resolves her Slack id the
// same way as any other recipient but with a fixed, hardcoded address
// instead of looking one up from a record.
const QC_REPORT_NOTIFY_EMAIL = "poorva@neotericgrp.in";
async function notifyQualityInspectionSubmitted(rec) {
  if (!SLACK_BOT_TOKEN) return;
  try {
    const text = `📋 *New Quality Inspection submitted* — ${rec.projectCode || "—"} · ${rec.floorName || "—"}${rec.unitName ? " / " + rec.unitName : ""}`
      + (rec.workType ? ` · ${rec.workType}` : "") + `\nResult: *${rec.result}* · Inspector: ${rec.inspectorName || "—"}`
      + (rec.remarks ? `\n> ${rec.remarks}` : "");
    const blocks = [{ type: "section", text: { type: "mrkdwn", text } }];
    for (const p of (rec.photos || []).slice(0, 8)) { // Slack hard-caps blocks per message; 8 photos is already a lot for one inspection
      if (p?.url) blocks.push({ type: "image", image_url: p.url, alt_text: "Inspection photo" });
    }
    const uid = await slackUserIdForEmail(QC_REPORT_NOTIFY_EMAIL);
    if (uid) await slackPostMessage(uid, text, blocks);
  } catch (e) {
    console.error("notifyQualityInspectionSubmitted failed:", e.message);
  }
}

function getSession(req) {
  const header = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return null;
  try {
    return jwt.verify(m[1], JWT_SECRET);
  } catch {
    return null; // expired, tampered, or malformed — all treated as unauthenticated
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}
function verifyPassword(password, salt, hash) {
  const candidate = hashPassword(password, salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* -------------------------------------------------------- login lockout
   /api/login had no rate-limiting at all — an attacker could script
   unlimited password guesses against any known email. In-memory (not
   Mongo-backed) is a deliberate tradeoff: a server restart resets everyone's
   lockout, which is fine for what this defends against (a live brute-force
   burst), and avoids adding load to the DB on every single login attempt,
   successful or not. Keyed by email, not IP, since the login form itself
   already tells an attacker which email to target — IP-based limiting would
   also punish everyone behind a shared office/NAT IP for one person's typo. */
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MS = 60 * 1000;
const loginAttempts = new Map(); // email -> { count, lockedUntil }

function loginLockoutRemaining(email) {
  const entry = loginAttempts.get(email);
  if (!entry || !entry.lockedUntil) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}
function recordFailedLogin(email) {
  const entry = loginAttempts.get(email) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_LOCKOUT_THRESHOLD) {
    entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    entry.count = 0;
  }
  loginAttempts.set(email, entry);
}
/* Persistent counterpart to the in-memory lockout counter above (which
   only ever decided when to 429 someone, and forgets everything on a
   restart) — Audit Logs could show a successful LOGIN but had no record
   at all of failed attempts, so "is someone trying to get into this
   account" was invisible. Never includes the password itself, only the
   e-mail that was tried, the account it resolved to (if any), and why it
   failed. Best-effort, same as every other audit insert here. */
function logFailedLogin(email, userId, reason) {
  mongoDb.collection("events").insertOne({
    ts: Date.now(), userId: userId || "", action: "LOGIN_FAILED", targetId: userId || "", stageId: "",
    detail: `Failed sign-in for ${email} — ${reason}`
  }).catch((e) => console.error("Failed to log LOGIN_FAILED event:", e.message));
}
function clearLoginAttempts(email) {
  loginAttempts.delete(email);
}

const ROOT = __dirname;
// frontend/ is now a React+TS app requiring a build step (npm run build);
// serve the compiled output so `node server.js` alone still works locally
// after a build, same as it did for the old build-free vanilla app.
const STATIC_ROOT = path.join(ROOT, "..", "frontend", "dist");
const MAX_BODY = 16 * 1024 * 1024; // 16MB — photo uploads
const MAX_EVENTS = 5000;

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
let PORT = portArg !== -1 ? parseInt(args[portArg + 1], 10) : parseInt(process.env.PORT, 10);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) PORT = 5173;

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Cloudinary's SDK auto-configures from CLOUDINARY_URL — no explicit .config() call.
// This is intentionally the only credential source (never split into separate vars).
if (!process.env.CLOUDINARY_URL) {
  console.warn("  ! CLOUDINARY_URL is not set — photo uploads will fail.");
}

// Every Project Quality asset lives under this root, segregated by type, so it
// never collides with — or needs to touch — existing VMS assets in the same account.
const CLOUDINARY_ROOT = "ProjectQuality";
const PHOTO_TYPES = ["snags", "qc", "progress", "drawings", "dpr", "caseStudies"];

/* ---------------------------------------------------------------- storage */

let mongoDb = null;
let mongoClient = null; // kept module-level (not just local to connectMongo) so
// resetDb/restoreBackup can open a session and run their multi-collection
// replace as one transaction instead of an all-or-nothing-in-theory-only loop.

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");
  const client = new MongoClient(uri);
  await client.connect();
  mongoClient = client;
  mongoDb = client.db(process.env.MONGODB_DB || undefined);

  for (const c of COLLECTIONS) {
    await mongoDb.collection(c).createIndex({ id: 1 }, { unique: true });
  }
  await mongoDb.collection("events").createIndex({ ts: -1 });
  // sparse: users created before email-based login existed (or without an
  // email) don't collide with each other on a shared "" value.
  await mongoDb.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true });
  await mongoDb.collection("backups").createIndex({ id: 1 }, { unique: true });
  await mongoDb.collection("backups").createIndex({ createdAt: -1 });
  // The only real filtered (non-find({})) queries in the app today: a
  // project delete cascades by scanning floors/units for that projectId
  // (line ~1237), and the VMS-link report scans workMeasurements for any
  // linked record. Full collections are tiny right now so these are fast
  // either way, but indexing them costs nothing and keeps that true as
  // floors/units/workMeasurements grow over time.
  await mongoDb.collection("floors").createIndex({ projectId: 1 });
  await mongoDb.collection("units").createIndex({ projectId: 1 });
  await mongoDb.collection("workMeasurements").createIndex({ linkedItemId: 1 });
  // Expires the /api/ops idempotency markers (see opsBatch.js). Only documents
  // that have an `expireAt` date are affected — the other `meta` docs (rev,
  // weekly-report markers) don't, so they are never removed.
  await mongoDb.collection("meta").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });

  if (EVENTS_ARCHIVE_DAYS > 0) await mongoDb.collection("eventsArchive").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
  if (OPS_ATOMIC) {
    // READ-ONLY probe (a transaction that only reads and commits nothing): says in the log, at every start, whether
    // OPS_ATOMIC can really work on this database. If not, batches silently keep the old non-atomic writes.
    try {
      const probe = client.startSession();
      try { await probe.withTransaction(async () => { await mongoDb.collection("meta").findOne({ _id: "rev" }, { session: probe }); }); }
      finally { await probe.endSession(); }
      console.log("  OPS_ATOMIC=1: database transactions are available — /api/ops batches are all-or-nothing");
    } catch (e) {
      console.warn("  ! OPS_ATOMIC=1 but transactions are NOT available (" + (e && e.message) + ") — batches keep the old non-atomic writes");
    }
  }

  const projectCount = await mongoDb.collection("projects").countDocuments();
  if (projectCount === 0) {
    console.log("  no data found — starting with an empty board (use /api/reset to seed demo data if needed)");
  }

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      if (saveDiag) saveDiag.summary({ final: true }); // never throws; skipped when nothing is new since the last summary
      try {
        await client.close();
      } catch {}
      process.exit(0);
    });
  }
}

/* Every "delete" op removes the record from its live collection, same as
   before — but now a copy lands in "trash" first, so a delete (one record,
   or an entire project's cascade) is always recoverable from the database
   even though there's no "Undo" button in the UI yet. Never blocks or
   fails the actual delete: an archiving hiccup must not be the reason a
   genuine delete can't go through. Not added to seed.js's COLLECTIONS or
   exposed via /api/state — this is a recovery log, not board data. */
async function archiveBeforeDelete(coll, filter, deletedByUserId, mongoSession, db = mongoDb) {
  try {
    const docs = await db.collection(coll).find(filter, { session: mongoSession }).toArray();
    if (docs.length === 0) return;
    const deletedAt = Date.now();
    await db.collection("trash").insertMany(
      docs.map((doc) => ({ originalColl: coll, deletedAt, deletedBy: deletedByUserId || null, doc })),
      { session: mongoSession }
    );
  } catch (e) {
    console.error(`[trash] failed to archive ${coll} before delete:`, e.message);
  }
}

async function bumpRev() {
  // One atomic round-trip instead of update-then-read: the old second read
  // could also return a value another concurrent write had already bumped.
  const doc = await mongoDb.collection("meta").findOneAndUpdate(
    { _id: "rev" }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" }
  );
  return doc.value;
}

async function getRev() {
  const doc = await mongoDb.collection("meta").findOne({ _id: "rev" });
  return doc ? doc.value : 0;
}

// getState() does a full unfiltered scan + JSON.stringify + gzip of every
// collection — as dpr/purchaseOrders/etc. keep growing, that's real CPU +
// Atlas round-trips, and every one of N concurrently-polling clients pays
// it independently even when nothing changed between their requests. Cache
// the last gzip buffer keyed by `rev`: every real write already calls
// bumpRev(), so a rev match guarantees identical data — no staleness risk
// from normal use. The short TTL is only a safety net for the rare
// out-of-band write that bypasses bumpRev entirely (e.g. an ad-hoc cleanup
// script run directly against Mongo) — such a change still surfaces within
// 3s, no worse than today's 5s client poll interval already allows.
// The cache AND the rebuild are now owned by stateBuilder.js: concurrent requests for the same revision
// share ONE rebuild (previously each client's request rebuilt the whole board on its own — measured at
// ~11 s / ~2 GB for 40 clients at 10x data), and the revision is always read first. Rules + tests there.
const STATE_CACHE_TTL_MS = 3000;
const stateBuilder = createStateBuilder({
  getRev,
  readState: (rev) => getState(rev),
  serialize: (state) => new Promise((resolve, reject) =>
    zlib.gzip(JSON.stringify(state), (err, buf) => (err ? reject(err) : resolve(buf)))
  ),
  ttlMs: STATE_CACHE_TTL_MS
});
const getStateGzip = () => stateBuilder.get();

// `knownRev`: the revision the caller read BEFORE asking for the data. The snapshot is stamped with it, so it
// can never claim to be newer than the data it carries (a write landing mid-read only makes the stamp old).
async function getState(knownRev) {
  const rev = knownRev !== undefined ? knownRev : await getRev(); // read BEFORE the data, never in parallel with it
  // Every collection fetch here is an independent round-trip to Atlas —
  // awaiting them one at a time in a loop made total load time the SUM of
  // every collection's latency instead of the max, which is most of why
  // sign-in felt slow (this one call blocks the whole app on first load).
  // Promise.all runs them concurrently instead.
  const [collResults, progressDocs, events] = await Promise.all([
    Promise.all(COLLECTIONS.map((c) => mongoDb.collection(c).find({}, { projection: { _id: 0 } }).toArray())),
    mongoDb.collection("progress").find({}).toArray(),
    mongoDb.collection("events").find({}, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(MAX_EVENTS).toArray()
  ]);

  const data = {};
  COLLECTIONS.forEach((c, i) => { data[c] = collResults[i]; });
  // Password hashes must never leave the server, even to an authenticated
  // browser — /api/state is otherwise a full generic dump of every collection.
  if (data.users) {
    data.users = data.users.map((u) => {
      const { passwordHash, passwordSalt, legacyPasswordHash, ...rest } = u;
      return rest;
    });
  }
  data.progress = {};
  for (const p of progressDocs) {
    const { _id, ...rest } = p;
    data.progress[_id] = rest;
  }
  data.events = events;
  return { rev, data };
}

/*
 * Ops are small, record-level and idempotent, so two engineers editing
 * different units never clobber each other (last-write-wins per record only).
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSetUnset(fields) {
  const set = {}, unset = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) unset[k] = "";
    else set[k] = v;
  }
  return { set, unset };
}

/* Deletes, and any write to the `users` collection (Masters ▸ User Master
   is Admin-only, everything else in Masters is open to every signed-in
   board member), need a real logged-in admin session.

   Anonymous access is intentionally narrow — ONLY creating a brand-new
   dpr/drawingRequests record (what the public no-login submission forms
   do) is allowed with no session. Every other write — progress ops, event
   log inserts, upserts to any other collection, and editing an EXISTING
   dpr/drawingRequests row — needs a real signed-in session (any role, not
   necessarily admin). Previously only `delete` and `users`-upsert were
   gated at all, which left the entire rest of the data model (QC stage
   progress, snags, assignments, projects, …) writable by anyone who could
   reach this endpoint, logged in or not.

   Bootstrap exception: if the users collection is genuinely empty (fresh
   board, or recovering from a reset), the very first user upsert is let
   through unauthenticated — otherwise nobody could ever create the first
   admin account to log in and authorize anything else. Throws a tagged
   error so the route handler can turn it into a clean 401/403. */
/* ---------------------------------------------------------- approvals on Slack
   A team member's inspection/measurement waits for their team leader. The
   leader gets it on Slack with Approve / Reject buttons and can decide
   without opening the app; the author hears back either way. Every message
   below also reaches the observers via slackPostMessage (a copy to Poorva). */
async function slackIdForUserId(userId) {
  const u = userId ? await mongoDb.collection("users").findOne({ id: userId }, { projection: { _id: 0, id: 1, name: 1, email: 1, slackId: 1 } }) : null;
  if (!u) return { user: null, uid: null };
  return { user: u, uid: await slackUserIdForEmail(u.email, u.slackId) };
}

/* A real Daily Progress Report filled on QC itself (not one of VMS's own
   synced-in records) posted to that PROJECT'S OWN Slack channel — each
   project has its own (e.g. #proj-zen-garden), set per-project via
   Masters ▸ Project ▸ "Slack channel ID". Silently does nothing if that
   project has none set, same as every other best-effort Slack notify here. */
async function notifyDprSubmitted(rec) {
  if (!SLACK_BOT_TOKEN) return;
  try {
    const project = await mongoDb.collection("projects").findOne({ id: rec.projectId }, { projection: { slackChannelId: 1 } });
    // Trimmed defensively — pasting this out of a table/doc easily drags
    // along a leading tab or space, which Slack's API rejects outright.
    const channelId = project && project.slackChannelId && String(project.slackChannelId).trim();
    if (!channelId) return;
    const categories = (rec.workEntries || []).map((w) => w.category).join(", ") || "—";
    const text = `📋 Daily Progress Report submitted on QC — *${rec.projectName || rec.projectId}*\n`
      + `By: *${rec.submittedByName || "—"}* · Contractor: ${rec.vendorName || "—"} · Shift: ${rec.shift || "—"} · Labour: ${rec.labourCount ?? "—"}\n`
      + `Work: ${categories}`;
    await slackPostMessage(channelId, text, null, { to: "the project channel" });
  } catch (e) {
    console.error("notifyDprSubmitted failed:", e.message);
  }
}

const approvalResendAt = new Map(); // userId -> last "send pending to Slack" time

async function notifyApprovalRequest(coll, rec) {
  if (!SLACK_BOT_TOKEN) return;
  try {
    const approverId = rec.approval && rec.approval.approverUserId;
    const { user, uid } = await slackIdForUserId(approverId);
    if (!user || !uid) return; // no Slack link for this leader — they still see it in the app
    const { text, blocks } = approvalSlack.approvalRequestBlocks(coll, rec);
    await slackPostMessage(uid, text, blocks, { to: user.name });
  } catch (e) {
    console.error("notifyApprovalRequest failed:", e.message);
  }
}

async function notifyApprovalDecision(coll, rec, status, remark, byUserId) {
  if (!SLACK_BOT_TOKEN) return;
  try {
    const authorId = rec.inspectorUserId || rec.recordedByUserId;
    const [{ user: author, uid }, { user: by }] = await Promise.all([slackIdForUserId(authorId), slackIdForUserId(byUserId)]);
    if (!author || !uid) return;
    await slackPostMessage(uid, approvalSlack.approvalDecisionText({ coll, rec, status, remark, byName: by && by.name }), undefined, { to: author.name });
  } catch (e) {
    console.error("notifyApprovalDecision failed:", e.message);
  }
}

// A decision made from Slack: same rules as the app (approvalRules.js), so a
// click can never do more than the person could do in the app themselves.
async function decideApprovalFromSlack({ coll, id, status, remark, actor }) {
  if (!approvalSlack.APPROVAL_COLLECTIONS.includes(coll)) return { ok: false, message: "⚠️ That item can't be approved here." };
  if (!actor) return { ok: false, message: "🚫 Couldn't match your Slack account to a user in the app (the emails must be the same)." };
  const rec = await mongoDb.collection(coll).findOne({ id }, { projection: { _id: 0 } });
  if (!rec) return { ok: false, message: "⚠️ That record no longer exists." };
  if (rec.approval && rec.approval.status && rec.approval.status !== "pending") {
    return { ok: false, message: `ℹ️ Already ${rec.approval.status}.` };
  }
  const [users, teams] = await Promise.all([
    mongoDb.collection("users").find({}, { projection: { _id: 0, id: 1, name: 1, teamId: 1 } }).toArray(),
    mongoDb.collection("teams").find({}, { projection: { _id: 0, id: 1, leaderId: 1 } }).toArray()
  ]);
  const r = resolveApprovalOnUpdate({
    existing: rec, incoming: { approval: { status, remark } },
    session: { userId: actor.id, isAdmin: actor.id === ADMIN_USER_ID },
    creatorId: rec.inspectorUserId || rec.recordedByUserId, users, teams
  });
  if (!r.ok) return { ok: false, message: `🚫 ${r.error}` };
  if (!r.approval) return { ok: false, message: "ℹ️ That record doesn't need approval." };
  await mongoDb.collection(coll).updateOne({ id }, { $set: { approval: r.approval } });
  await mongoDb.collection("events").insertOne({
    ts: Date.now(), userId: actor.id, action: status === "approved" ? "APPROVAL_APPROVE" : "APPROVAL_REJECT", targetId: id, stageId: "",
    detail: `${approvalSlack.KIND_LABEL[coll]} · ${approvalSlack.describeRecord(coll, rec)} (via Slack)`
  });
  await bumpRev();
  notifyApprovalDecision(coll, rec, status, r.approval.remark, actor.id);
  return { ok: true, message: approvalSlack.approvalResultLine({ coll, rec, status, remark: r.approval.remark, byName: actor.name }) };
}

// Team-leader approval of a team member's inspections/measurements (see
// approvalRules.js). Runs on every save of those records: whatever approval
// the browser sent is replaced by what the rules allow, so a member can't
// skip review or approve their own work.
const APPROVAL_COLLECTIONS = ["qualityInspections", "materialMeasurements", "workMeasurements"];
// Mirrors QualityInspection.tsx's own sentinel stage id for snags auto-raised
// from a Work Quality Inspection Fail/Rework.
const QC_INSPECTION_STAGE_ID = "STG-QC-INSPECTION";
async function applyApprovalRules(op, session) {
  if (!session || op.op !== "upsert" || !op.rec || !APPROVAL_COLLECTIONS.includes(op.coll)) return;
  const existing = op.rec.id ? await mongoDb.collection(op.coll).findOne({ id: op.rec.id }, { projection: { _id: 0 } }) : null;
  if (!existing) {
    const [users, teams] = await Promise.all([
      mongoDb.collection("users").find({}, { projection: { _id: 0, id: 1, name: 1, teamId: 1 } }).toArray(),
      mongoDb.collection("teams").find({}, { projection: { _id: 0, id: 1, leaderId: 1 } }).toArray()
    ]);
    const approval = deriveApprovalOnCreate({ creatorId: session.userId, users, teams });
    if (approval) { op.rec.approval = approval; op._notifyApprovalRequest = op.coll; } else delete op.rec.approval;
    return;
  }
  // the person who may decide is the author's CURRENT team leader (and an
  // older record with no approval yet is decided by that same leader), so a
  // decision needs the team data to confirm who that is
  let users, teams;
  if (op.rec.approval) {
    [users, teams] = await Promise.all([
      mongoDb.collection("users").find({}, { projection: { _id: 0, id: 1, name: 1, teamId: 1 } }).toArray(),
      mongoDb.collection("teams").find({}, { projection: { _id: 0, id: 1, leaderId: 1 } }).toArray()
    ]);
  }
  const r = resolveApprovalOnUpdate({ existing, incoming: op.rec, session, creatorId: existing.inspectorUserId || existing.recordedByUserId, users, teams });
  if (!r.ok) { const e = new Error(r.error); e.status = r.status; throw e; }
  if (r.approval) op.rec.approval = r.approval; else delete op.rec.approval;
  const wasPending = !existing.approval || existing.approval.status === "pending";
  // a pending -> approved/rejected change: tell the author once it has been saved
  if (r.approval && r.approval.status !== "pending" && wasPending) {
    op._notifyApprovalDecision = { coll: op.coll, status: r.approval.status, remark: r.approval.remark, byUserId: session.userId };
  }
  // A Fail/Rework inspection from someone whose team leader must sign off
  // never got a snag raised against a DRI at submit time (see
  // QualityInspection.tsx's raiseSnagNow) — it's raised here instead, the
  // moment that leader actually approves it, never on a bare Fail alone.
  if (op.coll === "qualityInspections" && r.approval && r.approval.status === "approved" && wasPending
    && existing.result !== "Pass" && !existing.linkedSnagId) {
    op._raiseSnagOnApprove = true;
  }
}

async function assertOpAllowed(op, session) {
  if (op.op === "upsert" && op.coll === "qualityInspections" && op.rec) enforceResultFromChecklist(op.rec);
  await applyApprovalRules(op, session);
  const needsAdmin = op.op === "delete" || (op.op === "upsert" && (op.coll === "users" || op.coll === "moduleGrants"));
  if (needsAdmin) {
    if (op.op === "upsert" && op.coll === "users") {
      const userCount = await mongoDb.collection("users").countDocuments();
      if (userCount === 0) return;
    }
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    if (!session.isAdmin) { const e = new Error("Admin access required"); e.status = 403; throw e; }
    return;
  }

  // Daily Team Reports are generated server-side only (/api/team-reports/
  // generate) — the generic ops endpoint may only ever PATCH the sign-off
  // fields of an EXISTING one, and only the team's own leader (or an
  // Admin) may do it. Everything else on the record (members/totals/date)
  // is forced back to whatever's already stored, so a member can't
  // fabricate their own team's numbers or sign off on their own behalf.
  if (op.op === "upsert" && op.coll === "teamDailyReports" && op.rec && op.rec.id) {
    const existing = await mongoDb.collection("teamDailyReports").findOne({ id: op.rec.id }, { projection: { _id: 0 } });
    if (!existing) { const e = new Error("Daily Team Reports can't be created directly"); e.status = 400; throw e; }
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    const team = await mongoDb.collection("teams").findOne({ id: existing.teamId });
    const isLeader = team && team.leaderId === session.userId;
    if (!session.isAdmin && !isLeader) { const e = new Error("Only this team's leader can approve its report"); e.status = 403; throw e; }
    const approver = await mongoDb.collection("users").findOne({ id: session.userId }, { projection: { name: 1 } });
    Object.assign(op.rec, existing, {
      status: "Approved",
      approvedByUserId: session.userId,
      approvedByName: approver ? approver.name : null,
      approvedAt: Date.now()
    });
  }

  if (op.op === "upsert" && op.coll === "drawingRequests" && op.rec && op.rec.id) {
    const existing = await mongoDb.collection("drawingRequests").findOne({ id: op.rec.id });
    // Editing a ticket that already exists is never anonymous, regardless
    // of which fields are being changed — closes the gap where a client
    // could set priority/planningVerified/projectAcknowledged/assignedTo
    // etc. on an existing ticket without ever touching reviewStatus (the
    // only field the old check looked at).
    if (existing && !session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    // An anonymous CREATE (the public no-login submission form) only ever
    // legitimately sends description/drawingType/source/requesterName/
    // requestedPriority/projectId — everything privilege-bearing here is
    // force-reset to the same safe defaults the normal in-app create path
    // uses, no matter what the request body actually contained. Closes the
    // gap where an anonymous POST could plant a ticket that's pre-assigned,
    // pre-prioritized, or carries a fabricated approval-history entry.
    // Authenticated creates/edits are untouched — this only fires when
    // there's no session and no existing record. Runs BEFORE the
    // transition check below so a spoofed `reviewStatus` in the request
    // body gets silently normalized away instead of surfacing as a
    // confusing "Invalid transition" 400 to a legitimate anonymous
    // submitter who happened to send some other status.
    if (!existing && !session) {
      Object.assign(op.rec, {
        reviewStatus: "stage-1-screen",
        reviewHistory: [{ stage: "stage-1-screen", action: "submitted", by: null, at: Date.now(), remarks: "Ticket created" }],
        files: [],
        assignedTo: null,
        committedDate: null,
        priority: "",
        trackingStatus: "",
        actualCompletionDate: null,
        planningVerified: false,
        projectAcknowledged: false,
        submittedByUserId: null,
        isPublic: true
      });
    }
    if (op.rec.reviewStatus) {
      const from = existing ? existing.reviewStatus : "stage-1-screen";
      if (op.rec.reviewStatus !== from) {
        const allowed = DRAWING_TRANSITIONS[from] || [];
        if (!allowed.includes(op.rec.reviewStatus)) {
          const e = new Error(`Invalid drawing request transition: ${from} -> ${op.rec.reviewStatus}`);
          e.status = 400;
          throw e;
        }
        // Mirrors frontend/src/shared/permissions.ts's canActOnStage() —
        // that check used to only decide what the review-actions UI showed,
        // so any other signed-in session could still push a ticket through
        // a stage via /api/ops directly. Admin always bypasses (same as the
        // frontend). "returned" -> "stage-1-screen" (resubmit) is a special
        // case per useDrawingRequestActions.ts's own doc comment — only the
        // original requester revives a returned ticket, not whoever holds
        // the stage-1 screening grant.
        if (!session.isAdmin) {
          if (from === "returned") {
            if (!existing || existing.submittedByUserId !== session.userId) {
              const e = new Error("Only the original requester can resubmit a returned ticket");
              e.status = 403;
              throw e;
            }
          } else {
            const permKey = STAGE_TO_PERMISSION_KEY[from];
            const perm = permKey ? await mongoDb.collection("permissions").findOne({ userId: session.userId }) : null;
            if (!permKey || !perm || !perm[permKey]) {
              const e = new Error("Not authorized to act on this review stage");
              e.status = 403;
              throw e;
            }
          }
        }
      }
    }
    return;
  }

  if (op.op === "upsert" && op.coll === "dpr" && op.rec && op.rec.id) {
    const existing = await mongoDb.collection("dpr").findOne({ id: op.rec.id });
    if (existing && !session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    // Same reasoning as drawingRequests above — an anonymous submission can
    // never claim to be from a real logged-in account.
    if (!existing && !session) {
      op.rec.submittedByUserId = null;
      op.rec.isPublic = true;
    }
    // A genuinely new report filled on QC itself (never one VMS just synced
    // in — those already have their own "DPR-VMS-<id>" shape and VMS's own
    // notification path) — flagged here, acted on after the write actually
    // lands (see op._notifyDprSubmit below), to the project's own Slack
    // channel if one's set (Masters ▸ Project ▸ "Slack channel ID").
    if (!existing && !String(op.rec.id).includes("VMS")) op._notifyDprSubmit = true;
    return;
  }

  if (op.op === "upsert" && op.coll === "formSubmissions" && op.rec) {
    const existing = op.rec.id ? await mongoDb.collection("formSubmissions").findOne({ id: op.rec.id }) : null;
    if (existing) { const e = new Error("Submissions can't be edited"); e.status = 403; throw e; }
    const form = await mongoDb.collection("forms").findOne({ id: op.rec.formId });
    if (!form || form.active === false) { const e = new Error("Form not found"); e.status = 404; throw e; }
    if (!session) {
      // Anonymous POST only ever legitimately comes from a form's own
      // public link — never allow it to silently write into an
      // internal-only form, no matter what formId the client sent.
      if (!form.isPublic) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
      op.rec.submittedByUserId = null;
      op.rec.isPublic = true;
    } else {
      op.rec.submittedByUserId = session.userId;
      op.rec.isPublic = false;
    }
    op.rec.submittedAt = Date.now();
    return;
  }

  if (op.op === "upsert" && MASTER_ROLE_GATED_COLLECTIONS.includes(op.coll)) {
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    if (!session.isAdmin) {
      const role = await getUserRole(session.userId);
      if (role !== "ADMIN" && role !== "DRI") {
        // Additive grant on top of the role check above — a user without
        // the Owner/Admin (or DRI) role can still be individually
        // authorized via the Permission Matrix (moduleGrants.masters.edit)
        // without changing their Role and therefore without changing
        // anything else they can or can't do elsewhere in the app.
        const grant = await getModuleGrant(session.userId, "masters");
        if (!grant || !grant.edit) { const e = new Error("Only Owner/Admin or DRI can edit Masters"); e.status = 403; throw e; }
      }
    }
    return;
  }

  if (op.op === "upsert" && op.coll === "workMeasurements" && op.rec) {
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    const wmBase = await recordForValidation(op);
    const err = workMeasurements.validateWorkMeasurement(wmBase);
    if (err) { const e = new Error(err); e.status = 400; throw e; }
    // The link is never taken from the client as-is: it is re-derived from
    // live VMS data here (a client-proposed item is only honoured if it is
    // one of the verified candidates). Reference-only — nothing is written
    // to VMS or to any other QC record.
    Object.assign(op.rec, await workMeasurements.resolveLink(wmBase));
    return;
  }

  if (op.op === "upsert" && op.coll === "materialMeasurements" && op.rec) {
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    const err = validateMeasurement(await recordForValidation(op));
    if (err) { const e = new Error(err); e.status = 400; throw e; }
    return;
  }

  if (op.op === "upsert" && !PUBLIC_CREATE_ONLY.includes(op.coll)) {
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    return;
  }

  if (op.op === "progress" || op.op === "event") {
    if (!session) { const e = new Error("Sign-in required"); e.status = 401; throw e; }
    // Mirrors frontend/src/shared/rules.ts's canAct() (ADMIN bypasses
    // everything, or the acting user's role must match the stage's own
    // owning role) — that check was frontend-only until now, so any other
    // signed-in session could patch any stage's progress via /api/ops.
    if (op.op === "progress" && !session.isAdmin && op.key) {
      const stageId = String(op.key).split("::")[1];
      const [role, stage] = await Promise.all([
        getUserRole(session.userId),
        stageId ? mongoDb.collection("stages").findOne({ id: stageId }, { projection: { role: 1 } }) : null
      ]);
      const stageRole = stage ? stage.role : null;
      // Owner Possession (STG-HOO) is ADMIN/CRM only — no DRI bypass,
      // unlike every other stage — mirrors Drawer.tsx/HandoverChecklist.tsx.
      const isOwnerPossession = stageId === "STG-HOO";
      // SUPERVISOR has the same stage access as CIVIL — every stage's
      // owning role is "CIVIL", never "SUPERVISOR" itself, so it needs an
      // explicit match here too, mirroring rules.ts's canAct().
      const allowed = isOwnerPossession
        ? role === "ADMIN" || role === "CRM"
        : role === "ADMIN" || role === "DRI" || (!!stageRole && role === stageRole) || (stageRole === "CIVIL" && await roleActsLikeCivil(role));
      if (!allowed) {
        const e = new Error("Not authorized to act on this stage");
        e.status = 403;
        throw e;
      }
    }
  }
}

/* A db-like object whose every call joins one transaction (only the methods applyOps uses). */
function sessionDb(txSession) {
  const o = (opts) => Object.assign({}, opts, { session: txSession });
  return {
    collection(name) {
      const c = mongoDb.collection(name);
      return {
        findOne: (f, opts) => c.findOne(f, o(opts)),
        find: (f, opts) => c.find(f, o(opts)),
        updateOne: (f, u, opts) => c.updateOne(f, u, o(opts)),
        insertOne: (d, opts) => c.insertOne(d, o(opts)),
        insertMany: (d, opts) => c.insertMany(d, o(opts)),
        deleteOne: (f, opts) => c.deleteOne(f, o(opts)),
        deleteMany: (f, opts) => c.deleteMany(f, o(opts)),
        countDocuments: (f, opts) => c.countDocuments(f, o(opts))
      };
    }
  };
}

/* progress update for an item-based checklist: a single atomic pipeline update that merges the incoming cells into the
   stored array by itemId (a cell present on both sides gets the incoming fields on top, cells only on one side are kept).
   Anything else (flag off, no/empty checklist, cells without an itemId) returns the classic $set/$unset update. */
function progressUpdate(patch, classic, items) {
  if (!PROGRESS_CELL_MERGE) return classic;
  const cells = patch && patch.checklist;
  if (!Array.isArray(cells) || cells.length === 0 || !cells.every((c) => c && typeof c === "object" && typeof c.itemId === "string" && c.itemId)) return classic;
  const lit = (v) => ({ $literal: v }); // values are data, never field paths ("$100" in a note must stay text)
  const setStage = {}; const unsetFields = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "checklist") continue;
    if (v === null) unsetFields.push(k); else setStage[k] = lit(v);
  }
  setStage.checklist = {
    $let: {
      vars: { cur: { $cond: [{ $isArray: "$checklist" }, "$checklist", []] }, inc: lit(cells) },
      in: {
        $concatArrays: [
          { $map: { input: "$$cur", as: "c", in: { $let: { vars: { m: { $first: { $filter: { input: "$$inc", as: "i", cond: { $eq: ["$$i.itemId", "$$c.itemId"] } } } } }, in: { $cond: [{ $eq: [{ $type: "$$m" }, "missing"] }, "$$c", { $mergeObjects: ["$$c", "$$m"] }] } } } } },
          { $filter: { input: "$$inc", as: "i", cond: { $not: [{ $in: ["$$i.itemId", { $map: { input: "$$cur", as: "c", in: "$$c.itemId" } }] }] } } }
        ]
      }
    }
  };
  const stages = [{ $set: setStage }];
  // The stage's own status is "done" only when EVERY listed item's cell is done, judged on the MERGED cells — so two
  // people finishing the last two items at the same moment still end with "done" (each browser only sees its own cell).
  // The browser lists the stage's item ids; it only has an effect when this write also sets the status.
  const ids = Array.isArray(items) ? items.filter((x) => typeof x === "string" && x && x.length <= 200).slice(0, 500) : [];
  if (ids.length && Object.prototype.hasOwnProperty.call(setStage, "status")) {
    stages.push({ $set: { status: { $cond: [{ $allElementsTrue: [{ $map: { input: lit(ids), as: "id", in: { $eq: [{ $let: { vars: { cell: { $first: { $filter: { input: "$checklist", as: "c", cond: { $eq: ["$$c.itemId", "$$id"] } } } } }, in: "$$cell.status" } }, "done"] } } }] }, "done", "wip"] } } });
  }
  if (unsetFields.length) stages.push({ $unset: unsetFields });
  return stages;
}

// The record a validation rule should see: the stored record with the incoming fields on top, so a PARTIAL update
// (just an approval decision, just a confirmed link) is validated against the whole record, not against its few fields.
async function recordForValidation(op) {
  if (!op.rec || !op.rec.id || op.create === true) return op.rec;
  const existing = await mongoDb.collection(op.coll).findOne({ id: op.rec.id }, { projection: { _id: 0 } });
  return existing ? Object.assign({}, existing, op.rec) : op.rec;
}

/* ---- creates, uniqueness, appends (docs/data-integrity-fixes.md)
   An upsert is a field-level merge, so a "create" that happens to reuse an existing id used to silently overwrite
   that record (ids come from the browser: max+1 over its possibly stale copy of the board). A client that means
   "create" now sets `create: true` on the op: the server then INSERTS, and an existing id is a 409 conflict
   (nothing is written, the user is told). Ops without the flag behave exactly as before (older browsers).
   `push` appends ONE object to an array field instead of replacing the whole array (two people adding a photo
   or comment at the same time no longer lose one of them). */
const PUSHABLE_FIELDS = { snags: ["photos", "comments"] };
function conflict(message) { const e = new Error(message); e.status = 409; return e; }
function validatePush(op) {
  if (op.push === undefined) return;
  const allowed = PUSHABLE_FIELDS[op.coll] || [];
  const keys = op.push && typeof op.push === "object" && !Array.isArray(op.push) ? Object.keys(op.push) : null;
  if (!keys || keys.length === 0 || keys.some((k) => !allowed.includes(k) || !op.push[k] || typeof op.push[k] !== "object" || Array.isArray(op.push[k]))) {
    const e = new Error("push is only allowed for " + (allowed.length ? allowed.join("/") : "no field") + " on " + op.coll + ", one object at a time");
    e.status = 400; throw e;
  }
  if (op.rec && keys.some((k) => Object.prototype.hasOwnProperty.call(op.rec, k))) { const e = new Error("a field cannot be both set and pushed in one op"); e.status = 400; throw e; }
}
async function assertCreatesAndUniques(ops) {
  const seenCreates = new Set();
  for (const op of ops || []) {
    if (!op || typeof op !== "object" || op.op !== "upsert" || !COLLECTIONS.includes(op.coll) || !op.rec || !op.rec.id) continue;
    validatePush(op);
    if (op.create === true) {
      const key = op.coll + "::" + op.rec.id;
      if (seenCreates.has(key)) throw conflict(op.rec.id + " appears twice in one save — your change was not saved.");
      seenCreates.add(key);
      const exists = await mongoDb.collection(op.coll).findOne({ id: op.rec.id }, { projection: { _id: 1 } });
      if (exists) throw conflict(op.rec.id + " already exists (someone else created it a moment ago) — your change was NOT saved. Reload and try again.");
    }
    if (op.coll === "users" && typeof op.rec.email === "string" && op.rec.email) {
      const clash = await mongoDb.collection("users").findOne({ email: op.rec.email, id: { $ne: op.rec.id } }, { projection: { _id: 1 } });
      if (clash) throw conflict("That e-mail address is already used by another user — your change was not saved.");
    }
  }
}
// The single write of an upsert op: insert-only for a create, the usual upsert otherwise.
async function writeRecord(db, op, update) {
  if (op.create === true) {
    const doc = Object.assign({}, update.$set || { id: op.rec.id });
    for (const [field, spec] of Object.entries(update.$push || {})) doc[field] = spec.$each.slice();
    try {
      await db.collection(op.coll).insertOne(doc);
    } catch (e) {
      if (e && e.code === 11000 && e.keyPattern && e.keyPattern.id) throw conflict(op.rec.id + " already exists (someone else created it a moment ago) — your change was NOT saved. Reload and try again.");
      throw e;
    }
    return { matchedCount: 0, upsertedCount: 1 };
  }
  return db.collection(op.coll).updateOne({ id: op.rec.id }, update, { upsert: true });
}
// A deleted VMS-origin record must not be re-imported by the VMS poller / live push (see syncVmsDpr.js).
const VMS_ID_PREFIX = { dpr: "DPR-VMS-", drawingRequests: "DR-VMS-" };
async function recordVmsTombstone(db, coll, id) {
  const prefix = VMS_ID_PREFIX[coll];
  if (!prefix || typeof id !== "string" || !id.startsWith(prefix)) return;
  await db.collection("meta").updateOne({ _id: "tomb:" + id }, { $set: { coll, at: Date.now() } }, { upsert: true });
}

// `trace` is optional and used ONLY by the log-only save diagnostics (saveDiagnostics.js): when present, the two
// side effects below record counts into it. It is undefined in normal operation and never influences a write.
async function applyOps(ops, session, trace) {
  // Validate the ENTIRE batch before writing anything — otherwise an
  // allowed op earlier in the array would already be persisted to Mongo by
  // the time a later, disallowed op in the same batch throws and aborts.
  for (const op of ops || []) {
    if (!op || typeof op !== "object") continue;
    await assertOpAllowed(op, session);
  }
  // Conflicts (existing id on a create, e-mail already used, bad push) are raised HERE, before any write of the batch.
  await assertCreatesAndUniques(ops);

  // Everything below is the WRITE phase of the batch. With OPS_ATOMIC=1 it runs in one transaction and the Slack
  // follow-ups wait for the commit; otherwise it behaves exactly as before (each op written as it is reached).
  const deferred = [];
  let txSession = null;
  const after = OPS_ATOMIC ? (fn) => { deferred.push(fn); } : (fn) => { fn(); };
  const runMaybeNested = (fn) => (OPS_ATOMIC ? fn(txSession) : withOptionalTransaction(fn));
  const writeAll = async (db) => {
    deferred.length = 0; // the transaction callback can be retried
    for (const op of ops || []) {
      if (!op || typeof op !== "object") continue;

      if (op.op === "upsert" && COLLECTIONS.includes(op.coll) && op.rec && op.rec.id) {
        const rec = Object.assign({}, op.rec);
        // A plaintext "password" field on a users upsert (e.g. set via Masters
        // ▸ User Master) is hashed here and never stored/echoed back raw.
        if (op.coll === "users" && typeof rec.password === "string" && rec.password) {
          const salt = crypto.randomBytes(16).toString("hex");
          rec.passwordHash = hashPassword(rec.password, salt);
          rec.passwordSalt = salt;
        }
        delete rec.password;
        const { set, unset } = splitSetUnset(rec);
        const update = {};
        if (Object.keys(set).length) update.$set = set;
        if (Object.keys(unset).length) update.$unset = unset;
        if (op.push) {
          update.$push = {};
          for (const [field, value] of Object.entries(op.push)) update.$push[field] = { $each: [value] };
        }

        if (op.coll === "drawingRequests" && rec.reviewStatus) {
          // Compare-and-swap on the stage the client thought it was
          // transitioning FROM, instead of a plain updateOne — two concurrent
          // approvals reading the same "current stage" used to both pass
          // assertOpAllowed's check and then both write, silently losing one
          // transition to last-write-wins. filter.reviewStatus below makes
          // the second writer's update simply match nothing instead.
          const existing = await db.collection("drawingRequests").findOne({ id: op.rec.id }, { projection: { reviewStatus: 1 } });
          const from = existing ? existing.reviewStatus : undefined;
          const filter = existing ? { id: op.rec.id, reviewStatus: from } : { id: op.rec.id };
          const result = op.create === true ? await writeRecord(db, op, update) : await db.collection(op.coll).updateOne(filter, update, { upsert: !existing });
          if (existing && result.matchedCount === 0) {
            const e = new Error(`${op.rec.id} was already moved to a different stage by someone else — reload and retry`);
            e.status = 409;
            throw e;
          }
          if (rec.reviewStatus !== from) {
            const saved = await db.collection("drawingRequests").findOne({ id: op.rec.id }, { projection: { _id: 0 } });
            if (saved) after(() => notifyDrawingRequestStageChange(saved));
          }
        } else if (op.coll === "assignments" && rec.assignedTo) {
          const existing = await db.collection("assignments").findOne({ id: op.rec.id }, { projection: { assignedTo: 1 } });
          await writeRecord(db, op, update);
          // Notify on a brand-new assignment or a hand-off to someone else —
          // not on every incidental field edit (e.g. a note tweak) to the
          // same assignee.
          if (!existing || existing.assignedTo !== rec.assignedTo) {
            after(() => notifyAssignmentTarget("work_assigned", rec));
          }
        } else if (op.coll === "snags") {
          const existing = await db.collection("snags").findOne(
            { id: op.rec.id },
            { projection: { assignedTo: 1, status: 1, reopenCount: 1, title: 1, projectId: 1 } }
          );
          await writeRecord(db, op, update);
          const reopened = !!existing && existing.status === "Closed" && rec.status && rec.status !== "Closed"
            && (rec.reopenCount || 0) > (existing.reopenCount || 0);
          const reassigned = !!rec.assignedTo && (!existing || existing.assignedTo !== rec.assignedTo);
          // A single write can technically be both (reopened straight onto a
          // new assignee) — the reopen is the more important thing to flag,
          // so it wins rather than firing two events for one save.
          if (reopened) {
            after(() => notifySnagTarget("snag_reopened", rec, existing));
          } else if (reassigned) {
            after(() => notifySnagTarget("snag_assigned", rec, existing));
          }
        } else if (op.coll === "qualityInspections") {
          await writeRecord(db, op, update);
          // Every submission (not just a Fail) — there's no edit path for an
          // already-saved inspection (only a fresh re-inspect record), so
          // this upsert is always a brand-new one.
          after(() => notifyQualityInspectionSubmitted(rec));
          if (op._raiseSnagOnApprove) {
            const full = await db.collection("qualityInspections").findOne({ id: rec.id }, { projection: { _id: 0 } });
            if (full && !full.linkedSnagId) {
              const snagId = "SNG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
              const location = full.unitName ? `${full.floorName} / ${full.unitName}` : full.floorName;
              const label = full.itemDescription ? `${location} · ${full.itemDescription}` : location;
              await db.collection("snags").insertOne({
                id: snagId,
                projectId: full.projectId,
                floorId: full.floorId,
                ...(full.unitId ? { unitId: full.unitId } : {}),
                stageId: QC_INSPECTION_STAGE_ID,
                qualityInspectionId: full.id,
                title: `Quality ${full.result} — ${label}`,
                description: full.remarks || "",
                severity: full.severity || "Major",
                status: "Open",
                raisedBy: full.inspectorUserId || "",
                raisedAt: Date.now(),
                assignedTo: full.correctiveAction ? full.correctiveAction.assignedToUserId : "",
                dueAt: full.correctiveAction ? new Date(full.correctiveAction.targetDate).getTime() || null : null,
                photos: full.photos || [],
                comments: []
              });
              await db.collection("qualityInspections").updateOne({ id: full.id }, { $set: { linkedSnagId: snagId } });
              rec.linkedSnagId = snagId;
            }
          }
          // A passing re-inspection closes the ORIGINAL failed inspection's
          // linked Snag server-side — never trust the client alone to close
          // its own loop, since that Snag's status gates the "open issues"
          // KPI everyone else sees. The corrective-action ASSIGNMENT
          // notification itself already happened via the "snags" upsert
          // branch above, in the same apply() batch that created this record.
          if (shouldResolveOriginal(rec)) {
            const original = await db.collection("qualityInspections").findOne(
              { id: rec.reInspectionOf },
              { projection: { linkedSnagId: 1 } }
            );
            if (original?.linkedSnagId) {
              const closedRes = await db.collection("snags").updateOne(
                { id: original.linkedSnagId },
                { $set: { status: "Closed", closedAt: Date.now(), closedBy: session ? session.userId : null } }
              );
              if (trace) trace.snagClosed = closedRes?.modifiedCount || 0; // (diagnostics only)
            }
          }
        } else {
          await writeRecord(db, op, update);
        }
      } else if (op.op === "delete" && COLLECTIONS.includes(op.coll) && op.id) {
        const deletedByUserId = session ? session.userId : null;
        if (op.coll === "projects") {
          // Project delete + its full cascade (scoped collections, plus the
          // progress records keyed by the floor/unit ids it owns) is one
          // transaction — a crash halfway used to leave the project gone but
          // some of its floors/units/snags/progress still behind, or vice
          // versa, rather than either all-gone or all-untouched.
          await runMaybeNested(async (session) => {
            const floorIds = (await db.collection("floors").find({ projectId: op.id }, { projection: { id: 1 }, session }).toArray()).map((f) => f.id);
            const unitIds = (await db.collection("units").find({ projectId: op.id }, { projection: { id: 1 }, session }).toArray()).map((u) => u.id);
            await archiveBeforeDelete(op.coll, { id: op.id }, deletedByUserId, session, db);
            await db.collection(op.coll).deleteOne({ id: op.id }, { session });
            // A deleted project would otherwise leave its floors/units/snags/
            // assignments/dpr/drawingRequests/stagemap rows behind with a
            // projectId that no longer resolves to anything — every page that
            // joins on projectId assumes it always does.
            if (trace) trace.cascade = {}; // (diagnostics only; reset because the transaction callback can be retried)
            for (const c of PROJECT_SCOPED_COLLECTIONS) {
              await archiveBeforeDelete(c, { projectId: op.id }, deletedByUserId, session, db);
              const deleted = await db.collection(c).deleteMany({ projectId: op.id }, { session });
              if (trace) trace.cascade[c] = deleted?.deletedCount;
            }
            // progress documents are keyed `${targetId}::${stageId}` (see
            // frontend shared/rules.ts's pkey) — projectId isn't one of their
            // own fields, so they're only reachable via the floor/unit ids
            // gathered above, before those rows were deleted.
            const targetIds = [...floorIds, ...unitIds];
            if (targetIds.length) {
              const pattern = "^(" + targetIds.map(escapeRegExp).join("|") + ")::";
              await archiveBeforeDelete("progress", { _id: { $regex: pattern } }, deletedByUserId, session, db);
              const deletedProgress = await db.collection("progress").deleteMany({ _id: { $regex: pattern } }, { session });
              if (trace) trace.cascade.progress = deletedProgress?.deletedCount;
            }
          });
        } else {
          await archiveBeforeDelete(op.coll, { id: op.id }, deletedByUserId, undefined, db);
          await db.collection(op.coll).deleteOne({ id: op.id });
          await recordVmsTombstone(db, op.coll, op.id);
        }
      } else if (op.op === "progress" && op.key && op.patch) {
        const { set, unset } = splitSetUnset(op.patch);
        const update = {};
        if (Object.keys(set).length) update.$set = set;
        if (Object.keys(unset).length) update.$unset = unset;
        await db.collection("progress").updateOne({ _id: op.key }, progressUpdate(op.patch, update, op.items), { upsert: true });
      } else if (op.op === "event" && op.ev) {
        await db.collection("events").insertOne(Object.assign({}, op.ev));
      }

      // Slack follow-ups for approvals — after the write, never blocking or failing it
      if (op._notifyApprovalRequest) after(() => notifyApprovalRequest(op._notifyApprovalRequest, op.rec));
    if (op._notifyDprSubmit) after(() => notifyDprSubmitted(op.rec)); // (main's DPR Slack notice; after the commit under OPS_ATOMIC)
      if (op._notifyApprovalDecision) {
        const d = op._notifyApprovalDecision;
        after(() => {
          mongoDb.collection(d.coll).findOne({ id: op.rec.id }, { projection: { _id: 0 } })
            .then((saved) => saved && notifyApprovalDecision(d.coll, saved, d.status, d.remark, d.byUserId))
            .catch((e) => console.error("approval decision notify failed:", e.message));
        });
      }
    }
  };
  if (OPS_ATOMIC) {
    await withOptionalTransaction(async (txs) => { txSession = txs; return writeAll(txs ? sessionDb(txs) : mongoDb); });
    for (const fn of deferred) { try { fn(); } catch (e) { console.error("post-commit notification failed:", e && e.message); } }
  } else {
    await writeAll(mongoDb);
  }
  await trimEvents();
  return bumpRev();
}

/* Server-side counterpart to hooks/useDrawingRequestActions.ts, used only by
   the /api/automation/drawing-requests/:id/decision route below — an
   unattended caller (n8n, after a Slack button click) has no user session to
   drive the normal /api/ops path with, and needs its transitions validated
   here rather than trusted from the client. Mirrors the same 4 real actions
   the frontend offers; "resubmit" is the one action available from
   "returned" instead of a stage-scoped approve/return. */
const DRAWING_PRIORITIES = ["low", "medium", "high", "urgent"];

async function performDrawingRequestDecision(id, action, opts, actorName) {
  const dr = await mongoDb.collection("drawingRequests").findOne({ id });
  if (!dr) { const e = new Error("Drawing request not found"); e.status = 404; throw e; }
  if (opts.priority && !DRAWING_PRIORITIES.includes(opts.priority)) {
    const e = new Error(`priority must be one of: ${DRAWING_PRIORITIES.join(", ")}`);
    e.status = 400;
    throw e;
  }

  const historyEntry = (stage, historyAction, remarks) => ({
    stage, action: historyAction, remarks: remarks || "", by: null, byName: actorName || "Automation (n8n)", at: Date.now()
  });

  let patch;
  if (dr.reviewStatus === "stage-1-screen" && action === "approve") {
    patch = {
      reviewStatus: "stage-2-produce", assignedTo: opts.assignedTo || null, committedDate: opts.committedDate || null,
      reviewHistory: [...dr.reviewHistory, historyEntry("stage-1-screen", "forwarded", opts.remarks)]
    };
  } else if (dr.reviewStatus === "stage-1-screen" && action === "return") {
    patch = { reviewStatus: "returned", reviewHistory: [...dr.reviewHistory, historyEntry("stage-1-screen", "returned", opts.remarks)] };
  } else if (dr.reviewStatus === "stage-3-crosscheck" && action === "approve") {
    patch = { reviewStatus: "stage-4-final-approve", reviewHistory: [...dr.reviewHistory, historyEntry("stage-3-crosscheck", "forwarded", opts.remarks)] };
  } else if (dr.reviewStatus === "stage-3-crosscheck" && action === "return") {
    patch = { reviewStatus: "stage-2-produce", reviewHistory: [...dr.reviewHistory, historyEntry("stage-3-crosscheck", "returned", opts.remarks)] };
  } else if (dr.reviewStatus === "stage-4-final-approve" && action === "approve") {
    patch = {
      reviewStatus: "approved", priority: opts.priority || "",
      reviewHistory: [...dr.reviewHistory, historyEntry("stage-4-final-approve", "approved", opts.remarks)]
    };
  } else if (dr.reviewStatus === "stage-4-final-approve" && action === "return") {
    patch = { reviewStatus: "stage-2-produce", reviewHistory: [...dr.reviewHistory, historyEntry("stage-4-final-approve", "returned", opts.remarks)] };
  } else if (dr.reviewStatus === "returned" && action === "resubmit") {
    patch = { reviewStatus: "stage-1-screen", reviewHistory: [...dr.reviewHistory, historyEntry("returned", "resubmitted", opts.remarks)] };
  } else {
    const e = new Error(`"${action}" isn't a valid action from stage "${dr.reviewStatus}"`);
    e.status = 400;
    throw e;
  }

  // Re-checked against the same table the generic /api/ops path uses, so
  // this function can never grant a transition assertOpAllowed wouldn't.
  const allowed = DRAWING_TRANSITIONS[dr.reviewStatus] || [];
  if (!allowed.includes(patch.reviewStatus)) {
    const e = new Error(`Invalid drawing request transition: ${dr.reviewStatus} -> ${patch.reviewStatus}`);
    e.status = 400;
    throw e;
  }

  // Compare-and-swap on the stage read at the top of this function — closes
  // the same race the generic /api/ops path guards against (two callers
  // deciding on the same ticket at once shouldn't silently let the second
  // one overwrite the first's transition).
  const result = await mongoDb.collection("drawingRequests").updateOne({ id, reviewStatus: dr.reviewStatus }, { $set: patch });
  if (result.matchedCount === 0) {
    const e = new Error(`${id} was already moved to a different stage by someone else — reload and retry`);
    e.status = 409;
    throw e;
  }
  await bumpRev();
  const saved = await mongoDb.collection("drawingRequests").findOne({ id }, { projection: { _id: 0 } });
  notifyDrawingRequestStageChange(saved);
  return saved;
}

async function trimEvents() {
  // Fast path only: the metadata estimate (O(1)) is used to skip the common
  // "nowhere near the cap" case on every ops batch. It is never used to decide
  // HOW MANY audit events to delete — that always comes from an exact count, so
  // retention is identical to before even if the estimate is off.
  if ((await mongoDb.collection("events").estimatedDocumentCount()) <= MAX_EVENTS) return;
  const count = await mongoDb.collection("events").countDocuments();
  if (count <= MAX_EVENTS) return;
  // "Everything older than the newest MAX_EVENTS" is a deterministic set, so concurrent trims all pick the SAME events.
  // (It used to be "the oldest count-MAX": two trims that both counted before either deleted each removed that many, so a
  // burst of saves at the cap trimmed the live log BELOW MAX_EVENTS — measured 30 events too many with 40 parallel saves.)
  const oldest = await mongoDb
    .collection("events")
    .find({}, EVENTS_ARCHIVE_DAYS > 0 ? {} : { projection: { _id: 1 } })
    .sort({ ts: -1, _id: -1 })
    .skip(MAX_EVENTS)
    .limit(5000)
    .toArray();
  if (oldest.length && EVENTS_ARCHIVE_DAYS > 0) {
    // keep them (EVENTS_ARCHIVE_DAYS): copy first, delete only what was copied; a duplicate (already archived) is fine
    const expireAt = new Date(Date.now() + EVENTS_ARCHIVE_DAYS * 86400000), archivedAt = Date.now();
    try { await mongoDb.collection("eventsArchive").insertMany(oldest.map((e) => Object.assign({}, e, { archivedAt, expireAt })), { ordered: false }); }
    catch (e) { if (!(e && (e.code === 11000 || (e.writeErrors || []).every((w) => w.code === 11000)))) throw e; }
  }
  if (oldest.length) await mongoDb.collection("events").deleteMany({ _id: { $in: oldest.map((o) => o._id) } });
}

/* Wraps a multi-collection delete+insert (resetDb, restoreBackup) in a real
   Mongo transaction — previously a crash or dropped connection partway
   through the collection loop left the board in a half-wiped, half-restored
   state with no way back (exactly the scenario the whole Backups feature
   exists to protect against, undermined by its own restore path not being
   atomic). Atlas is always a replica set, so transactions are available;
   falls back to running `work` without one only if the driver reports
   transactions aren't supported (e.g. a standalone mongod in local dev),
   rather than hard-failing reset/restore entirely in that case. */
async function withOptionalTransaction(work) {
  const session = mongoClient.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (e) {
    if (/Transaction numbers are only allowed|IllegalOperation/i.test(e.message || "")) {
      console.warn("  ! Mongo transactions unsupported on this deployment — falling back to non-atomic writes:", e.message);
      return work(null);
    }
    throw e;
  } finally {
    await session.endSession();
  }
}

async function resetDb(mode, actorUserId, opts) {
  const seed = mode === "blank" ? blankData() : seedData();
  await takeSafetyBackup("pre-reset", actorUserId, opts);
  return withOptionalTransaction(async (session) => {
    for (const c of COLLECTIONS) {
      await mongoDb.collection(c).deleteMany({}, { session });
      if (seed[c].length) await mongoDb.collection(c).insertMany(seed[c], { session });
    }
    await mongoDb.collection("progress").deleteMany({}, { session });
    const progressEntries = Object.entries(seed.progress || {});
    if (progressEntries.length) {
      await mongoDb.collection("progress").insertMany(progressEntries.map(([key, patch]) => Object.assign({ _id: key }, patch)), { session });
    }
    await mongoDb.collection("events").deleteMany({}, { session });
    if ((seed.events || []).length) await mongoDb.collection("events").insertMany(seed.events, { session });

    const rev = (await getRev()) + 1;
    await mongoDb.collection("meta").updateOne({ _id: "rev" }, { $set: { value: rev } }, { upsert: true, session });
    // Recorded AFTER the seed events above are inserted (that insert wipes
    // the whole events collection first) — a reset/restore wiping the
    // board with no trace of who did it, or when, was the exact forensic
    // gap that made past accidental resets so hard to piece together.
    await mongoDb.collection("events").insertOne(
      { ts: Date.now(), userId: actorUserId || "", action: "RESET_DB", targetId: mode, stageId: "", detail: `Board reset (${mode})` },
      { session }
    );
    return rev;
  });
}

/* ----------------------------------------------------------------- backups
   A `backups` document is a full point-in-time copy of every real
   collection's raw documents — including passwordHash/passwordSalt, so a
   restore brings logins back working too. Kept in Mongo only; never sent to
   a browser in that raw form (list/download strip password fields, same as
   getState()). This exists because a demo-reset or bad op has genuinely
   wiped this shared board multiple times this session with no way back. */
// Creation, size/duration logging, and the cheap listing live in backups.js.
const createBackup = (createdBy) => backups.createBackup(mongoDb, COLLECTIONS, createdBy);
const summarizeBackup = backups.summarizeBackup;

/* Automatic, traffic-triggered backup — the "real" scheduled path
   (/api/backup/scheduled) depends on an external cron pinger, and nothing
   was ever actually configured to call it: production went from 2026-10-10
   to 2026-10-21 with zero automatic backups, only two manual ones (both
   created by a person, not "scheduled"). Rather than depend on an external
   service existing (or an in-process setInterval, unreliable on Render's
   free tier since the instance can sleep through it), this piggybacks on
   real incoming traffic: whichever request happens to arrive once the last
   backup is 24h+ old creates a fresh one, in the background, never slowing
   that request down. An idle app with zero visitors still won't back
   itself up — there's no request to piggyback on — but that's the same
   idle app that also isn't being changed, so nothing new is at risk either.
   AUTO_BACKUP_CHECK_MIN_GAP_MS keeps this to one cheap Mongo read per
   10 minutes of traffic, not per request. */
const AUTO_BACKUP_CHECK_MIN_GAP_MS = 10 * 60 * 1000;
const AUTO_BACKUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
let lastAutoBackupCheckAt = 0;
let autoBackupInFlight = false;
function maybeAutoBackup() {
  const now = Date.now();
  if (now - lastAutoBackupCheckAt < AUTO_BACKUP_CHECK_MIN_GAP_MS || autoBackupInFlight) return;
  lastAutoBackupCheckAt = now;
  autoBackupInFlight = true;
  (async () => {
    const [latest] = await mongoDb.collection("backups").find({}, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).toArray();
    if (latest && now - latest.createdAt < AUTO_BACKUP_MIN_AGE_MS) return; // not due yet
    const doc = await createBackup("auto-traffic");
    console.log(`[backup] automatic (traffic-triggered): ${doc.id}`);
  })()
    .catch((e) => reportBackupFailure("auto-traffic", e))
    .finally(() => { autoBackupInFlight = false; });
}

/* A failed backup must never be silent. Always logged and recorded in the audit
   log; also sent to Slack (BACKUP_ALERT_EMAILS, default: the QC report owner)
   when Slack is configured. For the scheduled route the HTTP 500 is a second
   signal — an external cron pinger can alert on any non-200. */
const BACKUP_ALERT_EMAILS = (process.env.BACKUP_ALERT_EMAILS || QC_REPORT_NOTIFY_EMAIL).split(",").map((e) => e.trim()).filter(Boolean);
async function reportBackupFailure(source, err) {
  console.error(`[backup] ${source} backup FAILED:`, err && err.stack ? err.stack : err);
  try {
    await mongoDb.collection("events").insertOne({
      ts: Date.now(), userId: source === "scheduled" ? "" : source, action: "BACKUP_FAILED", targetId: "", stageId: "",
      detail: `${source} backup failed: ${String(err && err.message || err).slice(0, 300)}`
    });
    await bumpRev();
  } catch (e) { console.error("[backup] could not record the failure event:", e.message); }
  if (!SLACK_BOT_TOKEN) return;
  for (const email of BACKUP_ALERT_EMAILS) {
    try {
      const uid = await slackUserIdForEmail(email);
      if (uid) await slackPostMessage(uid, `🚨 *Board backup FAILED* (${source}) — ${String(err && err.message || err).slice(0, 400)}`);
    } catch (e) { console.error("[backup] Slack alert failed:", e.message); }
  }
}

function stripBackupPasswords(doc) {
  const collections = Object.assign({}, doc.collections);
  if (collections.users) {
    collections.users = collections.users.map((u) => {
      const { passwordHash, passwordSalt, legacyPasswordHash, ...rest } = u;
      return rest;
    });
  }
  return Object.assign({}, doc, { collections });
}

/* A restore (and a reset) replaces the whole live board. First save what is there now as an ordinary backup, so a
   restore of the wrong/old backup can itself be undone. If that backup cannot be made nothing is touched, unless the
   caller explicitly sends skipSafetyBackup:true. */
async function takeSafetyBackup(kind, actorUserId, opts) {
  if (opts && opts.skipSafetyBackup === true) return null;
  try {
    return (await createBackup(kind + ":" + (actorUserId || "?"))).id;
  } catch (e) {
    const err = new Error("Could not take a safety backup first (" + e.message + ") — nothing was changed. To continue without one, repeat the request with skipSafetyBackup:true.");
    err.status = 409;
    throw err;
  }
}

async function restoreBackup(id, actorUserId, opts) {
  const doc = await mongoDb.collection("backups").findOne({ id });
  if (!doc) { const e = new Error("Backup not found"); e.status = 404; throw e; }
  const safetyId = await takeSafetyBackup("pre-restore", actorUserId, opts);
  const skipped = [];
  return withOptionalTransaction(async (session) => {
    skipped.length = 0; // the transaction callback can be retried
    for (const c of COLLECTIONS) {
      // An older backup predates some collections (e.g. columnMaster, caseStudies). Restoring it used to EMPTY those
      // collections; now a collection the backup does not contain is left exactly as it is.
      if (!doc.collections || !Array.isArray(doc.collections[c])) { skipped.push(c); continue; }
      await mongoDb.collection(c).deleteMany({}, { session });
      const rows = doc.collections[c];
      if (rows.length) await mongoDb.collection(c).insertMany(rows, { session });
    }
    await mongoDb.collection("progress").deleteMany({}, { session });
    const progressEntries = Object.entries(doc.progress || {});
    if (progressEntries.length) {
      await mongoDb.collection("progress").insertMany(progressEntries.map(([key, patch]) => Object.assign({ _id: key }, patch)), { session });
    }
    const rev = (await getRev()) + 1;
    await mongoDb.collection("meta").updateOne({ _id: "rev" }, { $set: { value: rev } }, { upsert: true, session });
    // "events" isn't in COLLECTIONS (it's managed separately from the rest
    // of the board), so the loop above never touches it — this insert
    // survives the restore, recording who restored which backup and when.
    await mongoDb.collection("events").insertOne(
      { ts: Date.now(), userId: actorUserId || "", action: "RESTORE_BACKUP", targetId: id, stageId: "", detail: `Restored backup ${id}` + (safetyId ? ` (board saved first as ${safetyId})` : "") + (skipped.length ? ` — kept current data for ${skipped.length} collection(s) this backup does not contain: ${skipped.join(", ")}` : "") },
      { session }
    );
    return rev;
  });
}

/* ------------------------------------------------------------------ http */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

// Every write (POST /api/ops, backup restore/reset, etc.) replies with the
// fresh full board state so the caller's own change is immediately
// reflected — but until now that went out uncompressed and bypassed the
// getStateGzip() cache entirely, on the exact request path a form's Save
// button is waiting on. A write just bumped rev anyway, so this is always
// a cache rebuild (never stale), just compressed like every other state
// response — on a slow/mobile connection this is the difference between a
// few hundred KB and a few dozen.
async function sendStateResponse(req, res) {
  // Callers without a VALID session (anonymous, or an expired/invalid token — e.g. someone on a public form
  // page who once signed in) get the allow-listed public snapshot instead of the whole board. Never a 401:
  // the same function answers a public form's own successful write. Off until PUBLIC_STATE_ENFORCE=1 (see below).
  if (PUBLIC_STATE_ENFORCE && !getSession(req)) {
    return sendJson(res, 200, await buildPublicState(mongoDb, COLLECTIONS, await getRev()));
  }
  if (String(req.headers["accept-encoding"] || "").includes("gzip")) {
    const { body: compressed } = await getStateGzip();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "Content-Length": compressed.length,
      "Cache-Control": "no-store"
    });
    return res.end(compressed);
  }
  const state = await getState();
  return sendJson(res, 200, state);
}

function sendText(res, code, msg) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(msg);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Slack's interactive-message POST must be signature-verified against its
// exact raw bytes before any parsing — readBody() above already JSON-
// parses (and Slack's body isn't JSON anyway, it's urlencoded), so this is
// a separate reader that hands back the untouched string.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleApi(req, res, urlPath) {
  if (req.method === "GET" && urlPath === "/api/rev") {
    return sendJson(res, 200, { rev: await getRev() });
  }
  if (req.method === "GET" && urlPath === "/api/state") {
    // The full board snapshot is the largest response this API ever sends
    // (thousands of units/progress/events records) — gzip it when the
    // client supports it (every browser does) instead of shipping raw JSON,
    // which was a big share of how long sign-in felt on slower connections.
    return sendStateResponse(req, res);
  }
  if (req.method === "POST" && urlPath === "/api/login") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return sendJson(res, 400, { error: "Email and password are required" });

    const lockedFor = loginLockoutRemaining(email);
    if (lockedFor > 0) {
      return sendJson(res, 429, { error: `Too many failed attempts — try again in ${Math.ceil(lockedFor / 1000)}s` });
    }

    const user = await mongoDb.collection("users").findOne({ email: new RegExp("^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
    if (!user) { recordFailedLogin(email); logFailedLogin(email, null, "no account with this e-mail"); return sendJson(res, 401, { error: "Invalid email or password" }); }
    if (user.active === false) { logFailedLogin(email, user.id, "account is inactive"); return sendJson(res, 401, { error: "This account is inactive" }); }

    if (user.passwordHash && user.passwordSalt) {
      if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        recordFailedLogin(email);
        logFailedLogin(email, user.id, "wrong password");
        return sendJson(res, 401, { error: "Invalid email or password" });
      }
    } else if (user.legacyPasswordHash) {
      if (!bcrypt.compareSync(password, user.legacyPasswordHash)) {
        recordFailedLogin(email);
        logFailedLogin(email, user.id, "wrong password");
        return sendJson(res, 401, { error: "Invalid email or password" });
      }
      // First successful login on a legacy account — migrate to our own
      // scrypt hash and drop the bcrypt one, so this branch never runs again.
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = hashPassword(password, salt);
      await mongoDb.collection("users").updateOne(
        { id: user.id },
        { $set: { passwordHash, passwordSalt: salt }, $unset: { legacyPasswordHash: "" } }
      );
    } else {
      recordFailedLogin(email);
      logFailedLogin(email, user.id, "no password set on this account");
      return sendJson(res, 401, { error: "Invalid email or password" });
    }

    clearLoginAttempts(email);
    const { _id, passwordHash, passwordSalt, legacyPasswordHash, ...safeUser } = user;
    const token = issueSession(user);
    // Best-effort — a logging hiccup must never block a real sign-in. No
    // persistent login trail existed before this (only the in-memory
    // lockout counter above, which never survives a restart and was never
    // meant as an audit record) — Audit Logs couldn't answer "who signed in
    // and when" at all.
    mongoDb.collection("events").insertOne({
      ts: Date.now(), userId: user.id, action: "LOGIN", targetId: user.id, stageId: "", detail: `${user.name || email} signed in`
    }).catch((e) => console.error("Failed to log LOGIN event:", e.message));
    return sendJson(res, 200, { user: safeUser, token });
  }
  if (req.method === "POST" && urlPath === "/api/ops") {
    const body = await readBody(req);
    if (!Array.isArray(body.ops)) return sendJson(res, 400, { error: "ops[] required" });
    // Optional (older clients don't send it): lets a retried batch be recognised, see opsBatch.js.
    const batchId = body.batchId === undefined ? null : String(body.batchId);
    if (batchId !== null && !isValidBatchId(batchId)) return sendJson(res, 400, { error: "invalid batchId" });
    if (batchId !== null) {
      const claim = await opsBatch.claim(batchId);
      // 503 (not a 4xx) so the client keeps the batch and retries shortly
      if (claim === "busy") return sendJson(res, 503, { error: "This change is already being saved — retrying shortly" });
      if (claim === "done") return sendStateResponse(req, res); // applied earlier; acknowledge, don't repeat
    }
    const opsSession = getSession(req);
    // LOG-ONLY diagnostics (null unless SAVE_DIAGNOSTICS=1): observes this batch, never alters it — no body,
    // write or ordering depends on it, and every call into it swallows its own errors.
    const probe = saveDiag ? saveDiag.begin(body.ops, { anonymous: !opsSession }) : null;
    try {
      await applyOps(body.ops, opsSession, probe ? probe.trace : undefined);
      if (probe) probe.finish();
      if (batchId !== null) await opsBatch.complete(batchId);
    } catch (e) {
      if (probe) probe.abort();
      if (batchId !== null) await opsBatch.release(batchId);
      if (e.status) return sendJson(res, e.status, { error: e.message });
      throw e;
    }
    return sendStateResponse(req, res);
  }
  const automationDecisionMatch = /^\/api\/automation\/drawing-requests\/([^/]+)\/decision$/.exec(urlPath);
  if (req.method === "POST" && automationDecisionMatch) {
    // No user session — this is for an unattended caller (an n8n workflow
    // reacting to a Slack button click), authorized via a shared secret
    // header instead, same pattern as /api/backup/scheduled.
    if (!AUTOMATION_SECRET) return sendJson(res, 501, { error: "AUTOMATION_SECRET is not configured" });
    if (!timingSafeStringEqual(req.headers["x-automation-secret"], AUTOMATION_SECRET)) return sendJson(res, 401, { error: "Invalid automation secret" });
    const body = await readBody(req);
    if (!["approve", "return", "resubmit"].includes(body.action)) {
      return sendJson(res, 400, { error: "action must be one of: approve, return, resubmit" });
    }
    try {
      const saved = await performDrawingRequestDecision(automationDecisionMatch[1], body.action, {
        remarks: body.remarks, assignedTo: body.assignedTo, committedDate: body.committedDate, priority: body.priority
      }, body.actorName);
      return sendJson(res, 200, { request: saved });
    } catch (e) {
      if (e.status) return sendJson(res, e.status, { error: e.message });
      throw e;
    }
  }
  if (req.method === "POST" && urlPath === "/api/integrations/vms/dpr") {
    // Phase 2 — VMS's syncDprToQcViaApi() posts here instead of writing
    // straight into this Mongo cluster. No user session (VMS is an
    // unattended server-to-server caller), authorized the same way
    // /api/automation/.../decision and /api/backup/scheduled already are:
    // a shared secret header, timing-safe compared.
    if (!VMS_SYNC_SECRET) return sendJson(res, 501, { error: "VMS_SYNC_SECRET is not configured" });
    if (!timingSafeStringEqual(req.headers["x-vms-sync-secret"], VMS_SYNC_SECRET)) {
      return sendJson(res, 401, { error: "Invalid VMS sync secret" });
    }
    const body = await readBody(req);
    const result = await handleVmsDprSync(body, mongoDb);
    // A newly inserted DPR must be visible to every open board — clients only
    // refetch when /api/rev changes, and this path used to leave it untouched.
    // Duplicates/rejections wrote nothing, so they don't bump.
    if (vmsSyncWroteRecord(result)) await bumpRev();
    return sendJson(res, result.status, result.body);
  }
  if (req.method === "POST" && urlPath === "/api/ims/webhook") {
    // IMS's PO_APPROVED event lands here — no user session (IMS is an
    // unattended server-to-server caller), same shared-secret pattern as
    // /api/integrations/vms/dpr. sanitizePoEvent() (imsWebhook.js) strips
    // every financial/PII field (vendor bank details, GST/PAN, contact
    // info, payment amounts) before anything is written — this module is
    // deliberately non-financial, same boundary as progressAnalysis.js.
    if (!IMS_WEBHOOK_SECRET) {
      console.warn("[ims-webhook] rejected 501 — IMS_WEBHOOK_SECRET is not set on this server");
      return sendJson(res, 501, { error: "IMS_WEBHOOK_SECRET is not configured" });
    }
    if (!timingSafeStringEqual(String(req.headers["x-ims-secret"] || "").trim(), IMS_WEBHOOK_SECRET)) {
      console.warn("[ims-webhook] rejected 401 — x-ims-secret header " + (req.headers["x-ims-secret"] ? "does not match" : "is missing"));
      return sendJson(res, 401, { error: "Invalid IMS webhook secret" });
    }
    const body = await readBody(req);
    // VMS_PO_UPDATE_EVENT/VMS_PO_DELETE_EVENT: uncomment in .env once IMS
    // confirms it sends real lifecycle event names instead of always
    // "PO_APPROVED" + an `action` field — no code change needed either way,
    // sanitizePoEvent() already treats `event` and `action` as independent
    // signals for the same thing (see imsWebhook.js's doc comment).
    const parsed = sanitizePoEvent(body, {
      updateEventName: process.env.VMS_PO_UPDATE_EVENT || "",
      deleteEventName: process.env.VMS_PO_DELETE_EVENT || ""
    });
    if (!parsed.valid) {
      console.warn("[ims-webhook] rejected 400 — " + parsed.error);
      return sendJson(res, 400, { error: parsed.error });
    }
    const existing = await mongoDb.collection("purchaseOrders").findOne({ id: parsed.record.id });
    if (isStaleUpdate(existing && existing.sourceUpdatedAt, parsed.record.sourceUpdatedAt)) {
      console.warn(`[ims-webhook] ignored stale update for PO ${parsed.record.id} — incoming data.updatedAt is older than what's already stored`);
      return sendJson(res, 200, { ok: true, ignored: "stale" });
    }
    // A delete ping often carries nothing but {poId, deleted:true} — merge
    // onto the existing stored record (if any) so project/items/status
    // aren't wiped out by a payload that was never going to resend them.
    let projectId = existing ? existing.projectId : null;
    let projectCode = existing ? existing.projectCode : null;
    if (!parsed.record.deleted) {
      const qcProjects = await mongoDb.collection("projects").find({}, { projection: { id: 1, code: 1, name: 1 } }).toArray();
      const matched = matchProjectByName(parsed.record.projectNameRaw, qcProjects);
      projectId = matched ? matched.id : null;
      projectCode = matched ? matched.code : null;
    }
    const rec = { ...(existing || {}), ...parsed.record, projectId, projectCode };
    await mongoDb.collection("purchaseOrders").updateOne({ id: rec.id }, { $set: rec }, { upsert: true });
    // Same reason as the VMS DPR route above: without a rev bump, open boards
    // never learn about this write. (A stale/ignored update returned earlier
    // and wrote nothing, so it correctly doesn't reach this line.)
    await bumpRev();
    console.log(`[ims-webhook] saved PO ${rec.id} (deleted=${rec.deleted}) — ${projectCode ? "linked to project " + projectCode : "NOT linked to any QC project"}`);
    return sendJson(res, 200, { ok: true, matched: !!projectCode });
  }
  if (req.method === "POST" && urlPath === "/api/approvals/slack-resend") {
    // (Re)send everything that is waiting on someone to Slack, with the
    // Approve / Reject buttons — for work that was saved before Slack
    // approvals existed. A team leader sends only what is waiting on THEM;
    // Admin sends everyone's. Replies at once, delivers in the background (a
    // short pause between messages keeps Slack happy), and a minute's cooldown
    // per person stops an accidental double press from messaging twice.
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!SLACK_BOT_TOKEN) return sendJson(res, 501, { error: "Slack is not configured on this server" });
    // { coll, id } = send just that one record; no body = everything waiting on this person
    const reqBody = (await readBody(req).catch(() => null)) || {};
    const one = reqBody.coll && reqBody.id ? approvalSlack.parseApprovalEntity(reqBody.coll + ":" + reqBody.id) : null;
    const cooldownKey = session.userId + (one ? "|" + one.coll + ":" + one.id : "");
    const last = approvalResendAt.get(cooldownKey) || 0;
    if (Date.now() - last < (one ? 10000 : 60000)) return sendJson(res, 429, { error: "Already sent a moment ago — wait before sending again." });
    approvalResendAt.set(cooldownKey, Date.now());
    const colls = approvalSlack.APPROVAL_COLLECTIONS;
    const [users, teams, ...lists] = await Promise.all([
      mongoDb.collection("users").find({}, { projection: { _id: 0, id: 1, name: 1, teamId: 1 } }).toArray(),
      mongoDb.collection("teams").find({}, { projection: { _id: 0, id: 1, leaderId: 1 } }).toArray(),
      ...colls.map((c) => mongoDb.collection(c).find({}, { projection: { _id: 0 } }).toArray())
    ]);
    const records = Object.fromEntries(colls.map((c, i) => [c, lists[i]]));
    const pending = findPendingApprovals({ records, users, teams }).filter((p) => (session.isAdmin || p.approverUserId === session.userId) && (!one || (p.coll === one.coll && p.rec.id === one.id)));
    sendJson(res, 200, { queued: pending.length });
    (async () => {
      for (const p of pending) {
        // the message goes to whoever holds it NOW, and carries buttons that act on the record itself
        const rec = { ...p.rec, approval: { ...(p.rec.approval || { status: "pending" }), approverUserId: p.approverUserId } };
        await notifyApprovalRequest(p.coll, rec);
        await new Promise((r) => setTimeout(r, 700));
      }
    })().catch((e) => console.error("approval slack-resend failed:", e.message));
    return;
  }
  if (req.method === "POST" && urlPath === "/api/slack/actions") {
    // Slack's "Interactivity & Shortcuts" Request URL — a button click
    // (Close Snag / Approve Report) posts here. Verified via Slack's own
    // request signature (SLACK_SIGNING_SECRET), never a static shared
    // secret like the other automation endpoints, since Slack itself is
    // the caller here, not a workflow tool we configure.
    if (!SLACK_SIGNING_SECRET) return sendJson(res, 501, { error: "SLACK_SIGNING_SECRET is not configured" });
    const rawBody = await readRawBody(req);
    const ok = verifySlackSignature({
      signingSecret: SLACK_SIGNING_SECRET,
      timestamp: req.headers["x-slack-request-timestamp"],
      rawBody,
      signature: req.headers["x-slack-signature"]
    });
    if (!ok) return sendJson(res, 401, { error: "Invalid Slack signature" });

    const payload = parseSlackActionPayload(rawBody);

    // The Reject form was submitted: Slack needs a validation answer in the HTTP
    // reply itself (an empty remark keeps the form open), the real work follows.
    if (payload?.type === "view_submission") {
      const sub = approvalSlack.parseRejectSubmission(payload);
      if (!sub) return sendJson(res, 200, {});
      if (!sub.remark) return sendJson(res, 200, approvalSlack.remarkRequiredResponse());
      (async () => {
        try {
          const actor = await appUserForSlackUserId(payload.user?.id);
          const out = await decideApprovalFromSlack({ coll: sub.coll, id: sub.id, status: "rejected", remark: sub.remark, actor });
          if (sub.channel && sub.ts) await slackUpdateMessage(sub.channel, sub.ts, out.message);
          else if (!out.ok && payload.user?.id) await slackPostMessage(payload.user.id, out.message, undefined, { noCopy: true });
        } catch (e) {
          console.error("Slack reject submission failed:", e.message);
        }
      })();
      return sendJson(res, 200, {});
    }

    const action = payload?.actions?.[0];
    const parsed = action ? parseActionId(action.action_id) : null;

    async function respond(text) {
      if (!payload?.response_url) return;
      try {
        await fetch(payload.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replace_original: true, text })
        });
      } catch (e) {
        console.error("Slack response_url post failed:", e.message);
      }
    }

    if (parsed) {
      // Slack needs an HTTP response within 3 seconds — ack immediately
      // below and do the actual write + response_url follow-up in the
      // background, same "never block the triggering request" pattern
      // notifySlack/notifyEvent already use elsewhere in this file.
      (async () => {
        try {
          // Reject opens the form first, while Slack's short-lived trigger_id is still valid
          if (parsed.kind === "approval_reject") {
            const ent = approvalSlack.parseApprovalEntity(parsed.entityId);
            if (ent) {
              const summary = String(payload.message?.text || "").split("\n")[0];
              await slackOpenView(payload.trigger_id, approvalSlack.rejectModal({ coll: ent.coll, id: ent.id, summary, channel: payload.channel?.id, ts: payload.message?.ts }));
            }
            return;
          }
          const actor = await appUserForSlackUserId(payload.user?.id);
          if (parsed.kind === "approval_approve") {
            const ent = approvalSlack.parseApprovalEntity(parsed.entityId);
            if (!ent) { await respond("⚠️ That item can't be approved here."); return; }
            const out = await decideApprovalFromSlack({ coll: ent.coll, id: ent.id, status: "approved", actor });
            // a refusal leaves the buttons where they are (so a wrong click doesn't kill the request)
            if (out.ok) await respond(out.message);
            else if (payload.user?.id) await slackPostMessage(payload.user.id, out.message, undefined, { noCopy: true });
            return;
          }
          if (parsed.kind === "snag_close") {
            const snag = await mongoDb.collection("snags").findOne({ id: parsed.entityId });
            if (!snag) { await respond("⚠️ That snag no longer exists."); return; }
            if (snag.status === "Closed") { await respond(`✅ Already closed.`); return; }
            await mongoDb.collection("snags").updateOne(
              { id: parsed.entityId },
              { $set: { status: "Closed", closedAt: Date.now(), closedBy: actor?.id || null } }
            );
            await bumpRev();
            await respond(`✅ Snag *${snag.title}* closed${actor ? ` by ${actor.name}` : " via Slack"}.`);
          } else if (parsed.kind === "team_report_approve") {
            const report = await mongoDb.collection("teamDailyReports").findOne({ id: parsed.entityId });
            if (!report) { await respond("⚠️ That report no longer exists."); return; }
            if (report.status === "Approved") { await respond(`✅ Already approved by ${report.approvedByName || "someone"}.`); return; }
            const team = await mongoDb.collection("teams").findOne({ id: report.teamId });
            const isLeader = !!actor && !!team && team.leaderId === actor.id;
            const isAdmin = !!actor && actor.id === ADMIN_USER_ID;
            if (!actor || (!isLeader && !isAdmin)) { await respond("🚫 Only this team's leader can approve its report."); return; }
            await mongoDb.collection("teamDailyReports").updateOne(
              { id: parsed.entityId },
              { $set: { status: "Approved", approvedByUserId: actor.id, approvedByName: actor.name, approvedAt: Date.now() } }
            );
            await bumpRev();
            await respond(`✅ *${report.teamName}*'s report for ${report.date} approved by ${actor.name}.`);
          }
        } catch (e) {
          console.error("Slack action handling failed:", e.message);
        }
      })();
    }
    return sendJson(res, 200, {});
  }
  if (req.method === "POST" && urlPath === "/api/photo") {
    // A valid session = unchanged behaviour. A request with no (or an invalid/expired) token is
    // treated as anonymous — never a 401 by itself, since the public DPR form uploads photos
    // without signing in — and is limited by photoGuard.js (type, size, per-IP and global rate).
    const photoSession = getSession(req);
    if (PHOTO_GUARD_ENFORCE && !photoSession && Number(req.headers["content-length"]) > photoGuard.config.maxAnonBytes * 1.4) {
      // refuse before buffering a huge body (base64 is ~1.37x the decoded size)
      res.setHeader("Connection", "close");
      return sendJson(res, 413, { error: `Photo is too large (limit ${Math.round(photoGuard.config.maxAnonBytes / 1048576)} MB)` });
    }
    const body = await readBody(req);
    // PDF support exists only for Case Studies' general Attachments (a
    // writeup may reasonably want to attach a report/document, not just
    // site photos) — every other caller here is still image-only, by
    // design (a watermarked site photo should never silently become a raw
    // document upload).
    const imageMatch = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || "");
    const pdfMatch = body.type === "caseStudies" && /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || "");
    if (!imageMatch && !pdfMatch) return sendJson(res, 400, { error: "dataUrl must be a base64 png/jpeg/webp" + (body.type === "caseStudies" ? " or pdf" : "") });
    if (!PHOTO_TYPES.includes(body.type)) {
      return sendJson(res, 400, { error: "type must be one of: " + PHOTO_TYPES.join(", ") });
    }
    const verdict = photoGuard.check({ session: photoSession, type: body.type, dataUrl: body.dataUrl, ip: clientIp(req, CLIENT_IP_HOPS_FROM_RIGHT) });
    if (!verdict.ok) {
      console.warn(guardLogLine({ enforce: PHOTO_GUARD_ENFORCE, verdict, type: body.type, knownTypes: PHOTO_TYPES })); // no client IP in the log
      if (PHOTO_GUARD_ENFORCE) {
        if (verdict.retryAfterSec) res.setHeader("Retry-After", String(verdict.retryAfterSec));
        return sendJson(res, verdict.status, { error: verdict.error });
      }
    }
    try {
      const result = await cloudinary.uploader.upload(body.dataUrl, {
        folder: CLOUDINARY_ROOT + "/" + body.type,
        resource_type: pdfMatch ? "raw" : "image",
        // images may only be real image formats; anonymous uploads are tagged so they can be found and purged
        ...(pdfMatch ? {} : { allowed_formats: ["png", "jpg", "jpeg", "webp"] }),
        ...(verdict.anonymous ? { tags: ["anonymous-upload"] } : {})
      });
      return sendJson(res, 200, { url: result.secure_url, publicId: result.public_id });
    } catch (e) {
      return sendJson(res, 502, { error: "Photo upload failed: " + e.message });
    }
  }
  if (req.method === "POST" && urlPath === "/api/reset") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const body = await readBody(req);
    try {
      await resetDb(body.mode === "blank" ? "blank" : "demo", session.userId, { skipSafetyBackup: body.skipSafetyBackup === true });
    } catch (e) {
      if (e.status) return sendJson(res, e.status, { error: e.message });
      throw e;
    }
    return sendStateResponse(req, res);
  }
  if (req.method === "POST" && urlPath === "/api/backups") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    try {
      const doc = await createBackup(session.userId);
      return sendJson(res, 200, summarizeBackup(doc));
    } catch (e) {
      await reportBackupFailure(session.userId, e);
      return sendJson(res, 500, { error: "Backup failed: " + e.message });
    }
  }
  if (req.method === "POST" && urlPath === "/api/reports/weekly-qc/send-now") {
    // Manual test trigger for the Saturday-1pm-IST weekly Quality Inspection
    // report — Admin only, ignores the schedule/once-per-week marker, so it
    // can be verified immediately instead of waiting for Saturday.
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    if (!globalThis.__sendWeeklyQcReportNow) return sendJson(res, 503, { error: "Not ready yet — try again in a few seconds" });
    const ok = await globalThis.__sendWeeklyQcReportNow();
    return sendJson(res, 200, { sent: ok });
  }
  if (req.method === "GET" && urlPath === "/api/execution-reconciliation") {
    // Read-only aggregation over VMS's own Work Order/Running Bill data
    // (reuses the same SOURCE_MONGO_URI connection the VMS DPR poller
    // already has — same cluster, no new credential). Admin-only, same
    // reasoning as /api/backups and the MIS Dashboard: cross-project
    // financial data, not additively grantable via Permission Matrix.
    const authError = requiresAdmin(getSession(req));
    if (authError) return sendJson(res, authError.status, { error: authError.error });
    const result = await getExecutionReconciliation();
    return sendJson(res, 200, result);
  }
  if (req.method === "GET" && urlPath === "/api/vms-drawing-requests") {
    // VMS's own Drawing Request list (read-only) — what the generated Daily
    // Progress Report's Drawing Request table is built from, so it matches
    // VMS rather than QC's separately-progressed copy. Signed-in only, same
    // level as /api/vms-work-items; no financial data involved.
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    return sendJson(res, 200, await getVmsDrawingRequests());
  }
  if (req.method === "GET" && urlPath === "/api/vms-work-items") {
    // Lightweight project/work-order/work-item structure for the Work
    // Quality Inspection form's pickers — no rate/billing data (see
    // vmsWorkItems.js), so this only requires a signed-in session, same
    // as the rest of the app's non-admin-gated reads. Fine-grained "can
    // this user actually log an inspection" gating happens via the
    // qualityInspection module grant on the frontend, same pattern as
    // every other module.
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    const result = await getVmsWorkItems();
    return sendJson(res, 200, result);
  }
  if (urlPath.startsWith("/api/work-measurements/")) {
    // Read-only helpers for the Measurement page. Signed-in only, same level
    // as /api/vms-work-items; no rate/amount is ever read or returned.
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (req.method === "GET" && urlPath === "/api/work-measurements/categories") {
      return sendJson(res, 200, await workMeasurements.getCategories());
    }
    if (req.method === "POST" && urlPath === "/api/work-measurements/match") {
      const body = await readBody(req);
      if (!body.projectCode) return sendJson(res, 400, { error: "projectCode is required" });
      return sendJson(res, 200, await workMeasurements.findMatches(body));
    }
    if (req.method === "GET" && urlPath === "/api/work-measurements/comparison") {
      const rows = await mongoDb.collection("workMeasurements").find({ linkedItemId: { $ne: null } }).toArray();
      return sendJson(res, 200, await workMeasurements.getComparisons(rows));
    }
  }
  if (req.method === "GET" && urlPath === "/api/progress-analysis") {
    // Project-wise planned-vs-completed VMS progress, variance/sign-off
    // status, and billed-vs-unbilled qty per location (see
    // progressAnalysis.js) — no rate/amount exposed, so same non-admin,
    // signed-in-only gating as /api/vms-work-items.
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    // ?from=&to= (both "YYYY-MM-DD") are optional — only the Daily Progress
    // Report page passes them, to get each item's periodCompletedQty
    // alongside its usual all-time figures (see progressAnalysis.js's own
    // doc comment); Progress Analysis's own dashboard omits them entirely.
    const { searchParams } = new URL(req.url, "http://localhost");
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const periodBounds = from && to ? { from, to } : undefined;
    const result = await getProgressAnalysis(undefined, periodBounds);
    return sendJson(res, 200, result);
  }
  if (req.method === "GET" && urlPath === "/api/backups") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    // summaries are computed inside MongoDB — the full backup documents are never loaded into memory
    return sendJson(res, 200, { backups: await backups.listBackupSummaries(mongoDb) });
  }
  // Admin view of the `trash` collection (every delete is archived there before it happens, see archiveBeforeDelete).
  if (req.method === "GET" && urlPath === "/api/deleted") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const rows = await mongoDb.collection("trash").find({}, { projection: { _id: 0, originalColl: 1, deletedAt: 1, deletedBy: 1, "doc.id": 1, "doc.name": 1, "doc.title": 1, "doc.ticketNo": 1 } }).sort({ deletedAt: -1 }).limit(200).toArray();
    return sendJson(res, 200, { deleted: rows });
  }
  // Puts one archived record back. Never overwrites: if the id exists again it answers 409.
  if (req.method === "POST" && urlPath === "/api/deleted/restore") {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const body = await readBody(req);
    if (!COLLECTIONS.includes(body.coll) || typeof body.id !== "string") return sendJson(res, 400, { error: "coll and id are required" });
    const row = await mongoDb.collection("trash").findOne({ originalColl: body.coll, "doc.id": body.id }, { sort: { deletedAt: -1 } });
    if (!row) return sendJson(res, 404, { error: "No archived copy of that record" });
    try { await mongoDb.collection(body.coll).insertOne(Object.assign({}, row.doc)); }
    catch (e) { if (e && e.code === 11000) return sendJson(res, 409, { error: body.id + " already exists again — nothing was restored." }); throw e; }
    await mongoDb.collection("trash").deleteOne({ _id: row._id });
    await mongoDb.collection("meta").deleteOne({ _id: "tomb:" + body.id }); // a restored VMS-origin record is not blocked any more
    await mongoDb.collection("events").insertOne({ ts: Date.now(), userId: session.userId, action: "RESTORE_DELETED", targetId: body.id, stageId: "", detail: "Restored deleted " + body.coll + " record " + body.id });
    await bumpRev();
    return sendJson(res, 200, { ok: true });
  }
  const backupIdMatch = /^\/api\/backups\/([^/]+)$/.exec(urlPath);
  if (req.method === "GET" && backupIdMatch) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const doc = await mongoDb.collection("backups").findOne({ id: backupIdMatch[1] });
    if (!doc) return sendJson(res, 404, { error: "Backup not found" });
    const { _id, ...safe } = stripBackupPasswords(doc);
    return sendJson(res, 200, safe);
  }
  const restoreMatch = /^\/api\/backups\/([^/]+)\/restore$/.exec(urlPath);
  if (req.method === "POST" && restoreMatch) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    try {
      const restoreBody = await readBody(req).catch(() => ({}));
      await restoreBackup(restoreMatch[1], session.userId, { skipSafetyBackup: !!restoreBody && restoreBody.skipSafetyBackup === true });
    } catch (e) {
      if (e.status) return sendJson(res, e.status, { error: e.message });
      throw e;
    }
    return sendStateResponse(req, res);
  }
  if (req.method === "DELETE" && backupIdMatch) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign-in required" });
    if (!session.isAdmin) return sendJson(res, 403, { error: "Admin access required" });
    const result = await mongoDb.collection("backups").deleteOne({ id: backupIdMatch[1] });
    if (result.deletedCount === 0) return sendJson(res, 404, { error: "Backup not found" });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "GET" && urlPath === "/api/backup/scheduled") {
    // No login required — this is for an external cron pinger (Render's
    // free tier sleeps, so an in-process setInterval can't be relied on).
    // Authorized via a shared secret header instead of a user session.
    const secret = process.env.BACKUP_CRON_SECRET;
    if (!secret) return sendJson(res, 501, { error: "BACKUP_CRON_SECRET is not configured" });
    if (!timingSafeStringEqual(req.headers["x-cron-secret"], secret)) return sendJson(res, 401, { error: "Invalid cron secret" });
    try {
      const doc = await createBackup("scheduled");
      return sendJson(res, 200, summarizeBackup(doc));
    } catch (e) {
      await reportBackupFailure("scheduled", e);
      return sendJson(res, 500, { ok: false, error: "Scheduled backup failed: " + e.message });
    }
  }
  if (req.method === "GET" && urlPath === "/api/team-reports/generate") {
    // Same pattern as /api/backup/scheduled — an external cron pinger hits
    // this at 6pm IST (Render's free tier sleeps, an in-process setInterval
    // can't be relied on). Generates today's Daily Team Report for every
    // Team that has members and doesn't already have one for today, then
    // Slack-DMs each team's leader a summary. Safe to call more than once a
    // day — a team that already has today's report is skipped, never
    // regenerated (so a leader's sign-off is never silently reset).
    const secret = process.env.TEAM_REPORT_CRON_SECRET;
    if (!secret) return sendJson(res, 501, { error: "TEAM_REPORT_CRON_SECRET is not configured" });
    if (!timingSafeStringEqual(req.headers["x-cron-secret"], secret)) return sendJson(res, 401, { error: "Invalid cron secret" });
    const dateStr = require("./teamDailyReports.js").istDateStrOf(Date.now());
    const state = await getState();
    const teams = (state.data.teams || []).filter((t) => t.active !== false);
    const generated = [];
    for (const team of teams) {
      const already = await mongoDb.collection("teamDailyReports").findOne({ teamId: team.id, date: dateStr });
      if (already) continue;
      const report = buildTeamDailyReport(state.data, team, dateStr);
      if (!report) continue; // no members — nothing to report
      try {
        await mongoDb.collection("teamDailyReports").insertOne(Object.assign({}, report));
      } catch (e) {
        if (e && e.code === 11000) continue; // another run created it a moment ago — never overwrite (it may already be signed off)
        throw e;
      }
      generated.push(report.id);
      if (team.leaderId) {
        const leader = await mongoDb.collection("users").findOne({ id: team.leaderId }, { projection: { email: 1, slackId: 1 } });
        if (leader) {
          const summaryText = slackSummaryFor(report);
          slackUserIdForEmail(leader.email, leader.slackId)
            .then((uid) => uid && slackPostMessage(uid, summaryText, teamReportApproveBlocks(summaryText, report.id), { to: leader.name || "the team leader" }))
            .catch((e) => console.error("Daily Team Report Slack DM failed:", team.id, e.message));
        }
      }
    }
    if (generated.length) await bumpRev();
    return sendJson(res, 200, { generated });
  }
  return sendJson(res, 404, { error: "Unknown endpoint " + urlPath });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (ALLOWED_ORIGIN !== "*") res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return sendText(res, 400, "Bad request");
  }

  if (urlPath.startsWith("/api/")) {
    // Fire-and-forget — never awaited, so a check (or an overdue backup) in
    // progress can't add latency to this request.
    if (mongoDb) maybeAutoBackup();
    try {
      return await handleApi(req, res, urlPath);
    } catch (e) {
      // 409 for a duplicate key, 503 for a transient database problem (the browser keeps and retries the change),
      // 400 for everything else exactly as before — see errorMap.js.
      const { status, message } = classifyError(e);
      if (status !== 400) console.error("[api] " + status + " on " + req.method + " " + urlPath + ": " + (e && e.message ? e.message : e));
      return sendJson(res, status, { error: message });
    }
  }

  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(STATIC_ROOT, urlPath);
  if (!filePath.startsWith(STATIC_ROOT + path.sep)) return sendText(res, 403, "Forbidden");

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: a path with no file extension (e.g. /dpr/new, one of
      // the public no-login routes) is a client-side route, not a missing
      // file — serve index.html so React can render it, same as vercel.json's
      // rewrite for production.
      if (!path.extname(urlPath)) {
        const indexPath = path.join(STATIC_ROOT, "index.html");
        return fs.stat(indexPath, (err2, stat2) => {
          if (err2 || !stat2.isFile()) return sendText(res, 404, "Not found: " + urlPath);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": stat2.size, "Cache-Control": "no-store" });
          fs.createReadStream(indexPath).pipe(res);
        });
      }
      return sendText(res, 404, "Not found: " + urlPath);
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) if (net.family === "IPv4" && !net.internal) out.push(net.address);
  }
  return out;
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: node server.js --port ${PORT + 1}`);
    process.exit(1);
  }
  throw err;
});

// Surface the full error for any crash that would otherwise exit silently
// (e.g. an unhandled rejection from a driver internal that isn't routed
// through connectMongo()'s own .catch below).
process.on("unhandledRejection", (err) => {
  console.error("  ! unhandled rejection:", err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("  ! uncaught exception:", err && err.stack ? err.stack : err);
  process.exit(1);
});

console.log(`\n  Neoteric Tower Quality Board`);
connectMongo()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`\n  Local:   http://localhost:${PORT}`);
      for (const ip of lanAddresses()) console.log(`  Network: http://${ip}:${PORT}`);
      console.log(`\n  Shared store: MongoDB   ·   Ctrl+C to stop.\n`);
    });

    // Pull in any new VMS daily progress reports periodically — additive
    // only, never touches existing records. No-ops entirely when
    // SOURCE_MONGO_URI isn't configured (e.g. local dev without VMS access).
    //
    // This is now a RECONCILIATION / RETRY safety net, not the primary
    // sync path — VMS pushes each DPR into QC live at submission time
    // (VENDOR-BILLING-PORTAL-NEW/Backend/src/utils/syncToQc.js). Both
    // paths write the same idempotent "DPR-VMS-<id>" id with an
    // existing-id check, so running both is safe; this one just catches
    // anything the live push missed. DISABLE_VMS_DPR_POLL is an explicit,
    // reversible kill switch for once the push path alone has been
    // verified sufficient — unset (the default) keeps today's behavior
    // unchanged.
    if (process.env.SOURCE_MONGO_URI && !process.env.DISABLE_VMS_DPR_POLL) {
      const { syncVmsDpr } = require("./syncVmsDpr.js");
      let syncInFlight = false;
      const runSync = () => {
        if (syncInFlight) return; // a run already in progress — don't double up if one took longer than the interval
        syncInFlight = true;
        syncVmsDpr(mongoDb)
          .then((result) => {
            if (result.skippedUnmatchedProjects) {
              console.warn(`  [vms-sync] unmapped project(s), skipped: ${result.skippedUnmatchedProjects.join(", ")}`);
            }
            if (result.inserted > 0) {
              console.log(`  [vms-sync] pulled in ${result.inserted} new report(s)`);
              return bumpRev();
            }
          })
          .catch((e) => console.error("  [vms-sync] failed:", e && e.message ? e.message : e))
          .finally(() => { syncInFlight = false; });
      };
      setTimeout(runSync, 10 * 1000); // give the first requests a head start instead of competing at boot
      setInterval(runSync, 30 * 60 * 1000); // every 30 minutes
    }

    // Weekly Work Quality Inspection report -> Slack, Saturday 1pm IST.
    // WEEKLY_QC_REPORT_RECIPIENT_EMAILS is comma-separated (defaults to
    // just Poorva, for testing) — add rakesh@neotericgrp.in to the list on
    // Render once ready, no code change needed; everyone listed gets their
    // own DM with the PDF. A "meta" marker (keyed by the week's end date)
    // stops a second send if this check fires more than once inside the
    // match window.
    {
      const { buildWeeklyQcReportData, currentWeekBounds } = require("./weeklyQcReport.js");
      const { renderQcInspectionPdfBuffer } = require("./qcInspectionPdfDocument.js");
      const { sendPdfToEmail } = require("./weeklyReportSlack.js");
      const RECIPIENT_EMAILS = (process.env.WEEKLY_QC_REPORT_RECIPIENT_EMAILS || process.env.WEEKLY_QC_REPORT_RECIPIENT_EMAIL || "poorva@neotericgrp.in")
        .split(",").map((e) => e.trim()).filter(Boolean);

      async function sendWeeklyQcReport() {
        const data = await buildWeeklyQcReportData(mongoDb);
        const buffer = await renderQcInspectionPdfBuffer(data);
        const slug = data.periodLabel.replace(/[^\w]+/g, "-");
        const comment = `📋 Weekly Work Quality Inspection Report — ${data.periodLabel}\n${data.kpis.total} inspections · ${data.kpis.pass} pass · ${data.kpis.fail} fail · ${data.kpis.rework} rework · ${data.kpis.passRate}% pass rate · ${data.kpis.overdue} overdue`;
        const results = await Promise.all(RECIPIENT_EMAILS.map((email) =>
          sendPdfToEmail(email, buffer, `Quality-Inspection-Report-${slug}.pdf`, `Work Quality Inspection Report — ${data.periodLabel}`, comment)
            .then((ok) => ({ email, ok }))
        ));
        const summary = results.map((r) => `${r.email}: ${r.ok ? "sent" : "FAILED"}`).join(", ");
        await mongoDb.collection("events").insertOne({
          ts: Date.now(), userId: "", action: "WEEKLY_QC_REPORT_SENT", targetId: "", stageId: "",
          detail: `Weekly Quality Inspection report (${data.periodLabel}) — ${summary}`
        });
        return results.every((r) => r.ok);
      }

      let weeklyQcCheckInFlight = false;
      const checkWeeklyQcSchedule = () => {
        if (weeklyQcCheckInFlight) return;
        weeklyQcCheckInFlight = true;
        (async () => {
          const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
          const isSaturday = istNow.getUTCDay() === 6;
          const hour = istNow.getUTCHours();
          if (!isSaturday || hour !== 13) return; // only fires within the 13:00-13:59 IST hour, Saturday
          const { to } = currentWeekBounds();
          const markerId = "weeklyQcReportSent:" + to;
          // Atomic claim (findOneAndUpdate, not findOne-then-updateOne) —
          // the previous check-then-act version let two overlapping
          // processes (e.g. a deploy restart during the match window, or
          // horizontal scaling) both see "not sent yet" and send twice.
          // $setOnInsert so a second racer's update is a no-op that still
          // reports the pre-existing doc, which it can tell apart from a
          // genuine first claim (returns null before the write) only via
          // the upsert's own "didn't exist before" signal — MongoDB gives
          // us that by returning the PRE-update document (null = we just
          // created it = we won the race).
          // mongodb driver v6 returns the document directly (or null) here —
          // not the legacy {value, ok} wrapper — since includeResultMetadata
          // now defaults to false.
          const claim = await mongoDb.collection("meta").findOneAndUpdate(
            { _id: markerId },
            { $setOnInsert: { sentAt: Date.now() } },
            { upsert: true, returnDocument: "before" }
          );
          if (claim) return; // already existed — someone else (or an earlier tick) claimed it first
          try {
            await sendWeeklyQcReport();
          } catch (e) {
            console.error("  [weekly-qc-report] failed:", e && e.stack ? e.stack : e);
          }
        })().finally(() => { weeklyQcCheckInFlight = false; });
      };
      setInterval(checkWeeklyQcSchedule, 5 * 60 * 1000);
      checkWeeklyQcSchedule(); // in case the process starts mid-window

      // Manual test trigger — Admin only, ignores the schedule/marker, so
      // this can be verified immediately instead of waiting for Saturday.
      globalThis.__sendWeeklyQcReportNow = sendWeeklyQcReport;
    }
  })
  .catch((e) => {
    console.error("  ! failed to connect to MongoDB:", e && e.stack ? e.stack : e);
    process.exit(1);
  });

/* Pure helpers for Slack's interactive-message flow (a button click posts
 * back to our own server instead of just being a read-only notification).
 * Kept dependency-free / no Mongo here so the security-critical signature
 * check and payload parsing are unit-testable without a running server.
 *
 * Request URL on Slack's side (set under the Slack app's "Interactivity &
 * Shortcuts", a manual one-time setup step nobody but the app's owner can
 * do): POST /api/slack/actions. Verified with the app's Signing Secret
 * (SLACK_SIGNING_SECRET) — NOT the bot token, a separate value from the
 * same Slack app's "Basic Information" page.
 */
const crypto = require("crypto");

// Slack's own recommended scheme: HMAC-SHA256 of "v0:{timestamp}:{rawBody}"
// using the signing secret, compared against the X-Slack-Signature header.
// A timestamp older than 5 minutes is rejected even with a valid signature
// — Slack's own replay-protection guidance — in case a request got logged
// or replayed somewhere.
function verifySlackSignature({ signingSecret, timestamp, rawBody, signature }) {
  if (!signingSecret || !timestamp || !rawBody || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Slack posts interactive-message callbacks as a single urlencoded field,
// `payload=<JSON-encoded string>` — never JSON directly.
function parseSlackActionPayload(rawBody) {
  const params = new URLSearchParams(rawBody);
  const raw = params.get("payload");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// `action_id` is "<kind>:<entityId>" (e.g. "snag_close:SNG-0001") — one
// button, one unambiguous id, no separate lookup table to keep in sync.
function parseActionId(actionId) {
  const i = String(actionId || "").indexOf(":");
  if (i === -1) return null;
  return { kind: actionId.slice(0, i), entityId: actionId.slice(i + 1) };
}

function snagCloseBlocks(text, snagId) {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "actions", elements: [
      { type: "button", text: { type: "plain_text", text: "Close Snag" }, style: "primary", action_id: `snag_close:${snagId}`, value: snagId }
    ] }
  ];
}

function teamReportApproveBlocks(text, reportId) {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "actions", elements: [
      { type: "button", text: { type: "plain_text", text: "Approve Report" }, style: "primary", action_id: `team_report_approve:${reportId}`, value: reportId }
    ] }
  ];
}

module.exports = { verifySlackSignature, parseSlackActionPayload, parseActionId, snagCloseBlocks, teamReportApproveBlocks };

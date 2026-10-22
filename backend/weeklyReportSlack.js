/* Slack delivery for the weekly scheduled reports — looks up the recipient
 * by email (same users.lookupByEmail approach as the rest of the app),
 * opens/reuses a DM, and uploads the PDF there using Slack's modern
 * 3-step external upload flow (files.getUploadURLExternal -> PUT bytes ->
 * files.completeUploadExternal), since the old one-shot files.upload is
 * deprecated. Self-contained (doesn't import from server.js) so it has no
 * dependency on that file's internal state.
 */
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

async function slackUserIdByEmail(email) {
  if (!SLACK_BOT_TOKEN || !email) return null;
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
  const json = await res.json();
  if (!json.ok) { console.error("Slack users.lookupByEmail:", json.error, email); return null; }
  return json.user.id;
}

async function openDm(slackUserId) {
  const res = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ users: slackUserId })
  });
  const json = await res.json();
  if (!json.ok) { console.error("Slack conversations.open:", json.error); return null; }
  return json.channel.id;
}

/** Uploads `buffer` as `filename` and shares it in `channelId` with `title`/`initialComment`. */
async function uploadPdfToChannel(channelId, buffer, filename, title, initialComment) {
  const urlRes = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ filename, length: String(buffer.length) })
  });
  const urlJson = await urlRes.json();
  if (!urlJson.ok) { console.error("Slack files.getUploadURLExternal:", urlJson.error); return false; }

  const putRes = await fetch(urlJson.upload_url, { method: "POST", body: buffer });
  if (!putRes.ok) { console.error("Slack file PUT failed:", putRes.status); return false; }

  const completeRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      files: [{ id: urlJson.file_id, title }],
      channel_id: channelId,
      initial_comment: initialComment
    })
  });
  const completeJson = await completeRes.json();
  if (!completeJson.ok) { console.error("Slack files.completeUploadExternal:", completeJson.error); return false; }
  return true;
}

/** Looks up `recipientEmail` on Slack, opens a DM, and sends the PDF there. */
async function sendPdfToEmail(recipientEmail, buffer, filename, title, initialComment) {
  if (!SLACK_BOT_TOKEN) { console.log("Weekly report Slack send skipped: SLACK_BOT_TOKEN not configured"); return false; }
  const userId = await slackUserIdByEmail(recipientEmail);
  if (!userId) { console.log("Weekly report Slack send skipped: no Slack user found for", recipientEmail); return false; }
  const channelId = await openDm(userId);
  if (!channelId) return false;
  return uploadPdfToChannel(channelId, buffer, filename, title, initialComment);
}

module.exports = { sendPdfToEmail };

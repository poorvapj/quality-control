/* Maps an exception that escaped an API route to the HTTP status the client should see.

   Why this exists: every unexpected exception used to become HTTP 400. The browser treats a 4xx (other than
   401/408/425/429) as "the server examined this change and refused it" and DROPS it — so a momentary database
   problem (Atlas failover, a dropped connection, a timeout) silently threw away the user's edit.

     - a duplicate-key violation       -> 409  (a real conflict: the record or a unique value already exists)
     - a transient database/network    -> 503  (not a verdict on the change: the client keeps it and retries;
       problem                                  a retry is safe because /api/ops batches are idempotent)
     - anything else                   -> 400  (unchanged: validation-style errors thrown as plain Errors)

   Pure and dependency-free so it can be unit-tested (errorMap.test.js). */

const TRANSIENT_NAMES = new Set([
  "MongoNetworkError", "MongoNetworkTimeoutError", "MongoServerSelectionError", "MongoTopologyClosedError",
  "MongoPoolClearedError", "MongoWaitQueueTimeoutError", "MongoExpiredSessionError"
]);
// server error codes that mean "try again / the primary is changing / the server is busy"
const TRANSIENT_CODES = new Set([6, 7, 89, 91, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436]);
const NET_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED", "EAI_AGAIN"]);

function isTransientDbError(e) {
  if (!e || typeof e !== "object") return false;
  if (TRANSIENT_NAMES.has(e.name)) return true;
  if (typeof e.code === "number" && TRANSIENT_CODES.has(e.code)) return true;
  if (typeof e.code === "string" && NET_CODES.has(e.code)) return true;
  try {
    if (typeof e.hasErrorLabel === "function" && (e.hasErrorLabel("TransientTransactionError") || e.hasErrorLabel("RetryableWriteError"))) return true;
  } catch { /* label lookup must never throw */ }
  return false;
}

function isDuplicateKey(e) {
  return !!e && typeof e === "object" && e.code === 11000;
}

// Names the field(s) of a duplicate-key error WITHOUT echoing the value (it may be an e-mail address).
function duplicateKeyMessage(e) {
  const fields = e && e.keyPattern && typeof e.keyPattern === "object" ? Object.keys(e.keyPattern).filter((k) => k !== "_id") : [];
  return fields.length
    ? `A record with the same ${fields.join(" + ")} already exists — your change was not saved.`
    : "That record already exists — your change was not saved.";
}

/* -> { status, message } */
function classifyError(e) {
  if (isDuplicateKey(e)) return { status: 409, message: duplicateKeyMessage(e) };
  if (isTransientDbError(e)) return { status: 503, message: "The database is temporarily unavailable — please retry in a moment." };
  return { status: 400, message: (e && e.message) || "Request failed" };
}

module.exports = { classifyError, isTransientDbError, isDuplicateKey, duplicateKeyMessage };

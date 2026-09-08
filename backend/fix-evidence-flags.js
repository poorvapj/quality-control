#!/usr/bin/env node
/*
 * One-off fix: make every item in the Internal/Owner Possession checklists
 * (CHK-HOI, CHK-HOO) require an evidence photo. Only the first 3 items had
 * evidence:true; the rest didn't, so the "Photo required" button only
 * showed up for those 3 in PossessionForm.tsx.
 *   node backend/fix-evidence-flags.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const CHECKLIST_IDS = ["CHK-HOI", "CHK-HOO"];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);
  const coll = db.collection("checklists");

  for (const id of CHECKLIST_IDS) {
    const doc = await coll.findOne({ id });
    if (!doc) { console.log(`[${id}] not found — skipped`); continue; }

    const backupPath = path.join(__dirname, `evidence-backup-${id}-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(doc.items, null, 2));

    const before = (doc.items || []).filter((i) => i.evidence).length;
    const items = (doc.items || []).map((i) => ({ ...i, evidence: true }));
    await coll.updateOne({ id }, { $set: { items } });
    console.log(`[${id}] backed up to ${backupPath} — evidence:true was ${before}/${items.length}, now ${items.length}/${items.length}`);
  }

  await client.close();
}

main().catch((e) => {
  console.error("Fix failed:", e);
  process.exit(1);
});

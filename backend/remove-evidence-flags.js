#!/usr/bin/env node
/*
 * Reverses fix-evidence-flags.js — makes evidence photo optional again on
 * every item in the Internal/Owner Possession checklists (CHK-HOI, CHK-HOO).
 *   node backend/remove-evidence-flags.js
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

    const backupPath = path.join(__dirname, `evidence-removal-backup-${id}-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(doc.items, null, 2));

    const items = (doc.items || []).map((i) => ({ ...i, evidence: false }));
    await coll.updateOne({ id }, { $set: { items } });
    console.log(`[${id}] backed up to ${backupPath} — evidence:false on all ${items.length} items now`);
  }

  await client.close();
}

main().catch((e) => {
  console.error("Removal failed:", e);
  process.exit(1);
});

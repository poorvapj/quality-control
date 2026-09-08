#!/usr/bin/env node
/*
 * One-off migration: old 6-value Role enum (DRI/EXE/MEP/FIN/QC/MEAS) ->
 * new 3-value Role enum (CRM/CIVIL/ADMIN).
 *   DRI                      -> ADMIN
 *   EXE, MEP, FIN, QC, MEAS  -> CIVIL
 * Run once against the live Atlas cluster (same MONGODB_URI/MONGODB_DB
 * the app already uses):
 *   node backend/migrate-roles.js
 *
 * Backs up the `role` field of every affected `users`/`stages` doc to a
 * local JSON file before writing, so a mapping mistake can be reverted.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const MAP = {
  DRI: "ADMIN",
  EXE: "CIVIL", MEP: "CIVIL", FIN: "CIVIL", QC: "CIVIL", MEAS: "CIVIL"
};

async function migrateCollection(db, collName) {
  const coll = db.collection(collName);
  const docs = await coll.find({ role: { $in: Object.keys(MAP) } }, { projection: { id: 1, role: 1 } }).toArray();

  const backupPath = path.join(__dirname, `role-migration-backup-${collName}-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(docs, null, 2));
  console.log(`[${collName}] backed up ${docs.length} doc(s) to ${backupPath}`);

  let changed = 0;
  for (const d of docs) {
    const newRole = MAP[d.role];
    if (!newRole) continue;
    await coll.updateOne({ id: d.id }, { $set: { role: newRole } });
    changed++;
  }
  console.log(`[${collName}] updated ${changed} doc(s)`);
  return changed;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);

  console.log("Connected. Migrating role fields...");
  const usersChanged = await migrateCollection(db, "users");
  const stagesChanged = await migrateCollection(db, "stages");

  console.log(`\nDone. users: ${usersChanged} updated, stages: ${stagesChanged} updated.`);
  await client.close();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});

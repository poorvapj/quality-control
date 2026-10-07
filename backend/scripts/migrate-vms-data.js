require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

async function run() {
  if (!process.env.SOURCE_MONGO_URI) {
    throw new Error("SOURCE_MONGO_URI is missing from .env");
  }

  if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env");
}
  const source = new MongoClient(process.env.SOURCE_MONGO_URI);
 const target = new MongoClient(process.env.MONGODB_URI);

  try {
    await source.connect();
    await target.connect();

    // IMPORTANT: Production VBP database
    const sourceDb = source.db("vbp");

    // QC target database comes from MONGODB_DB, not the URI path (the URI
    // has no db name in it — target.db() with no argument silently
    // defaults to "test", which is empty and makes every match a false negative).
    const targetDb = target.db(process.env.MONGODB_DB);

    const dprs = await sourceDb
      .collection("dailyprogressreports")
      .find({})
      .toArray();

    const drawings = await sourceDb
      .collection("drawingrequests")
      .find({})
      .toArray();

    const qcProjects = await targetDb
      .collection("projects")
      .find({})
      .toArray();

    const qcUsers = await targetDb
      .collection("users")
      .find({})
      .toArray();

    console.log("\n========================================");
    console.log("VMS → QC MIGRATION DRY RUN");
    console.log("========================================");

    console.log("\nSOURCE DATABASE");
    console.log("Database:", sourceDb.databaseName);
    console.log("DPR:", dprs.length);
    console.log("Drawing Requests:", drawings.length);

    console.log("\nQC TARGET");
    console.log("Database:", targetDb.databaseName);
    console.log("Projects:", qcProjects.length);
    console.log("Users:", qcUsers.length);

    console.log("\n========================================");
    console.log("VMS PROJECTS");
    console.log("========================================");

    const projectNames = [
      ...new Set([
        ...dprs.map(x => x.projectName).filter(Boolean),
        ...drawings.map(x => x.projectName).filter(Boolean)
      ])
    ].sort();

    for (const name of projectNames) {
      const matches = qcProjects.filter(
        p => String(p.name || "").trim().toLowerCase() ===
             String(name).trim().toLowerCase()
      );

      if (matches.length) {
        console.log(`✓ ${name} → ${matches[0].id}`);
      } else {
        console.log(`✗ ${name} → NO QC PROJECT`);
      }
    }

    console.log("\n========================================");
    console.log("VMS DRI / USERS");
    console.log("========================================");

    const dprPeople = [
      ...new Map(
        dprs
          .filter(x => x.driName)
          .map(x => [x.driName.toLowerCase(), x.driName])
      ).values()
    ].sort();

    for (const name of dprPeople) {
      const matches = qcUsers.filter(
        u => String(u.name || "").trim().toLowerCase() ===
             String(name).trim().toLowerCase()
      );

      if (matches.length) {
        console.log(`✓ ${name} → ${matches[0].id}`);
      } else {
        console.log(`✗ ${name} → NO QC USER`);
      }
    }

    console.log("\n========================================");
    console.log("DRAWING REQUEST STATUSES");
    console.log("========================================");

    const drawingStatuses = [
      ...new Set(drawings.map(x => x.reviewStatus).filter(Boolean))
    ].sort();

    for (const status of drawingStatuses) {
      console.log(`VMS STATUS: ${status}`);
    }

    console.log("\n========================================");
    console.log("IMPORTANT");
    console.log("========================================");
    console.log("DRY RUN ONLY");
    console.log("NO DATA HAS BEEN WRITTEN TO QC.");
    console.log("========================================\n");
  } finally {
    await source.close();
    await target.close();
  }
}

run().catch(error => {
  console.error("\nDRY RUN FAILED:");
  console.error(error);
  process.exit(1);
});
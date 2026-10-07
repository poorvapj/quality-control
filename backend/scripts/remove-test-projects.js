require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const TEST_PROJECT_IDS = ["PRJ-055", "PRJ-057", "PRJ-059"];

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db("project_quality");
    const docs = await db.collection("projects").find({ id: { $in: TEST_PROJECT_IDS } }).toArray();

    if (docs.length === 0) {
      console.log("None of the target test project IDs were found — nothing to do.");
      return;
    }

    const backupPath = path.join(__dirname, "..", "..", "backup-removed-test-projects.json");
    fs.writeFileSync(backupPath, JSON.stringify(docs, null, 2));
    console.log(`Backed up ${docs.length} project(s) to ${backupPath}`);

    const result = await db.collection("projects").deleteMany({ id: { $in: TEST_PROJECT_IDS } });
    console.log(`Deleted ${result.deletedCount} project(s) from production:`, docs.map((d) => `${d.id} (${d.name})`).join(", "));
  } finally {
    await client.close();
  }
}
run().catch(console.error);

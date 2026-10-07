require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

const SOURCE_DB = "project_quality";
const TARGET_DB = "project_quality_dev";

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing from backend/.env");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const source = client.db(SOURCE_DB);
    const target = client.db(TARGET_DB);

    const existing = await target.listCollections().toArray();
    if (existing.length > 0) {
      console.log(`Target database "${TARGET_DB}" already has ${existing.length} collections — aborting to avoid overwriting. Drop it manually first if you want a fresh clone.`);
      return;
    }

    const collections = await source.listCollections().toArray();
    console.log(`Cloning ${collections.length} collections from "${SOURCE_DB}" to "${TARGET_DB}"...`);

    for (const { name } of collections) {
      const docs = await source.collection(name).find({}).toArray();
      if (docs.length > 0) {
        await target.collection(name).insertMany(docs);
      }
      console.log(`  ${name}: ${docs.length} docs`);
    }

    console.log("\nDone. Local dev DB ready:", TARGET_DB);
  } finally {
    await client.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db("project_quality");
    for (const c of ["dpr", "drawingRequests", "workTargets", "projects", "users"]) {
      console.log(c + ":", await db.collection(c).countDocuments());
    }
  } finally {
    await client.close();
  }
}
run().catch(console.error);

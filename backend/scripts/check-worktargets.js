require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const devCount = await client.db("project_quality_dev").collection("workTargets").countDocuments();
    const prodCount = await client.db("project_quality").collection("workTargets").countDocuments();
    console.log("project_quality_dev workTargets:", devCount);
    console.log("project_quality (prod) workTargets:", prodCount);
    console.log("Currently configured MONGODB_DB:", process.env.MONGODB_DB);
  } finally {
    await client.close();
  }
}
run().catch(console.error);

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db("project_quality");
    const projects = await db.collection("projects").find({}, { projection: { id: 1, name: 1, active: 1, createdAt: 1 } }).toArray();
    console.log(`${projects.length} projects in production:\n`);
    projects.forEach((p) => console.log(p.id, "|", p.name, "| active:", p.active, "| createdAt:", p.createdAt));
  } finally {
    await client.close();
  }
}
run().catch(console.error);

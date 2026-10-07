require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB);
    const users = await db.collection("users").find({}, { projection: { name: 1, email: 1, password: 1, passwordHash: 1, passwordSalt: 1, legacyPasswordHash: 1, role: 1 } }).toArray();
    console.log(`${users.length} users total\n`);
    for (const u of users) {
      const flags = [];
      if (u.password !== undefined) flags.push("HAS PLAINTEXT 'password' FIELD");
      if (u.passwordHash) flags.push("hashed(scrypt)");
      if (u.legacyPasswordHash) flags.push("legacy bcrypt");
      if (!u.passwordHash && !u.legacyPasswordHash) flags.push("NO HASH AT ALL");
      console.log(`${u.name} (${u.role}) — ${u.email} — ${flags.join(", ")}`);
    }
  } finally {
    await client.close();
  }
}
run().catch(console.error);

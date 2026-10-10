require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

async function run() {
  const src = new MongoClient(process.env.SOURCE_MONGO_URI);
  const dst = new MongoClient(process.env.MONGODB_URI);
  await src.connect();
  await dst.connect();
  try {
    const contractors = await src.db("vbp").collection("contractors").find({}).toArray();
    console.log(`Found ${contractors.length} contractors in VMS.`);

    const vendors = contractors
      .filter((c) => c.vendorCode)
      .map((c) => ({
        id: c.vendorCode,
        vendorCode: c.vendorCode,
        vendorName: c.companyName || c.ownerName || c.vendorCode,
        shortCode: c.shortCode || undefined,
        workTypes: Array.isArray(c.workTypes) ? c.workTypes.map((w) => String(w).replace(/^\d+\.\s*/, "")) : undefined,
        status: c.status === "active" ? "active" : c.status === "inactive" ? "inactive" : undefined,
        source: "VMS"
      }));

    const col = dst.db("project_quality").collection("vendors");
    const existing = await col.countDocuments();
    if (existing > 0) {
      console.log(`vendors collection already has ${existing} docs — aborting to avoid duplicating. Clear it first if you want a fresh import.`);
      return;
    }

    await col.insertMany(vendors);
    console.log(`Inserted ${vendors.length} vendors into QC.`);
  } finally {
    await src.close();
    await dst.close();
  }
}
run().catch(console.error);

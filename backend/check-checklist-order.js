require("dotenv").config();
const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const db = client.db(process.env.MONGODB_DB);
    const collection = db.collection("checklists");

    const checklists = await collection
      .find({})
      .toArray();

    for (const checklist of checklists) {
      const handoverItems = (checklist.items || []).filter(
        (item) => /^QP-H/.test(item.paramId || "")
      );

      if (!handoverItems.length) continue;

      console.log("\n======================================");
      console.log("Checklist:", checklist.id);
      console.log("Name:", checklist.name);
      console.log("======================================");

      console.table(
        handoverItems.map((item, index) => ({
          index,
          paramId: item.paramId,
          seq: item.seq,
        }))
      );
    }
  } finally {
    await client.close();
  }
})();
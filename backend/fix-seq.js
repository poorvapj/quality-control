require("dotenv").config();
const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const db = client.db(process.env.MONGODB_DB);
    const collection = db.collection("qparams");

    const ops = [];

    for (let i = 1; i <= 30; i++) {
      const id = "QP-H" + String(i).padStart(2, "0");

      ops.push({
        updateOne: {
          filter: { id: id },
          update: { $set: { seq: i } }
        }
      });
    }

    const result = await collection.bulkWrite(ops);

    console.log("Updated:", result.modifiedCount);

    const items = await collection
      .find({ id: /^QP-H/ })
      .sort({ seq: 1 })
      .toArray();

    console.table(
      items.map((item) => ({
        id: item.id,
        seq: item.seq,
        name: item.name
      }))
    );
  } finally {
    await client.close();
  }
})();
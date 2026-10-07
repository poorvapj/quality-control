require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.SOURCE_MONGO_URI);

  await client.connect();

  const db = client.db("vbp_dev");

  const dprCollection = db.collection("dailyprogressreports");
  const drawingCollection = db.collection("drawingrequests");

  // Total counts
  const dprCount = await dprCollection.countDocuments();
  const drawingCount = await drawingCollection.countDocuments();

  console.log("\n========== VMS DATA COUNT ==========");
  console.log("Daily Progress Reports:", dprCount);
  console.log("Drawing Requests:", drawingCount);

  // DPR project-wise count
  const dprProjects = await dprCollection.aggregate([
    {
      $group: {
        _id: "$projectName",
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  // Drawing Request project-wise count
  const drawingProjects = await drawingCollection.aggregate([
    {
      $group: {
        _id: "$projectName",
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  console.log("\n========== DPR BY PROJECT ==========");
  console.log(JSON.stringify(dprProjects, null, 2));

  console.log("\n========== DRAWING REQUESTS BY PROJECT ==========");
  console.log(JSON.stringify(drawingProjects, null, 2));

  await client.close();
}

run().catch(console.error);
const mongoose = require("mongoose");

const MONGO_URI =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/project_quality";

async function main() {
    await mongoose.connect(MONGO_URI);

    const db = mongoose.connection.db;
    const collection = db.collection("checklists");

    const checklist = await collection.findOne({ id: "CHK-HOI" });

    if (!checklist) {
        throw new Error("CHK-HOI checklist not found");
    }

    const items = checklist.items || [];

    const h30 = items.find((x) => x.paramId === "QP-H30");

    if (!h30) {
        throw new Error("QP-H30 not found");
    }

    // Remove ONLY QP-H30 from its current position
    const remaining = items.filter((x) => x.paramId !== "QP-H30");

    // Find QP-H29's current position
    const h29Index = remaining.findIndex(
        (x) => x.paramId === "QP-H29"
    );

    if (h29Index === -1) {
        throw new Error("QP-H29 not found");
    }

    // Put QP-H30 immediately after QP-H29
    remaining.splice(h29Index + 1, 0, h30);

    await collection.updateOne(
        { id: "CHK-HOI" },
        {
            $set: {
                items: remaining,
                updatedAt: new Date(),
            },
        }
    );

    console.log("✅ QP-H30 moved immediately after QP-H29");
    console.log(
        remaining
            .map((x, i) => `${i + 1}. ${x.paramId}: ${x.name || ""}`)
            .join("\n")
    );

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error("❌ FAILED:", err);
    try {
        await mongoose.disconnect();
    } catch { }
    process.exit(1);
});
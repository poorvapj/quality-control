require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB;

if (!MONGO_URI) {
    throw new Error("MONGODB_URI is not set");
}

async function main() {
    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();

        const db = client.db(DB_NAME);
        const collection = db.collection("checklists");

        const checklist = await collection.findOne({ id: "CHK-HOI" });

        if (!checklist) {
            throw new Error("CHK-HOI checklist not found");
        }

        const items = checklist.items || [];

        // Find H29 and H30
        const h29 = items.find((x) => x.paramId === "QP-H29");
        const h30 = items.find((x) => x.paramId === "QP-H30");

        if (!h29) {
            throw new Error("QP-H29 not found");
        }

        if (!h30) {
            throw new Error("QP-H30 not found");
        }

        console.log("Before:");
        console.log("H29 seq =", h29.seq);
        console.log("H30 seq =", h30.seq);

        /*
         * Re-number ALL HOI items according to the desired order.
         * H30 is forced immediately after H29.
         */

        // Remove H30
        const remaining = items.filter(
            (x) => x.paramId !== "QP-H30"
        );

        // Find H29 position
        const h29Index = remaining.findIndex(
            (x) => x.paramId === "QP-H29"
        );

        if (h29Index === -1) {
            throw new Error("QP-H29 not found after removing H30");
        }

        // Insert H30 immediately after H29
        remaining.splice(h29Index + 1, 0, h30);

        // IMPORTANT:
        // Re-number seq so frontend sorting also follows this order.
        const updatedItems = remaining.map((item, index) => ({
            ...item,
            seq: index + 1,
        }));

        await collection.updateOne(
            { id: "CHK-HOI" },
            {
                $set: {
                    items: updatedItems,
                    updatedAt: new Date(),
                },
            }
        );

        console.log("\nSUCCESS: CHK-HOI sequence fixed.\n");

        console.log(
            updatedItems
                .map(
                    (x, i) =>
                        `${i + 1}. ${x.paramId} | seq=${x.seq} | ${x.name || ""}`
                )
                .join("\n")
        );

        const finalH29 = updatedItems.find(
            (x) => x.paramId === "QP-H29"
        );

        const finalH30 = updatedItems.find(
            (x) => x.paramId === "QP-H30"
        );

        console.log("\nFINAL CHECK:");
        console.log("QP-H29 seq =", finalH29.seq);
        console.log("QP-H30 seq =", finalH30.seq);

        if (finalH30.seq === finalH29.seq + 1) {
            console.log(
                "\n✅ QP-H30 is now immediately after QP-H29."
            );
        } else {
            console.log(
                "\n❌ Something went wrong with the sequence."
            );
        }

    } finally {
        await client.close();
    }
}

main().catch((err) => {
    console.error("\nERROR:", err.message);
    process.exit(1);
});
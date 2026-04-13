/**
 * Step 1 of profit backfill — patch missing costPrice on order items.
 *
 * For every order item where costPrice is 0, null, or absent, look up the
 * item in the items collection and set costPrice from the catalog.
 *
 * Safe to re-run — only updates items where costPrice is still missing/0.
 * Items deleted from the catalog are skipped (left at 0 = break-even).
 *
 * Usage:
 *   node backfill-order-cost-prices.js
 *
 * Run this BEFORE backfill-profit-snapshots.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌  NEW_DB_URI not set in .env");
    process.exit(1);
}

// ── Inline models (no shared package dependency) ─────────────────────────────

const OrderModel = mongoose.model(
    "Order",
    new mongoose.Schema({ items: Array }, { collection: "orders", strict: false }),
);

const ItemModel = mongoose.model(
    "Item",
    new mongoose.Schema({ costPrice: Number }, { collection: "items", strict: false }),
);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    await mongoose.connect(MONGO_URI);
    console.log("✅  Connected to MongoDB\n");

    // 1. Find all unique itemIds that appear in orders with missing/0 costPrice
    console.log("🔍  Finding order items with missing/zero costPrice...");

    const missingCostItemIds = await OrderModel.aggregate([
        {
            $match: {
                "items.0": { $exists: true }, // has at least one item
            },
        },
        { $unwind: "$items" },
        {
            $match: {
                $or: [
                    { "items.costPrice": { $exists: false } },
                    { "items.costPrice": null },
                    { "items.costPrice": 0 },
                ],
            },
        },
        {
            $group: { _id: "$items.itemId" },
        },
    ]);

    const itemIds = missingCostItemIds
        .map((r) => r._id)
        .filter(Boolean); // remove null itemIds

    console.log(`   Found ${itemIds.length} unique item(s) with missing costPrice in orders.\n`);

    if (itemIds.length === 0) {
        console.log("✅  Nothing to patch — all order items already have costPrice.");
        await mongoose.disconnect();
        return;
    }

    // 2. Fetch current costPrice from items catalog
    const catalogItems = await ItemModel.find(
        { _id: { $in: itemIds } },
        { costPrice: 1 },
    ).lean();

    const costMap = new Map(
        catalogItems
            .filter((i) => i.costPrice && i.costPrice > 0)
            .map((i) => [i._id.toString(), i.costPrice]),
    );

    console.log(`   Catalog resolved ${costMap.size} / ${itemIds.length} item(s) with valid costPrice.`);

    const notInCatalog = itemIds.length - costMap.size;
    if (notInCatalog > 0) {
        console.log(`   ⚠️   ${notInCatalog} item(s) not found in catalog (deleted) — will remain at 0 (break-even).\n`);
    } else {
        console.log();
    }

    if (costMap.size === 0) {
        console.log("⚠️  No items with valid costPrice found in catalog. Nothing patched.");
        await mongoose.disconnect();
        return;
    }

    // 3. For each item, bulk-update all orders containing it
    let totalOrdersPatched = 0;

    for (const [itemId, costPrice] of costMap) {
        const result = await OrderModel.updateMany(
            {
                "items.itemId": new mongoose.Types.ObjectId(itemId),
                items: {
                    $elemMatch: {
                        itemId: new mongoose.Types.ObjectId(itemId),
                        $or: [
                            { costPrice: { $exists: false } },
                            { costPrice: null },
                            { costPrice: 0 },
                        ],
                    },
                },
            },
            {
                $set: { "items.$[item].costPrice": costPrice },
            },
            {
                arrayFilters: [
                    {
                        "item.itemId": new mongoose.Types.ObjectId(itemId),
                        $or: [
                            { "item.costPrice": { $exists: false } },
                            { "item.costPrice": null },
                            { "item.costPrice": 0 },
                        ],
                    },
                ],
            },
        );

        if (result.modifiedCount > 0) {
            console.log(`   ✅  itemId ${itemId} → costPrice ₹${costPrice}  (${result.modifiedCount} order(s) updated)`);
            totalOrdersPatched += result.modifiedCount;
        }
    }

    console.log(`\n🎉  Done. ${totalOrdersPatched} order document(s) patched.`);
    console.log(`\n▶️   Next: run  node backfill-profit-snapshots.js  to compute profit snapshots.\n`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("❌  Error:", err);
    process.exit(1);
});

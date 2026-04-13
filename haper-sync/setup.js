/**
 * Haper One-Shot Setup Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs three steps in order. Safe to re-run — nothing is done twice.
 *
 *   Step 1 — Seed admins & test rider   (upsert, skips if already exists)
 *   Step 2 — Backfill costPrice on orders (only patches items still at 0/null)
 *   Step 3 — Backfill profit snapshots   (upserts, recomputes any day changed)
 *
 * Usage:
 *   node setup.js
 *
 * Requires in .env:
 *   NEW_DB_URI, STORE_ID
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD
 *   STORE_ADMIN_EMAIL, STORE_ADMIN_PASSWORD
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌  NEW_DB_URI not set in .env");
    process.exit(1);
}

const STORE_ID = process.env.STORE_ID
    ? new mongoose.Types.ObjectId(process.env.STORE_ID)
    : null;

// ── Inline Models ─────────────────────────────────────────────────────────────

const OrderModel = mongoose.model(
    "Order",
    new mongoose.Schema(
        { status: Number, createdAt: Date, storeId: mongoose.Types.ObjectId, items: Array },
        { collection: "orders", versionKey: false, strict: false },
    ),
);

const ItemModel = mongoose.model(
    "Item",
    new mongoose.Schema({ costPrice: Number }, { collection: "items", strict: false }),
);

const snapshotSchema = new mongoose.Schema(
    {
        date: Date,
        storeId: mongoose.Types.ObjectId,
        profit: Number,
        revenue: Number,
        costTotal: Number,
        orderCount: Number,
        computedAt: Date,
    },
    { collection: "profit_snapshots", versionKey: false, timestamps: false },
);
snapshotSchema.index({ date: 1, storeId: 1 }, { unique: true });
const SnapshotModel = mongoose.model("ProfitSnapshot", snapshotSchema);

// ── Helpers ───────────────────────────────────────────────────────────────────

const DELIVERED = 1; // OrderConstants.orderStatus.CLOSED

const toMidnight = (d) => {
    const dt = new Date(d);
    dt.setUTCHours(0, 0, 0, 0);
    return dt;
};

const addDays = (d, n) => {
    const dt = new Date(d);
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt;
};

const fmt = (d) => d.toISOString().slice(0, 10);

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — Seed admins & test rider
// ═════════════════════════════════════════════════════════════════════════════

async function seedAdmins() {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 1 — Seed admins & test rider");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const db = mongoose.connection.db;
    const admins = db.collection("admins");
    const riders = db.collection("delivery-boys");
    const SALT = 10;

    // Super Admin
    const superPwd = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, SALT);
    const superRes = await admins.updateOne(
        { email: process.env.SUPER_ADMIN_EMAIL },
        {
            $setOnInsert: {
                email: process.env.SUPER_ADMIN_EMAIL,
                password: superPwd,
                name: "Super Admin",
                phone: "",
                roles: ["super_admin"],
                storeId: null,
                permissions: [],
                createdBy: null,
                status: 1,
                fcmTokens: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { upsert: true },
    );
    console.log(
        superRes.upsertedCount
            ? `✅  Super admin created: ${process.env.SUPER_ADMIN_EMAIL}`
            : `⏭️   Super admin already exists — skipped`,
    );

    // Store Admin
    if (!STORE_ID) {
        console.log("⚠️   STORE_ID not set — skipping store admin creation.");
    } else {
        const storePwd = await bcrypt.hash(process.env.STORE_ADMIN_PASSWORD, SALT);
        const storeRes = await admins.updateOne(
            { email: process.env.STORE_ADMIN_EMAIL },
            {
                $setOnInsert: {
                    email: process.env.STORE_ADMIN_EMAIL,
                    password: storePwd,
                    name: "Store Admin",
                    phone: "",
                    roles: ["store_admin"],
                    storeId: STORE_ID,
                    permissions: [],
                    createdBy: null,
                    status: 1,
                    fcmTokens: [],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            },
            { upsert: true },
        );
        console.log(
            storeRes.upsertedCount
                ? `✅  Store admin created: ${process.env.STORE_ADMIN_EMAIL}`
                : `⏭️   Store admin already exists — skipped`,
        );
    }

    // Test Rider
    const riderPwd = await bcrypt.hash("test@1234", SALT);
    const riderRes = await riders.updateOne(
        { email: "testrider@haper.in" },
        {
            $setOnInsert: {
                name: "Test-Rider-No-Order",
                phone: "9708647494",
                email: "testrider@haper.in",
                username: "testrider",
                password: riderPwd,
                avatar: null,
                storeId: STORE_ID,
                status: 1,
                fcmTokens: [],
                notificationPreferences: {
                    newAssignment: true,
                    incentiveCountdown: true,
                    payoutReady: true,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { upsert: true },
    );
    console.log(
        riderRes.upsertedCount
            ? `✅  Test rider created: testrider@haper.in`
            : `⏭️   Test rider already exists — skipped`,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — Backfill costPrice on order items
// ═════════════════════════════════════════════════════════════════════════════

async function backfillCostPrices() {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 2 — Backfill costPrice on order items");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Find all unique itemIds where costPrice is missing/null/0
    const missingCostItemIds = await OrderModel.aggregate([
        { $match: { "items.0": { $exists: true } } },
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
        { $group: { _id: "$items.itemId" } },
    ]);

    const itemIds = missingCostItemIds.map((r) => r._id).filter(Boolean);
    console.log(`   Found ${itemIds.length} unique item(s) with missing/zero costPrice in orders.`);

    if (itemIds.length === 0) {
        console.log("⏭️   All order items already have costPrice — skipped.");
        return;
    }

    // Fetch current costPrice from catalog
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
        console.log(`   ⚠️   ${notInCatalog} item(s) not in catalog (deleted) — left at 0 (break-even).`);
    }

    if (costMap.size === 0) {
        console.log("⚠️   No items with valid costPrice found in catalog. Nothing patched.");
        return;
    }

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
            { $set: { "items.$[item].costPrice": costPrice } },
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
            console.log(`   ✅  itemId ${itemId} → ₹${costPrice}  (${result.modifiedCount} order(s) updated)`);
            totalOrdersPatched += result.modifiedCount;
        }
    }

    console.log(`   🎉 ${totalOrdersPatched} order document(s) patched.`);
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3 — Backfill profit snapshots
// ═════════════════════════════════════════════════════════════════════════════

async function processDay(dayStart) {
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const results = await OrderModel.aggregate([
        {
            $match: {
                status: DELIVERED,
                createdAt: { $gte: dayStart, $lte: dayEnd },
            },
        },
        {
            $project: {
                storeId: 1,
                orderProfit: {
                    $sum: {
                        $map: {
                            input: { $ifNull: ["$items", []] },
                            as: "i",
                            in: {
                                $multiply: [
                                    {
                                        $subtract: [
                                            "$$i.salePrice",
                                            {
                                                $cond: {
                                                    if: { $gt: [{ $ifNull: ["$$i.costPrice", 0] }, 0] },
                                                    then: "$$i.costPrice",
                                                    else: "$$i.salePrice",
                                                },
                                            },
                                        ],
                                    },
                                    "$$i.quantity",
                                ],
                            },
                        },
                    },
                },
                orderRevenue: {
                    $sum: {
                        $map: {
                            input: { $ifNull: ["$items", []] },
                            as: "i",
                            in: { $multiply: ["$$i.salePrice", "$$i.quantity"] },
                        },
                    },
                },
                orderCost: {
                    $sum: {
                        $map: {
                            input: { $ifNull: ["$items", []] },
                            as: "i",
                            in: {
                                $multiply: [
                                    {
                                        $cond: {
                                            if: { $gt: [{ $ifNull: ["$$i.costPrice", 0] }, 0] },
                                            then: "$$i.costPrice",
                                            else: "$$i.salePrice",
                                        },
                                    },
                                    "$$i.quantity",
                                ],
                            },
                        },
                    },
                },
            },
        },
        {
            $group: {
                _id: "$storeId",
                profit: { $sum: "$orderProfit" },
                revenue: { $sum: "$orderRevenue" },
                costTotal: { $sum: "$orderCost" },
                orderCount: { $sum: 1 },
            },
        },
    ]);

    if (results.length === 0) return 0;

    const now = new Date();
    const ops = results.map((r) => ({
        updateOne: {
            filter: { date: dayStart, storeId: r._id },
            update: {
                $set: {
                    profit: r.profit,
                    revenue: r.revenue,
                    costTotal: r.costTotal,
                    orderCount: r.orderCount,
                    computedAt: now,
                },
            },
            upsert: true,
        },
    }));

    await SnapshotModel.bulkWrite(ops);
    return results.length;
}

async function backfillProfitSnapshots() {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 3 — Backfill profit snapshots");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const yesterday = toMidnight(addDays(new Date(), -1));

    // Find earliest delivered order
    const earliest = await OrderModel.findOne(
        { status: DELIVERED },
        { createdAt: 1 },
    ).sort({ createdAt: 1 });

    if (!earliest) {
        console.log("   No delivered orders found — nothing to backfill.");
        return;
    }

    const fromDate = toMidnight(earliest.createdAt);
    const toDate = yesterday;
    const totalDays = Math.round((toDate - fromDate) / 86400000) + 1;

    console.log(`   Range: ${fmt(fromDate)} → ${fmt(toDate)} (${totalDays} days)`);

    let processed = 0;
    let skipped = 0;
    let current = new Date(fromDate);

    while (current <= toDate) {
        const storesCount = await processDay(new Date(current));
        if (storesCount > 0) {
            console.log(`   ✅  ${fmt(current)} — ${storesCount} store(s)`);
            processed++;
        } else {
            skipped++;
        }
        current = addDays(current, 1);
    }

    console.log(`   🎉 Done. ${processed} day(s) written, ${skipped} day(s) skipped (no orders).`);
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
    console.log("🚀  Haper Setup — connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅  Connected.\n");

    await seedAdmins();
    await backfillCostPrices();
    await backfillProfitSnapshots();

    console.log("\n✅  All steps complete.\n");
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("❌  Error:", err);
    process.exit(1);
});

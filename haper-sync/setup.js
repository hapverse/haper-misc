/**
 * Haper One-Shot Setup Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs four steps in order. Safe to re-run — nothing is done twice.
 *
 *   Step 1 — Seed admins & test rider    (upsert, skips if already exists)
 *   Step 2 — Backfill costPrice on orders (only patches items still at 0/null)
 *   Step 3 — Backfill profit snapshots    (upserts, recomputes any day changed)
 *   Step 4 — Ensure all DB indexes        (createIndex is idempotent)
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
const { MongoClient } = require("mongodb");

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
// STEP 4 — Ensure all indexes
// ═════════════════════════════════════════════════════════════════════════════

const INDEX_DEFS = [
    { name: "addresses", indexes: [
        { key: { userId: 1 } },
        { key: { _id: 1, userId: 1 } },
        { key: { userId: 1, isDefault: 1 }, options: { partialFilterExpression: { isDefault: true } } },
        { key: { location: "2dsphere" } },
    ]},
    { name: "carts", indexes: [
        { key: { userId: 1 } },
        { key: { storeId: 1, userId: 1, type: 1 } },
    ]},
    { name: "transactions", indexes: [
        { key: { orderId: 1 }, options: { unique: true } },
        { key: { storeId: 1 } },
        { key: { userId: 1 } },
        { key: { storeId: 1, status: 1 } },
    ]},
    { name: "categories", indexes: [
        { key: { storeId: 1, status: 1, isSuggested: -1, seq: -1, createdAt: -1 } },
        { key: { storeId: 1, name: 1, status: 1 } },
    ]},
    { name: "sub-categories", indexes: [
        { key: { storeId: 1, status: 1, category: 1, isSuggested: -1, createdAt: -1 } },
        { key: { storeId: 1, name: 1, status: 1 } },
    ]},
    { name: "items", indexes: [
        { key: { important: 1 } },
        { key: { iId: 1 }, options: { unique: true } },
        { key: { barcode: 1 }, options: { unique: true, partialFilterExpression: { barcode: { $exists: true, $type: "string", $gt: "" } } } },
        { key: { status: 1 } },
        { key: { lowQty: 1 } },
        { key: { "category._id": 1, status: 1 } },
        { key: { "subCategory._id": 1, status: 1 } },
        { key: { storeId: 1 } },
        { key: { storeId: 1, status: 1 } },
        { key: { storeId: 1, "category._id": 1, status: 1 } },
        { key: { storeId: 1, "subCategory._id": 1, status: 1 } },
        { key: { storeId: 1, status: 1, important: -1, isSuggested: -1, createdAt: -1 } },
        { key: { storeId: 1, expiresAt: 1, status: 1 } },
        { key: { storeId: 1, quantity: 1, lowQty: 1, status: 1 } },
        { key: { isSuggested: 1, seq: -1 } },
    ]},
    { name: "users", indexes: [
        { key: { email: 1 }, options: { unique: true, partialFilterExpression: { email: { $exists: true, $type: "string" } } } },
        { key: { phone: 1 }, options: { unique: true, partialFilterExpression: { phone: { $exists: true, $type: "string" } } } },
        { key: { refCode: 1 }, options: { unique: true } },
        { key: { status: 1, createdAt: -1 } },
        { key: { createdAt: -1 } },
        { key: { name: 1 } },
    ]},
    { name: "configs", indexes: [
        { key: { name: 1 }, options: { unique: true } },
    ]},
    { name: "delivery-incentives", indexes: [
        { key: { orderId: 1 }, options: { unique: true } },
        { key: { storeId: 1, deliveredOn: -1 } },
        { key: { storeId: 1, deliveryBoyId: 1, deliveredOn: -1 } },
        { key: { storeId: 1, payoutMonth: 1, payoutStatus: 1 } },
        { key: { storeId: 1, deliveryBoyId: 1, payoutMonth: 1, payoutStatus: 1 } },
    ]},
    { name: "banners", indexes: [
        { key: { storeId: 1, status: 1, seq: -1, createdAt: -1 } },
        { key: { storeId: 1, seq: -1, createdAt: -1 } },
        { key: { storeId: 1, status: 1, isPermanent: 1, startDate: 1, endDate: 1 } },
        { key: { storeId: 1, updatedAt: -1 } },
    ]},
    { name: "ratings", indexes: [
        { key: { orderId: 1 }, options: { unique: true } },
        { key: { riderId: 1, createdAt: -1 } },
        { key: { storeId: 1, createdAt: -1 } },
        { key: { userId: 1 } },
    ]},
    { name: "stores", indexes: [
        { key: { location: "2dsphere" } },
    ]},
    { name: "admin-audit-logs", indexes: [
        { key: { occurredAt: -1 } },
        { key: { "actor.adminId": 1, occurredAt: -1 } },
        { key: { "target.adminId": 1, occurredAt: -1 } },
        { key: { action: 1, occurredAt: -1 } },
        { key: { storeId: 1, occurredAt: -1 } },
    ]},
    { name: "delivery-boys", indexes: [
        { key: { storeId: 1, status: 1 } },
        { key: { storeId: 1, createdAt: -1 } },
        { key: { storeId: 1, status: 1, createdAt: -1 } },
        { key: { storeId: 1, name: 1 } },
    ]},
    { name: "cash-reconciliations", indexes: [
        { key: { riderId: 1, settledOn: -1 } },
        { key: { storeId: 1, settledOn: -1 } },
    ]},
    { name: "admins", indexes: [
        { key: { storeId: 1, roles: 1 } },
    ]},
    { name: "orders", indexes: [
        { key: { userId: 1, status: 1 } },
        { key: { orderId: "text" } },
        { key: { createdAt: 1, paymentMethod: 1, price: 1 } },
        { key: { userId: 1, "meta.id": 1, "meta.type": 1 }, options: { partialFilterExpression: { "meta.id": { $exists: true }, "meta.type": { $exists: true } } } },
        { key: { status: 1, createdAt: -1 } },
        { key: { storeId: 1 } },
        { key: { storeId: 1, userId: 1, status: 1 } },
        { key: { storeId: 1, createdAt: -1 } },
        { key: { storeId: 1, status: 1, createdAt: -1 } },
        { key: { storeId: 1, assignedTo: 1, createdAt: -1 } },
        { key: { storeId: 1, paymentMethod: 1, createdAt: -1 } },
        { key: { storeId: 1, addressId: 1, createdAt: -1 } },
        { key: { storeId: 1, userId: 1, createdAt: -1 } },
        { key: { storeId: 1, status: 1, deliveredOn: -1 } },
        { key: { storeId: 1, assignedTo: 1, deliveredOn: -1 } },
        { key: { invoiceNumber: 1 }, options: { unique: true, partialFilterExpression: { invoiceNumber: { $exists: true, $type: "string" } } } },
    ]},
    { name: "profit_snapshots", indexes: [
        { key: { date: 1, storeId: 1 }, options: { unique: true } },
        { key: { storeId: 1, date: -1 } },
        { key: { date: -1 } },
    ]},
];

async function ensureIndexes() {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 4 — Ensure all DB indexes");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const { name, indexes } of INDEX_DEFS) {
        const col = db.collection(name);
        for (const { key, options = {} } of indexes) {
            try {
                await col.createIndex(key, { background: true, ...options });
                created++;
            } catch (err) {
                if (err.code === 85 || err.code === 86) {
                    skipped++;
                } else {
                    console.error(`   ❌  ${name} ${JSON.stringify(key)}: ${err.message}`);
                    errors++;
                }
            }
        }
        console.log(`   ✅  ${name}`);
    }

    await client.close();
    console.log(`   Created/confirmed: ${created}  |  Already existed: ${skipped}  |  Errors: ${errors}`);
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
    await ensureIndexes();

    console.log("\n✅  All steps complete.\n");
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("❌  Error:", err);
    process.exit(1);
});

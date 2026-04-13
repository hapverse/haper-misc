/**
 * ensure-indexes.js
 *
 * Creates (or confirms) every MongoDB index used by the Haper backend on the
 * target database. Safe to re-run — createIndex is idempotent; existing indexes
 * are left untouched.
 *
 * Usage:
 *   node ensure-indexes.js
 *
 * Requires NEW_DB_URI in .env
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌  NEW_DB_URI not set in .env");
    process.exit(1);
}

// ── Index definitions ─────────────────────────────────────────────────────────
// Format: { collection, indexes: [ { key, options? } ] }
const COLLECTIONS = [
    {
        name: "addresses",
        indexes: [
            { key: { userId: 1 } },
            { key: { _id: 1, userId: 1 } },
            { key: { userId: 1, isDefault: 1 }, options: { partialFilterExpression: { isDefault: true } } },
            { key: { location: "2dsphere" } },
        ],
    },
    {
        name: "carts",
        indexes: [
            { key: { userId: 1 } },
            { key: { storeId: 1, userId: 1, type: 1 } },
        ],
    },
    {
        name: "transactions",
        indexes: [
            { key: { orderId: 1 }, options: { unique: true } },
            { key: { storeId: 1 } },
            { key: { userId: 1 } },
            { key: { storeId: 1, status: 1 } },
        ],
    },
    {
        name: "categories",
        indexes: [
            { key: { storeId: 1, status: 1, isSuggested: -1, seq: -1, createdAt: -1 } },
            { key: { storeId: 1, name: 1, status: 1 } },
        ],
    },
    {
        name: "sub-categories",
        indexes: [
            { key: { storeId: 1, status: 1, category: 1, isSuggested: -1, createdAt: -1 } },
            { key: { storeId: 1, name: 1, status: 1 } },
        ],
    },
    {
        name: "items",
        indexes: [
            { key: { important: 1 } },
            { key: { iId: 1 }, options: { unique: true } },
            {
                key: { barcode: 1 },
                options: {
                    unique: true,
                    sparse: true,
                    partialFilterExpression: { barcode: { $exists: true, $type: "string", $gt: "" } },
                },
            },
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
        ],
    },
    {
        name: "users",
        indexes: [
            { key: { email: 1 }, options: { unique: true, partialFilterExpression: { email: { $ne: null } } } },
            { key: { phone: 1 }, options: { unique: true, partialFilterExpression: { phone: { $ne: null } } } },
            { key: { refCode: 1 }, options: { unique: true } },
            { key: { status: 1, createdAt: -1 } },
            { key: { createdAt: -1 } },
            { key: { name: 1 } },
        ],
    },
    {
        name: "configs",
        indexes: [
            { key: { name: 1 }, options: { unique: true } },
        ],
    },
    {
        name: "delivery-incentives",
        indexes: [
            { key: { orderId: 1 }, options: { unique: true } },
            { key: { storeId: 1, deliveredOn: -1 } },
            { key: { storeId: 1, deliveryBoyId: 1, deliveredOn: -1 } },
            { key: { storeId: 1, payoutMonth: 1, payoutStatus: 1 } },
            { key: { storeId: 1, deliveryBoyId: 1, payoutMonth: 1, payoutStatus: 1 } },
        ],
    },
    {
        name: "banners",
        indexes: [
            { key: { storeId: 1, status: 1, seq: -1, createdAt: -1 } },
            { key: { storeId: 1, seq: -1, createdAt: -1 } },
            { key: { storeId: 1, status: 1, isPermanent: 1, startDate: 1, endDate: 1 } },
            { key: { storeId: 1, updatedAt: -1 } },
        ],
    },
    {
        name: "ratings",
        indexes: [
            { key: { orderId: 1 }, options: { unique: true } },
            { key: { riderId: 1, createdAt: -1 } },
            { key: { storeId: 1, createdAt: -1 } },
            { key: { userId: 1 } },
        ],
    },
    {
        name: "stores",
        indexes: [
            { key: { location: "2dsphere" } },
        ],
    },
    {
        name: "admin-audit-logs",
        indexes: [
            { key: { occurredAt: -1 } },
            { key: { "actor.adminId": 1, occurredAt: -1 } },
            { key: { "target.adminId": 1, occurredAt: -1 } },
            { key: { action: 1, occurredAt: -1 } },
            { key: { storeId: 1, occurredAt: -1 } },
        ],
    },
    {
        name: "delivery-boys",
        indexes: [
            { key: { storeId: 1, status: 1 } },
            { key: { storeId: 1, createdAt: -1 } },
            { key: { storeId: 1, status: 1, createdAt: -1 } },
            { key: { storeId: 1, name: 1 } },
        ],
    },
    {
        name: "cash-reconciliations",
        indexes: [
            { key: { riderId: 1, settledOn: -1 } },
            { key: { storeId: 1, settledOn: -1 } },
        ],
    },
    {
        name: "admins",
        indexes: [
            { key: { storeId: 1, roles: 1 } },
        ],
    },
    {
        name: "orders",
        indexes: [
            { key: { userId: 1, status: 1 } },
            { key: { orderId: "text" } },
            { key: { createdAt: 1, paymentMethod: 1, price: 1 } },
            {
                key: { userId: 1, "meta.id": 1, "meta.type": 1 },
                options: { partialFilterExpression: { "meta.id": { $exists: true }, "meta.type": { $exists: true } } },
            },
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
            { key: { invoiceNumber: 1 }, options: { unique: true, sparse: true } },
        ],
    },
    {
        name: "profit_snapshots",
        indexes: [
            { key: { date: 1, storeId: 1 }, options: { unique: true } },
            { key: { storeId: 1, date: -1 } },
            { key: { date: -1 } },
        ],
    },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();
    console.log("✅  Connected to MongoDB\n");

    let totalCreated = 0;
    let totalAlready = 0;
    let totalErrors = 0;

    for (const { name, indexes } of COLLECTIONS) {
        console.log(`📦  ${name} (${indexes.length} index${indexes.length === 1 ? '' : 'es'})`);
        const col = db.collection(name);

        for (const { key, options = {} } of indexes) {
            const keyStr = JSON.stringify(key);
            try {
                await col.createIndex(key, { background: true, ...options });
                console.log(`   ✅  ${keyStr}`);
                totalCreated++;
            } catch (err) {
                // Code 85 = index already exists with different options
                // Code 86 = index already exists with same key, different name
                // Code 11000 = unique violation (shouldn't happen on createIndex)
                if (err.code === 85 || err.code === 86) {
                    console.log(`   ⏭️   ${keyStr}  (already exists)`);
                    totalAlready++;
                } else {
                    console.error(`   ❌  ${keyStr}  — ${err.message}`);
                    totalErrors++;
                }
            }
        }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅  Created/confirmed: ${totalCreated}`);
    if (totalAlready > 0) console.log(`⏭️   Already existed:   ${totalAlready}`);
    if (totalErrors > 0)  console.log(`❌  Errors:             ${totalErrors}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    await client.close();
}

main().catch((err) => {
    console.error("❌  Error:", err);
    process.exit(1);
});

/**
 * migrate-item-indexes.js
 *
 * One-time migration: make items.iId and items.barcode unique PER STORE instead
 * of globally, so the same product can carry the same iId/barcode across stores
 * (needed for cloning a store's catalog into a new store).
 *
 * Drops the old global indexes (iId_1, barcode_1) and creates the compound ones
 * ({ storeId, iId } unique, { storeId, barcode } partial-unique).
 *
 * Idempotent + safe to re-run: missing old indexes are ignored, createIndex is
 * idempotent. Run BEFORE deploying the store-clone feature to prod.
 *
 * Usage:  node migrate-item-indexes.js
 * Requires NEW_DB_URI in .env (same as ensure-indexes.js).
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌  NEW_DB_URI not set in .env");
    process.exit(1);
}

const dropIfExists = async (col, name) => {
    try {
        await col.dropIndex(name);
        console.log(`  ✓ dropped old index ${name}`);
    } catch (err) {
        // 27 = IndexNotFound — already gone, fine.
        if (err.code === 27 || /index not found/i.test(err.message)) {
            console.log(`  – ${name} not present (skip)`);
        } else {
            throw err;
        }
    }
};

(async () => {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const col = client.db().collection("items");
        console.log("Migrating items iId/barcode → per-store unique…");

        // 1. Drop the old GLOBAL unique indexes.
        await dropIfExists(col, "iId_1");
        await dropIfExists(col, "barcode_1");

        // 2. Create the new PER-STORE unique indexes.
        await col.createIndex({ storeId: 1, iId: 1 }, { unique: true, background: true });
        console.log("  ✓ created { storeId, iId } unique");
        await col.createIndex(
            { storeId: 1, barcode: 1 },
            {
                unique: true,
                background: true,
                partialFilterExpression: { barcode: { $exists: true, $type: "string", $gt: "" } },
            },
        );
        console.log("  ✓ created { storeId, barcode } partial-unique");

        console.log("✅  Done.");
    } catch (err) {
        console.error("❌  Migration failed:", err.message);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
})();

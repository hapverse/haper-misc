/**
 * migrate-item-indexes-category-meta.js
 *
 * One-time migration: add a covering index for the customer home-category
 * enrichment aggregation (itemsCount / cheapestPrice / subCategoriesCount on
 * GET /user/home/category). That aggregation does
 *   { $match: { storeId, status: ACTIVE } } -> { $group: on category/subCategory }
 * which without this index only partially uses existing indexes and would
 * FETCH ~1800 docs/store instead of being answered straight from the index.
 * This screen is hit on every app-open.
 *
 * Creates { storeId: 1, status: 1, "category._id": 1, "subCategory._id": 1, sellingPrice: 1, quantity: 1 }
 * (name: idx_items_store_status_cat_subcat_cover). sellingPrice AND quantity are
 * included so the aggregation's $min/$sum accumulators (itemsCount/cheapestPrice
 * are stock-aware, gated on quantity > 0) are answered from the index too (fully
 * covered, 0 documents fetched) instead of falling back to an IXSCAN+FETCH per
 * document — re-verified via explain("executionStats") on mongodb-memory-server;
 * dropping quantity from the key brings back a full FETCH of every matched doc.
 * Idempotent + safe to re-run: if an older version of this index (without
 * quantity) already exists under the same name, it's dropped and recreated —
 * createIndex() errors instead of upgrading in place when the key differs.
 *
 * Usage:  node migrate-item-indexes-category-meta.js
 * Requires NEW_DB_URI in .env (same as ensure-indexes.js).
 *
 * Rollback:
 *   db.collection("items").dropIndex("idx_items_store_status_cat_subcat_cover")
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌  NEW_DB_URI not set in .env");
    process.exit(1);
}

(async () => {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const col = client.db().collection("items");
        console.log("Creating covering index for home-category enrichment…");

        // If an older version of this index (pre-quantity) already exists under
        // the same name, createIndex() with a different key errors instead of
        // upgrading in place — drop it first so this stays safe to re-run.
        const existing = await col.indexes();
        const stale = existing.find((idx) => idx.name === "idx_items_store_status_cat_subcat_cover");
        if (stale && !("quantity" in stale.key)) {
            console.log("  … dropping stale idx_items_store_status_cat_subcat_cover (missing quantity)");
            await col.dropIndex("idx_items_store_status_cat_subcat_cover");
        }

        await col.createIndex(
            { storeId: 1, status: 1, "category._id": 1, "subCategory._id": 1, sellingPrice: 1, quantity: 1 },
            { name: "idx_items_store_status_cat_subcat_cover", background: true }
        );
        console.log("  ✓ created idx_items_store_status_cat_subcat_cover");

        console.log("✅  Done.");
    } catch (err) {
        console.error("❌  Migration failed:", err.message);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
})();

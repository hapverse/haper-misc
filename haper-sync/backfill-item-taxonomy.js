/**
 * backfill-item-taxonomy.js
 *
 * One-time backfill for the multi-category feature (multi-category-items plan,
 * Phase 1): every `items` / `products` row that HAS a category but no
 * `taxonomy` pairs gets `taxonomy = [{ categoryId, categoryName,
 * subCategoryId, subCategoryName }]` derived from its existing singular
 * `category` / `subCategory` snapshot.
 *
 * This is what makes the plan's §3.0 GO gate pass ("every item with a category
 * has a non-empty taxonomy") — Phase 3 queries `taxonomy` with NO $or fallback
 * to the singular fields, so a row missed here would silently vanish from
 * browse. Phase 1 already keeps every live write path in sync; this only
 * catches rows written BEFORE that shipped.
 *
 * The derivation is not reimplemented here: it calls the same
 * `normaliseTaxonomy` the application write paths use
 * (haper-backend/packages/shared/utils/taxonomy.utils.js), so the two can never
 * drift.
 *
 * Idempotent + resumable: the candidate filter only matches rows whose taxonomy
 * is absent or empty, so a completed row is never re-selected. The singular
 * fields are NEVER written — this script only ADDS `taxonomy`.
 *
 * Usage:
 *   node backfill-item-taxonomy.js              # DRY RUN — report only (default)
 *   node backfill-item-taxonomy.js --apply      # write
 *
 * Requires NEW_DB_URI in .env (same as ensure-indexes.js). Aborts outright if
 * the target looks like production — prod runs go through the user, never here.
 *
 * Rollback:
 *   db.items.updateMany({}, { $unset: { taxonomy: "" } })
 *   db.products.updateMany({}, { $unset: { taxonomy: "" } })
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

let normaliseTaxonomy;
try {
    // Sibling checkout: /haper/haper-misc/haper-sync -> /haper/haper-backend.
    ({ normaliseTaxonomy } = require("../../haper-backend/packages/shared/utils/taxonomy.utils"));
} catch (err) {
    console.error("❌  Could not load taxonomy.utils from the haper-backend checkout.");
    console.error("    Expected ../../haper-backend/packages/shared/utils/taxonomy.utils.js");
    console.error("   ", err.message);
    process.exit(1);
}

const APPLY = process.argv.includes("--apply");

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌  NEW_DB_URI not set in .env");
    process.exit(1);
}

// Rows with a category but no pairs yet. `$exists:false` OR `$size:0` — the
// same predicate as the plan's GO-gate count, so "script finds 0" and "gate
// passes" mean exactly the same thing.
const CANDIDATE_FILTER = {
    "category._id": { $ne: null },
    $or: [{ taxonomy: { $exists: false } }, { taxonomy: { $size: 0 } }],
};

const backfillCollection = async (db, name) => {
    const col = db.collection(name);
    const total = await col.countDocuments({});
    const candidates = await col
        .find(CANDIDATE_FILTER, { projection: { _id: 1, category: 1, subCategory: 1 } })
        .toArray();

    console.log(`\n[${name}] rows: ${total}; missing taxonomy (with a category): ${candidates.length}`);
    if (candidates.length === 0) return { scanned: total, candidates: 0, written: 0, skipped: 0 };

    const ops = [];
    let skipped = 0;
    for (const doc of candidates) {
        const { taxonomy } = normaliseTaxonomy({
            taxonomy: [],
            category: doc.category,
            subCategory: doc.subCategory,
        });
        if (taxonomy.length === 0) {
            // Shouldn't happen (the filter requires a category._id) — a row whose
            // category is malformed is REPORTED and left alone rather than
            // written with an empty array that would look backfilled.
            skipped += 1;
            continue;
        }
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { taxonomy } } } });
    }

    if (skipped) console.log(`[${name}] ⚠️  ${skipped} row(s) with an unusable category — left untouched`);

    const sample = candidates[0];
    if (sample) {
        console.log(
            `[${name}] e.g. ${sample._id}: category "${sample.category?.name ?? ""}" / ` +
                `sub "${sample.subCategory?.name ?? ""}" → 1 pair`,
        );
    }

    if (!APPLY) {
        console.log(`[${name}] DRY RUN — would write ${ops.length} row(s)`);
        return { scanned: total, candidates: candidates.length, written: 0, skipped };
    }

    let written = 0;
    // Chunked so one enormous bulkWrite can't blow the 100k-op / 16MB limits.
    for (let i = 0; i < ops.length; i += 1000) {
        const res = await col.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
        written += res.modifiedCount || 0;
    }
    console.log(`[${name}] ✓ wrote ${written} row(s)`);
    return { scanned: total, candidates: candidates.length, written, skipped };
};

(async () => {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db();
        const host = client.options?.hosts?.map((h) => h.host).join(",") || "";

        console.log(`\nDB NAME : ${db.databaseName}`);
        console.log(`DB HOST : ${host}`);
        console.log(`MODE    : ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);

        // Hard stop, not a warning: production data changes go through the
        // deployed app / the user, never through a local script run.
        if (/prod/i.test(db.databaseName) || /prod/i.test(host)) {
            console.error("\n❌  ABORT — this target looks like PRODUCTION. Point NEW_DB_URI at dev.");
            process.exitCode = 2;
            return;
        }

        const items = await backfillCollection(db, "items");
        const products = await backfillCollection(db, "products");

        console.log("");
        console.log(`items    : ${items.candidates} candidate(s), ${items.written} written`);
        console.log(`products : ${products.candidates} candidate(s), ${products.written} written`);
        if (!APPLY) console.log("\nDRY RUN — re-run with --apply to write.");
        console.log("✅  Done.\n");
    } catch (err) {
        console.error("❌  Backfill failed:", err.message);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
})();

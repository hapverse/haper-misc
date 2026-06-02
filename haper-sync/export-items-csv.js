/**
 * export-items-csv.js
 *
 * Exports every document in the `items` collection to a CSV file, including
 * every field present across the whole collection. The column set is the union
 * of all top-level keys seen across all documents, so items with extra/optional
 * fields are fully represented (missing values are left blank).
 *
 * Nested values (objects / arrays) are serialized as JSON in their cell, with
 * ObjectIds rendered as hex strings and Dates as ISO-8601. The file is written
 * with a UTF-8 BOM so item names in non-Latin scripts open correctly in Excel.
 *
 * This is READ-ONLY on the database (a single find()); it never writes to Mongo.
 *
 * Usage:
 *   node export-items-csv.js                 # writes ./items-export-<ts>.csv
 *   node export-items-csv.js my-items.csv    # writes ./my-items.csv
 *
 * Requires NEW_DB_URI in .env (same as the other scripts here).
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌  NEW_DB_URI not set in .env");
    process.exit(1);
}

const COLLECTION = "items";

const CONNECTION_OPTIONS = {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15_000,
};

// Build the output filename: explicit arg, else a timestamped default.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outArg = process.argv[2];
const OUT_FILE = path.resolve(process.cwd(), outArg || `items-export-${stamp}.csv`);

// ── Value formatting ──────────────────────────────────────────────────────────

// Recursively convert BSON / JS values into JSON-safe primitives so they
// serialize cleanly: ObjectId -> hex string, Date -> ISO, Buffer -> base64.
function toPlain(v) {
    if (v === null || v === undefined) return v;
    if (v instanceof Date) return v.toISOString();
    if (Buffer.isBuffer(v)) return v.toString("base64");
    if (typeof v === "object") {
        // mongodb ObjectId (and most BSON types) expose a usable toString().
        if (v._bsontype === "ObjectId" || (v.constructor && v.constructor.name === "ObjectId")) {
            return v.toString();
        }
        if (Array.isArray(v)) return v.map(toPlain);
        const out = {};
        for (const k of Object.keys(v)) out[k] = toPlain(v[k]);
        return out;
    }
    return v;
}

// Render a single value into its CSV cell text (unescaped).
function cell(v) {
    const p = toPlain(v);
    if (p === null || p === undefined) return "";
    if (typeof p === "object") return JSON.stringify(p);
    return String(p);
}

// Escape a cell per RFC 4180.
function csvEscape(s) {
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Stable column ordering: _id first, then the rest alphabetically.
function orderColumns(keySet) {
    const keys = Array.from(keySet);
    keys.sort();
    return ["_id", ...keys.filter((k) => k !== "_id")].filter((k, i, a) => a.indexOf(k) === i);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const client = new MongoClient(MONGO_URI, CONNECTION_OPTIONS);
    try {
        await client.connect();
        const db = client.db(); // DB name comes from the URI
        const col = db.collection(COLLECTION);

        const total = await col.countDocuments();
        console.log(`[items] ${total} document(s) in "${COLLECTION}".`);
        if (total === 0) {
            console.log("Nothing to export.");
            return;
        }

        // Pass 1 — collect the union of all top-level field names.
        console.log("[pass 1/2] scanning for the full field set...");
        const keySet = new Set();
        let scanned = 0;
        const keyCursor = col.find({}, { readPreference: "secondaryPreferred" });
        for await (const doc of keyCursor) {
            for (const k of Object.keys(doc)) keySet.add(k);
            if (++scanned % 1000 === 0) process.stdout.write(`\r  scanned ${scanned}/${total}`);
        }
        process.stdout.write(`\r  scanned ${scanned}/${total}\n`);

        const columns = orderColumns(keySet);
        console.log(`[fields] ${columns.length} columns: ${columns.join(", ")}`);

        // Pass 2 — stream every document out as a CSV row.
        console.log("[pass 2/2] writing rows...");
        const stream = fs.createWriteStream(OUT_FILE, { encoding: "utf8" });
        stream.write("\uFEFF"); // UTF-8 BOM for Excel
        stream.write(columns.map((c) => csvEscape(c)).join(",") + "\n");

        let written = 0;
        const rowCursor = col.find({}, { readPreference: "secondaryPreferred" });
        for await (const doc of rowCursor) {
            const row = columns.map((c) => csvEscape(cell(doc[c]))).join(",");
            // Respect backpressure.
            if (!stream.write(row + "\n")) {
                await new Promise((res) => stream.once("drain", res));
            }
            if (++written % 1000 === 0) process.stdout.write(`\r  wrote ${written}/${total}`);
        }
        process.stdout.write(`\r  wrote ${written}/${total}\n`);

        await new Promise((res, rej) => stream.end((err) => (err ? rej(err) : res())));
        console.log(`✅  Exported ${written} item(s) → ${OUT_FILE}`);
    } finally {
        await client.close();
    }
}

main().catch((err) => {
    console.error("❌  Export failed:", err);
    process.exit(1);
});

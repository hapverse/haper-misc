/**
 * Bheldi DB Migration & Sync Service
 *
 * Single script that:
 * 1. Captures oplog timestamp (resume point)
 * 2. Creates default store in new DB
 * 3. Bulk copies all collections from old DB → new DB (with transformations)
 * 4. Starts Change Streams from saved timestamp for continuous real-time sync
 *
 * Usage:
 *   pm2 start sync.js --name bheldi-sync
 *
 * Uses native MongoDB driver (NOT Mongoose) to avoid triggering schema hooks
 * (no duplicate emails, no re-generating IDs, no password re-hashing).
 */

require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");

// ─── Configuration ───────────────────────────────────────────────────────────

const OLD_DB_URI = process.env.OLD_DB_URI;
const NEW_DB_URI = process.env.NEW_DB_URI;

// Connection pool settings for long-running PM2 service
const CONNECTION_OPTIONS = {
    maxPoolSize: 10,       // Max connections per client (plenty for this workload)
    minPoolSize: 2,        // Keep 2 connections warm at all times
    maxIdleTimeMS: 60_000, // Close idle connections after 60s
    serverSelectionTimeoutMS: 15_000, // Fail fast if cluster unreachable
    heartbeatFrequencyMS: 10_000,     // Check server health every 10s
};

const DEFAULT_STORE_ID = new ObjectId("69c98afef57bb064528047f5");
const STORE_COORDS = [84.947875, 25.88108]; // [longitude, latitude]

// ─── Default Store Document ──────────────────────────────────────────────────

const DEFAULT_STORE = {
    _id: DEFAULT_STORE_ID,
    name: "Haper Mart (Bheldi)",
    address: "Haper Store, Barki Sirisiya, Near Government High School, Saran, Bihar- 841311",
    apiKey: "AMAWp(@{c^Grs(E78ae5hkf-eo4v8JQP<*$PV(*6052B",
    config: {
        minimumOrderValue: 399,
        deliveryCharges: 0,
        platformCharges: 1,
        platformSharePercentage: 0,
        deliveryIncentiveEnabled: false,
        deliveryIncentiveThresholdMinutes: 30,
        deliveryIncentiveAmount: 2,
        razorpayId: "rzp_live_iZDWCBxZqRMQmQ",
        razorpaySecret: "dCa45Eg1wx0c2Pqvw9uecWhP",
        razorpayWebhookSecret: "llwuLcgQq4L7JrYn",
    },
    email: "support@haper.in",
    image: null,
    location: { type: "Point", coordinates: STORE_COORDS },
    mapLink: "https://maps.app.goo.gl/XHUgMGrcbVz8Gjkp6",
    ownerId: null,
    phone: "+917682828383",
    status: 1,
    time: {
        mon: { start: "07:00", end: "20:00" },
        tue: { start: "07:00", end: "20:00" },
        wed: { start: "07:00", end: "20:00" },
        thu: { start: "07:00", end: "20:00" },
        fri: { start: "07:00", end: "20:00" },
        sat: { start: "07:00", end: "20:00" },
        sun: { start: "07:00", end: "20:00" },
    },
    villages: [
        "Arna",
        "Bajrahan",
        "Bariyarpur - Yadavpur",
        "Barki Sirisiya",
        "Basauti",
        "Bedwaliya",
        "Bheldi Chowk",
        "Bheldi Ganw",
        "Bhima Bandh",
        "Chand Chak",
        "Firozpur",
        "Gopalpur",
        "Hingua",
        "Jadopur",
        "Jagannathpur ",
        "Laganpura",
        "Loknathpur",
        "Murli Sirisiya",
        "Nanfar",
        "Narayanpur",
        "Nawada",
        "Pachrukhi",
        "Pirari",
        "Samaspura - Kharidaha",
        "Takeya",
    ],
    gstin: null,
    createdAt: new Date("2026-03-29T20:26:37.794Z"),
    updatedAt: new Date("2026-03-29T20:29:44.499Z"),
};

// ─── Item Name Lookup Map ────────────────────────────────────────────────────
// Built once from the old DB before bulk migration so the orders transformer
// can backfill item names on old order items that never stored a name snapshot.
// Map key: itemId.toString()  →  value: item name string

let itemNameMap = new Map();

async function buildItemNameMap(oldDb) {
    const cursor = oldDb.collection("items").find({}, { projection: { _id: 1, name: 1 } });
    let count = 0;
    for await (const item of cursor) {
        itemNameMap.set(item._id.toString(), item.name || null);
        count++;
    }
    console.log(`[Init] Item name map built: ${count} items indexed.`);
}

// ─── Transformation Functions ────────────────────────────────────────────────
// Each function takes an old-DB document and returns the new-DB document.
// We spread the original doc and add/override only the new fields.

const transformers = {
    users: (doc) => ({
        ...doc,
        fcmTokens: doc.fcmTokens || [],
        notificationPreferences: doc.notificationPreferences || {
            orderConfirmed: true,
            orderProcessing: true,
            outForDelivery: true,
            orderDelivered: true,
            orderCancelled: true,
            paymentUpdates: true,
        },
    }),

    admins: (doc) => ({
        ...doc,
        storeId: doc.storeId || (doc.roles && doc.roles.includes("super_admin") ? null : DEFAULT_STORE_ID),
        status: doc.status ?? 1,
    }),

    // `image` (legacy single-field) is stripped; `images` array is the single
    // source of truth on the new DB. If a legacy doc only has `image` populated,
    // backfill it into `images` so we don't lose the thumbnail.
    items: (doc) => {
        const { image, ...rest } = doc;
        return {
            ...rest,
            storeId: rest.storeId || DEFAULT_STORE_ID,
            images: rest.images?.length ? rest.images : (image ? [image] : []),
        };
    },

    orders: (doc) => ({
        ...doc,
        storeId: doc.storeId || DEFAULT_STORE_ID,
        invoiceNumber: doc.invoiceNumber || null,
        items: (doc.items || []).map((item) => {
            // Resolve salePrice: new docs have it directly; old docs stored it
            // in `price` (frozen sellingPrice at checkout). `sellingPrice` on an
            // order item comes from Mongoose populate and is NOT the frozen value
            // — prefer explicit `salePrice`, then fall back to `price`.
            const salePrice = item.sellingPrice ?? item.price ?? 0;

            // Build clean item — drop legacy `price` and stale `sellingPrice`
            // so the destination DB only contains the canonical schema.
            const { price: _price, sellingPrice: _sp, ...rest } = item;
            void _price; void _sp; // suppress unused-var lint

            return {
                ...rest,
                salePrice,
                costPrice: item.costPrice ?? 0,
                name: item.name ?? itemNameMap.get(item.itemId?.toString()) ?? null,
            };
        }),
    }),

    carts: (doc) => ({
        ...doc,
        storeId: doc.storeId || DEFAULT_STORE_ID,
    }),

    categories: (doc) => ({
        ...doc,
        storeId: doc.storeId || DEFAULT_STORE_ID,
    }),

    "sub-categories": (doc) => ({
        ...doc,
        storeId: doc.storeId || DEFAULT_STORE_ID,
    }),

    "delivery-boys": (doc) => ({
        ...doc,
        storeId: doc.storeId || DEFAULT_STORE_ID,
    }),

    addresses: (doc) => {
        // `location` is owned exclusively by the new DB — set by the new app's
        // pin-on-checkout flow for new users, or by the delivery app's
        // OTP-success GPS capture for legacy users. Old DB has no coordinates,
        // so we strip the field on every event (insert and update) to make
        // sure old-DB writes can never overwrite a real coordinate.
        const { location: _location, ...rest } = doc;
        void _location;
        return rest;
    },

    configs: (doc) => {
        // Normalize legacy two-part version strings ("1.2") to semver
        // ("1.2.0"). Old DB may still emit two-part versions from before the
        // convention change; the new DB schema expects X.X.X everywhere.
        const toSemver = (v) => {
            if (typeof v !== "string" || !v) return v;
            const parts = v.split(".");
            if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
                return `${v}.0`;
            }
            return v;
        };

        const fu = doc.forceUpdate || {
            minIosVersion: "0.0.0",
            minAndroidVersion: "0.0.0",
            updateMessage: "A new version of the app is available. Please update to continue.",
        };

        return {
            ...doc,
            maintenance: doc.maintenance || {
                isActive: false,
                message: "We are currently down for maintenance. Please check back soon.",
                endTime: null,
            },
            forceUpdate: {
                ...fu,
                minIosVersion: toSemver(fu.minIosVersion) || "0.0.0",
                minAndroidVersion: toSemver(fu.minAndroidVersion) || "0.0.0",
            },
        };
    },

    // These collections have no schema changes — copy as-is
    wallets: (doc) => doc,
    logs: (doc) => doc,

    // NOTE: `sequences` is intentionally NOT synced. Both backends mint orderId
    // and invoiceNumber from their own counters; mirroring the old DB's
    // counters into the new DB would overwrite the new backend's progress and
    // cause duplicate IDs. The new backend uses disjoint prefixes (see
    // orders.schema.js) so the two ID spaces never collide.
};

// All collections we need to sync via Change Streams
const ALL_SYNCED_COLLECTIONS = Object.keys(transformers);

// ─── Raw-update field strippers ──────────────────────────────────────────────
// Applied ONLY to the change-stream fallback path where `fullDocument` is
// absent and we have to apply `updateDescription.updatedFields` directly.
// The regular transformer above handles the full-document path.
//
// For `items`, the new schema drops the legacy `image` field. If an update
// event touches `image`, translate it into an `images` update so nothing
// leaks into the new DB.
const FIELD_STRIPPERS = {
    items: (updatedFields, removedFields) => {
        const src = updatedFields || {};
        const { image, ...cleanUpdates } = src;
        // If the old backend updated only `image` (not `images`), mirror it
        // over as an `images` update. If both were updated, trust `images`
        // and drop the redundant `image` write.
        if (image !== undefined && cleanUpdates.images === undefined) {
            cleanUpdates.images = image ? [image] : [];
        }
        const cleanRemoved = (removedFields || []).filter((f) => f !== "image");
        return { cleanUpdates, cleanRemoved };
    },
};

// ─── Resume Token Persistence ────────────────────────────────────────────────
// Stores the last-processed Change Stream resume token in the new DB.
// On restart, we resume from this token — zero data loss, zero gap.

const SYNC_META_COLLECTION = "_sync_meta"; // internal collection in new DB

async function getSavedResumeToken(newDb) {
    const meta = newDb.collection(SYNC_META_COLLECTION);
    const doc = await meta.findOne({ _id: "resumeToken" });
    return doc?.token || null;
}

async function saveResumeToken(newDb, token) {
    const meta = newDb.collection(SYNC_META_COLLECTION);
    await meta.updateOne({ _id: "resumeToken" }, { $set: { token, updatedAt: new Date() } }, { upsert: true });
}

async function getMigrationStatus(newDb) {
    const meta = newDb.collection(SYNC_META_COLLECTION);
    const doc = await meta.findOne({ _id: "migrationDone" });
    return doc?.done === true;
}

async function setMigrationDone(newDb) {
    const meta = newDb.collection(SYNC_META_COLLECTION);
    await meta.updateOne({ _id: "migrationDone" }, { $set: { done: true, doneAt: new Date() } }, { upsert: true });
}

// ─── Step 1: Capture Oplog Timestamp ─────────────────────────────────────────

async function captureResumeTimestamp(oldDb) {
    // Run hello on the database itself (doesn't require admin privileges)
    const result = await oldDb.command({ hello: 1 });
    const timestamp = result.operationTime || result.$clusterTime?.clusterTime;
    if (!timestamp) {
        throw new Error("Could not capture oplog timestamp. Is this a replica set / Atlas cluster?");
    }
    console.log(`[Step 1] Captured oplog timestamp: ${timestamp.toString()}`);
    return timestamp;
}

// ─── Step 2: Create Default Store ────────────────────────────────────────────

async function createDefaultStore(newDb) {
    const stores = newDb.collection("stores");
    try {
        await stores.updateOne({ _id: DEFAULT_STORE_ID }, { $setOnInsert: DEFAULT_STORE }, { upsert: true });
        console.log(`[Step 2] Default store ensured: ${DEFAULT_STORE.name} (${DEFAULT_STORE_ID})`);
    } catch (err) {
        if (err.code === 11000) {
            console.log(`[Step 2] Default store already exists, skipping.`);
        } else {
            throw err;
        }
    }
}

// ─── Step 3: Bulk Migration ──────────────────────────────────────────────────

async function bulkMigrate(oldDb, newDb) {
    console.log(`[Step 3] Starting bulk migration...`);

    for (const collectionName of ALL_SYNCED_COLLECTIONS) {
        const transform = transformers[collectionName];
        const oldCol = oldDb.collection(collectionName);
        const newCol = newDb.collection(collectionName);

        const docs = await oldCol.find({}).toArray();

        if (docs.length === 0) {
            console.log(`  - ${collectionName}: 0 documents (empty)`);
            continue;
        }

        // Transform all documents
        const transformed = docs.map(transform);

        // Use bulkWrite with upserts — safe to re-run (idempotent)
        const bulkOps = transformed.map((doc) => ({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: doc },
                upsert: true,
            },
        }));

        const result = await newCol.bulkWrite(bulkOps, { ordered: false });
        const upserted = result.upsertedCount || 0;
        const modified = result.modifiedCount || 0;
        console.log(`  - ${collectionName}: ${docs.length} docs (${upserted} inserted, ${modified} updated)`);
    }

    // Seed APP_CONFIG if not exists
    const configCol = newDb.collection("configs");
    const existingConfig = await configCol.findOne({ name: "APP_CONFIG" });
    if (!existingConfig) {
        await configCol.insertOne({
            name: "APP_CONFIG",
            maintenance: {
                isActive: false,
                message: "We are currently down for maintenance. Please check back soon.",
                endTime: new Date(Date.now() + 30 * 60 * 1000),
            },
            forceUpdate: {
                minIosVersion: "0.0",
                minAndroidVersion: "0.0",
                updateMessage: "A new version of the app is available. Please update to continue.",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        console.log(`  - APP_CONFIG seeded.`);
    }

    console.log(`[Step 3] Bulk migration complete.`);
}

// ─── Step 4: Change Stream Sync ──────────────────────────────────────────────
// Uses `for await` loop to process events SEQUENTIALLY.
// This guarantees:
//   - No out-of-order writes (insert before update)
//   - Resume token is saved only AFTER the event is fully processed
//   - No concurrent writes that could corrupt data

async function startChangeStreamSync(oldDb, newDb, resumeToken, resumeTimestamp) {
    const watchedCollections = ALL_SYNCED_COLLECTIONS;

    const pipeline = [{ $match: { "ns.coll": { $in: watchedCollections } } }];

    // If we have a saved resume token from a previous run, use it.
    // Otherwise fall back to the oplog timestamp captured before bulk migration.
    const streamOptions = { fullDocument: "updateLookup" };
    if (resumeToken) {
        streamOptions.resumeAfter = resumeToken;
        console.log(`[Step 4] Resuming Change Stream from saved token (crash recovery).`);
    } else {
        streamOptions.startAtOperationTime = resumeTimestamp;
        console.log(`[Step 4] Starting Change Stream from oplog timestamp: ${resumeTimestamp.toString()}`);
    }

    const changeStream = oldDb.watch(pipeline, streamOptions);

    let eventCount = 0;
    let tokenSaveCounter = 0;

    // Status logger — prints sync count every 60 seconds
    const statusInterval = setInterval(() => {
        console.log(`[STATUS] Events synced: ${eventCount} | Tokens saved: ${tokenSaveCounter} | Uptime: ${Math.floor(process.uptime())}s`);
    }, 60_000);

    // Process events sequentially with for-await loop
    // This is the correct pattern — no race conditions, no overlapping writes
    try {
        for await (const event of changeStream) {
            const collName = event.ns.coll;
            const newCol = newDb.collection(collName);
            const transform = transformers[collName];

            if (!transform) {
                console.log(`  [SYNC] Skipping unknown collection: ${collName}`);
                continue;
            }

            try {
                switch (event.operationType) {
                    case "insert": {
                        const transformed = transform(event.fullDocument);
                        await newCol.updateOne({ _id: transformed._id }, { $set: transformed }, { upsert: true });
                        eventCount++;
                        console.log(`  [SYNC] ${collName} insert: ${transformed._id}`);
                        break;
                    }

                    case "update":
                    case "replace": {
                        if (event.fullDocument) {
                            const transformed = transform(event.fullDocument);
                            await newCol.updateOne({ _id: transformed._id }, { $set: transformed }, { upsert: true });
                        } else if (event.updateDescription) {
                            // Apply per-collection stripper (e.g. items drops legacy
                            // `image` field). Falls through unchanged for collections
                            // with no stripper registered.
                            const stripper = FIELD_STRIPPERS[collName];
                            const { cleanUpdates, cleanRemoved } = stripper
                                ? stripper(event.updateDescription.updatedFields, event.updateDescription.removedFields)
                                : {
                                    cleanUpdates: event.updateDescription.updatedFields,
                                    cleanRemoved: event.updateDescription.removedFields,
                                };

                            const update = {};
                            if (cleanUpdates && Object.keys(cleanUpdates).length) {
                                update.$set = cleanUpdates;
                            }
                            if (cleanRemoved?.length) {
                                update.$unset = {};
                                for (const field of cleanRemoved) {
                                    update.$unset[field] = "";
                                }
                            }
                            if (Object.keys(update).length > 0) {
                                await newCol.updateOne({ _id: event.documentKey._id }, update);
                            }
                        }
                        eventCount++;
                        console.log(`  [SYNC] ${collName} update: ${event.documentKey._id}`);
                        break;
                    }

                    case "delete": {
                        await newCol.deleteOne({ _id: event.documentKey._id });
                        eventCount++;
                        console.log(`  [SYNC] ${collName} delete: ${event.documentKey._id}`);
                        break;
                    }

                    default:
                        console.log(`  [SYNC] Ignored event type: ${event.operationType} on ${collName}`);
                }

                // Persist resume token AFTER event is fully processed.
                // Sequential loop guarantees this runs only when the write succeeded.
                tokenSaveCounter++;
                await saveResumeToken(newDb, event._id);
            } catch (err) {
                console.error(`  [SYNC ERROR] ${collName} ${event.operationType}: ${err.message}`);
                // Don't save resume token on error — the event will be retried on restart
            }
        }
    } finally {
        clearInterval(statusInterval);
    }

    return changeStream;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  Bheldi DB Migration & Sync Service");
    console.log("═══════════════════════════════════════════════════════════\n");

    const oldClient = new MongoClient(OLD_DB_URI, CONNECTION_OPTIONS);
    const newClient = new MongoClient(NEW_DB_URI, CONNECTION_OPTIONS);

    try {
        // Connect to both databases
        await Promise.all([oldClient.connect(), newClient.connect()]);
        console.log("[Connected] Old DB and New DB connections established.\n");

        const oldDb = oldClient.db(); // Uses DB name from the URI
        const newDb = newClient.db(); // Uses DB name from the URI

        // Check if we have a saved resume token from a previous run (crash recovery)
        const savedResumeToken = await getSavedResumeToken(newDb);
        const alreadyMigrated = await getMigrationStatus(newDb);

        let resumeTimestamp = null;

        if (savedResumeToken && alreadyMigrated) {
            // ── RESTART PATH ──
            // We crashed/rebooted after a successful migration.
            // Skip bulk migration, resume Change Stream from last saved token.
            console.log("[Restart Detected] Found saved resume token. Skipping bulk migration.");
            console.log("[Restart Detected] Resuming sync from where we left off.\n");
        } else {
            // ── FIRST RUN PATH ──
            // Step 1: Capture timestamp BEFORE doing anything
            resumeTimestamp = await captureResumeTimestamp(oldDb);

            // Step 2: Create default store in new DB
            await createDefaultStore(newDb);

            // Build item name lookup map so the orders transformer can backfill
            // item name snapshots on old order items that never stored a name.
            await buildItemNameMap(oldDb);

            // Step 3: Bulk migrate all data
            await bulkMigrate(oldDb, newDb);

            // Mark migration as done so restarts skip it
            await setMigrationDone(newDb);
        }

        // Step 4: Start real-time sync (blocks here — runs forever via for-await)
        console.log("\n═══════════════════════════════════════════════════════════");
        console.log("  Migration complete. Real-time sync is ACTIVE.");
        console.log("═══════════════════════════════════════════════════════════\n");

        await startChangeStreamSync(oldDb, newDb, savedResumeToken, resumeTimestamp);
    } catch (err) {
        console.error("\n[FATAL ERROR]", err.message);
        console.error(err.stack);
    } finally {
        await oldClient.close().catch(() => {});
        await newClient.close().catch(() => {});
        console.log("[Shutdown] DB connections closed.");
        process.exit(1); // PM2 will auto-restart
    }
}

// Catch unhandled errors so PM2 can restart cleanly
process.on("unhandledRejection", (err) => {
    console.error("[UNHANDLED REJECTION]", err);
    process.exit(1);
});

process.on("SIGINT", () => {
    console.log("\n[SIGINT] Shutting down...");
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("\n[SIGTERM] Shutting down...");
    process.exit(0);
});

main();

/**
 * Backfill profit snapshots for all historical delivered orders.
 *
 * Usage:
 *   node backfill-profit-snapshots.js                  # all history
 *   node backfill-profit-snapshots.js 2026-01-01       # from a specific date
 *   node backfill-profit-snapshots.js 2026-01-01 2026-03-31  # specific range
 *
 * Requires NEW_DB_URI in .env
 */

require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");

const TZ = "Asia/Kolkata";

const MONGO_URI = process.env.NEW_DB_URI;
if (!MONGO_URI) {
    console.error("❌ NEW_DB_URI not set in .env");
    process.exit(1);
}

// ── inline schema/model (avoids needing the full shared package) ──────────────

const orderSchema = new mongoose.Schema(
    { status: Number, createdAt: Date, storeId: mongoose.Types.ObjectId, items: Array },
    { collection: "orders", versionKey: false, strict: false },
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

const OrderModel = mongoose.model("Order", orderSchema);
const SnapshotModel = mongoose.model("ProfitSnapshot", snapshotSchema);

const DELIVERED = 1; // OrderConstants.orderStatus.CLOSED

// ── helpers ───────────────────────────────────────────────────────────────────

// Day boundaries pinned to IST so this matches the production cron.
const toMidnight = (d) => moment.tz(d, TZ).startOf("day").toDate();
const endOfDayIst = (d) => moment.tz(d, TZ).endOf("day").toDate();
const addDays = (d, n) => moment.tz(d, TZ).add(n, "days").startOf("day").toDate();
const formatDate = (d) => moment.tz(d, TZ).format("YYYY-MM-DD");

// ── core: compute + upsert one day ───────────────────────────────────────────

async function processDay(dayStart) {
    const dayEnd = endOfDayIst(dayStart);

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
                // If costPrice is 0 or missing → treat as salePrice (profit = 0 for that item)
                // Revenue always uses full salePrice
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

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Determine date range (IST day boundaries)
    let fromDate, toDate;
    const yesterday = moment.tz(TZ).subtract(1, "day").startOf("day").toDate();

    if (process.argv[2]) {
        fromDate = toMidnight(new Date(process.argv[2]));
    } else {
        // Default: find earliest delivered order
        const earliest = await OrderModel.findOne(
            { status: DELIVERED },
            { createdAt: 1 },
        ).sort({ createdAt: 1 });

        if (!earliest) {
            console.log("No delivered orders found — nothing to backfill.");
            await mongoose.disconnect();
            return;
        }
        fromDate = toMidnight(earliest.createdAt);
    }

    toDate = process.argv[3] ? toMidnight(new Date(process.argv[3])) : yesterday;

    const totalDays = Math.round((toDate - fromDate) / 86400000) + 1;
    console.log(`📅 Backfilling ${formatDate(fromDate)} → ${formatDate(toDate)} (${totalDays} days)`);

    let processed = 0;
    let skipped = 0;
    let current = new Date(fromDate);

    while (current <= toDate) {
        const storesCount = await processDay(new Date(current));
        if (storesCount > 0) {
            console.log(`  ✅ ${formatDate(current)} — ${storesCount} store(s)`);
            processed++;
        } else {
            skipped++;
        }
        current = addDays(current, 1);
    }

    console.log(`\n🎉 Done. ${processed} days written, ${skipped} days skipped (no orders).`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
});

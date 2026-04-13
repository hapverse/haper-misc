const mongoose = require("mongoose");
const { OrderConstants } = require("../constants");
const {
    commonUtils: { generateRandomNumber },
    distributedCacheUtils,
} = require("./../utils");
const Sequence = require("./sequence.schema");
const eventEmitter = require("./../events/emitter");

/**
 * Get next sequence value using Redis INCR (100K+ ops/sec) with MongoDB fallback.
 * On first call, seeds Redis from MongoDB to avoid counter resets after Redis restarts.
 */
async function getNextSeq(counterName) {
    const redisKey = `seq:${counterName}`;

    // Try Redis INCR first
    await distributedCacheUtils.seedIfNeeded(redisKey, counterName);
    const redisSeq = await distributedCacheUtils.incr(redisKey);
    if (redisSeq !== null) {
        // Sync back to MongoDB periodically (every 100 increments) for disaster recovery
        if (redisSeq % 100 === 0) {
            Sequence.findByIdAndUpdate(
                { _id: counterName },
                { $set: { seq: redisSeq } },
                { upsert: true },
            ).catch(() => {});
        }
        return redisSeq;
    }

    // Fallback: MongoDB Sequence (still atomic, just slower under high concurrency)
    const doc = await Sequence.findByIdAndUpdate(
        { _id: counterName },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
    );
    return doc.seq;
}

const schema = new mongoose.Schema(
    {
        orderId: { type: String, unique: true, required: true },
        userId: { type: mongoose.Types.ObjectId, required: true, ref: "users" },
        storeId: { type: mongoose.Types.ObjectId, ref: "stores", required: true }, // Added storeId
        addressId: { type: mongoose.Types.ObjectId, required: false, ref: "addresses", default: null },
        items: [
            {
                itemId: { type: mongoose.Types.ObjectId, ref: "items" },
                quantity: { type: Number, required: true },
                price: { type: Number, required: true },
                costPrice: { type: Number, default: 0 },
                _id: false,
            },
        ],
        paymentMethod: {
            type: Number,
            required: true,
            enum: Object.values(OrderConstants.paymentMethod),
            default: OrderConstants.paymentMethod.COD,
        },
        meta: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            validate: {
                validator: (meta) => {
                    if (
                        !meta ||
                        Object.keys(meta).length === 0 ||
                        (meta.hasOwnProperty("id") && meta.hasOwnProperty("type"))
                    )
                        return true;
                    if (typeof meta !== "object") return false;
                },
                message: "Meta must be null, an empty object, or contain id and type properties",
            },
        },
        price: { type: Number, required: true },
        actualOrderValue: { type: Number, required: true },
        reason: { type: String, required: false },
        status: {
            type: Number,
            enum: Object.values(OrderConstants.orderStatus),
            default: OrderConstants.orderStatus.PAYMENT_INITIATED,
        },
        charges: {
            delivery: { type: Number, required: true },
            platform: { type: Number, required: true },
        },
        assignedTo: { type: mongoose.Types.ObjectId, default: null, ref: "delivery-boys" },
        assignedOn: { type: Date, default: null },
        expectedDelivery: { type: Date, default: null },
        // deliveredBy: { type: mongoose.Types.ObjectId, default: null, ref: "delivery-boys" },
        deliveredOn: { type: Date, default: null },
        deliveryOtp: { type: Number },
        invoiceNumber: { type: String },
    },
    { timestamps: true, versionKey: false },
);

// Indexes
schema.index({ userId: 1, status: 1 });
schema.index({ orderId: "text" });
// schema.index({ addressId: 1 });
// schema.index({ assignedTo: 1 });
schema.index({ createdAt: 1, paymentMethod: 1, price: 1 });
schema.index(
    { userId: 1, "meta.id": 1, "meta.type": 1 },
    { partialFilterExpression: { "meta.id": { $exists: true }, "meta.type": { $exists: true } } },
);

// Added indexes for storeId
schema.index({ storeId: 1 });
schema.index({ storeId: 1, userId: 1, status: 1 });
schema.index({ storeId: 1, createdAt: -1 });
schema.index({ storeId: 1, status: 1, createdAt: -1 });
schema.index({ storeId: 1, assignedTo: 1, createdAt: -1 });
schema.index({ storeId: 1, paymentMethod: 1, createdAt: -1 });
schema.index({ storeId: 1, addressId: 1, createdAt: -1 });
schema.index({ storeId: 1, userId: 1, createdAt: -1 });
schema.index({ storeId: 1, status: 1, deliveredOn: -1 });
schema.index({ storeId: 1, assignedTo: 1, deliveredOn: -1 });
schema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });

// PRE-SAVE → handle new orders
schema.pre("save", async function (next) {
    if (this.isNew) {
        try {
            const seq = await getNextSeq("orderId");
            this.orderId = "BH" + generateRandomNumber(4) + "" + seq;
            this.deliveryOtp = generateRandomNumber(6);

            // Mail on brand new OPEN order
            if (this.status === OrderConstants.orderStatus.OPEN) {
                eventEmitter.emit("open-order-created", this._id, mongoose.models.orders);
            }

            // Push notification for new orders
            eventEmitter.emit("order-status-changed", this, null);
        } catch (error) {
            console.error(error);
        }
    }
    next();
});

// PRE - findOneAndUpdate: capture previous status
schema.pre("findOneAndUpdate", async function (next) {
    try {
        const update = this.getUpdate();

        // Normalize $set
        if (!update.$set) update.$set = {};

        const newStatus = update.$set.status ?? update.status;

        if (newStatus === OrderConstants.orderStatus.CLOSED) {
            update.$set.deliveredOn ??= new Date();
        }

        const docBeforeUpdate = await this.model.findOne(this.getQuery()).select("status").lean();

        this._prevStatus = docBeforeUpdate?.status ?? null;

        next();
    } catch (err) {
        next(err); // don't silently ignore errors
    }
});

// POST-UPDATE → handle status change + close event
schema.post("findOneAndUpdate", async function (doc, next) {
    try {
        if (!doc) return next();

        // Push notification on any status change
        if (this._prevStatus !== undefined && this._prevStatus !== doc.status) {
            eventEmitter.emit("order-status-changed", doc, this._prevStatus);
        }

        // Mail only if status changed to OPEN
        if (this._prevStatus !== OrderConstants.orderStatus.OPEN && doc.status === OrderConstants.orderStatus.OPEN) {
            eventEmitter.emit("open-order-created", doc._id, mongoose.models.orders);
        }

        // Keep your existing CLOSED logic
        if (doc.status === OrderConstants.orderStatus.CLOSED) {
            eventEmitter.emit(
                "order-closed",
                doc,
                mongoose.models.orders,
                mongoose.models.users,
                mongoose.models.wallets,
                mongoose.models.logs,
            );

            // Auto-generate invoice number if not already set
            if (!doc.invoiceNumber) {
                try {
                    const invSeq = await getNextSeq("invoiceNumber");
                    const now = new Date();
                    const yy = String(now.getFullYear()).slice(-2);
                    const mm = String(now.getMonth() + 1).padStart(2, "0");
                    const invNum = `INV-${yy}${mm}-${String(invSeq).padStart(5, "0")}`;
                    await mongoose.models.orders.updateOne({ _id: doc._id }, { $set: { invoiceNumber: invNum } });
                } catch (invErr) {
                    console.error("Invoice number generation failed:", invErr.message);
                }
            }
        }
    } catch (error) {
        console.error(error);
    }
    next();
});

module.exports = mongoose.model("orders", schema);

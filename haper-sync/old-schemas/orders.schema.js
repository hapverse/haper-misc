const mongoose = require("mongoose");
const { OrderConstants } = require("../constants");
const {
    commonUtils: { generateRandomNumber },
} = require("./../utils");
const Sequence = require("./sequence.schema");
const eventEmitter = require("./../events/emitter");

const schema = new mongoose.Schema(
    {
        orderId: { type: String, unique: true, required: true },
        userId: { type: mongoose.Types.ObjectId, require: true, ref: "users" },
        addressId: { type: mongoose.Types.ObjectId, require: false, ref: "addresses", default: null },
        items: [
            {
                itemId: { type: mongoose.Types.ObjectId, ref: "items" },
                quantity: { type: Number, require: true },
                price: { type: Number, require: true },
                sellingPrice: { type: Number, require: true },
                costPrice: { type: Number, require: true },
                _id: false,
            },
        ],
        paymentMethod: {
            type: Number,
            require: true,
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
        price: { type: Number, require: true },
        actualOrderValue: { type: Number, require: true },
        reason: { type: String, require: false },
        status: {
            type: Number,
            enum: Object.values(OrderConstants.orderStatus),
            default: OrderConstants.orderStatus.PAYMENT_INITIATED,
        },
        charges: {
            delivery: { type: Number, require: true },
            platform: { type: Number, require: true },
        },
        assignedTo: { type: mongoose.Types.ObjectId, default: null, ref: "delivery-boys" },
        assignedOn: { type: Date, require: true, default: null },
        expectedDelivery: { type: Date, require: true, default: null },
        // deliveredBy: { type: mongoose.Types.ObjectId, default: null, ref: "delivery-boys" },
        deliveredOn: { type: Date, require: true, default: null },
        deliveryOtp: { type: Number },
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

// PRE-SAVE → handle new orders
schema.pre("save", async function (next) {
    if (this.isNew) {
        try {
            const sequence = await Sequence.findByIdAndUpdate(
                { _id: "orderId" },
                { $inc: { seq: 1 } },
                { new: true, upsert: true },
            );
            this.orderId = "BH" + generateRandomNumber(4) + "" + sequence.seq;
            this.deliveryOtp = generateRandomNumber(6);

            // Mail on brand new OPEN order
            if (this.status === OrderConstants.orderStatus.OPEN) {
                eventEmitter.emit("open-order-created", this._id, mongoose.models.orders);
            }
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
        }
    } catch (error) {
        console.error(error);
    }
    next();
});

module.exports = mongoose.model("orders", schema);

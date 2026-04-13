const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        orderId: { type: mongoose.Types.ObjectId, ref: "orders", required: true, unique: true },
        userId: { type: mongoose.Types.ObjectId, ref: "users", required: true },
        storeId: { type: mongoose.Types.ObjectId, ref: "stores", required: true },
        riderId: { type: mongoose.Types.ObjectId, ref: "delivery-boys", required: true },
        rating: { type: Number, min: 1, max: 5, required: true },
        review: { type: String, default: null }
    },
    { timestamps: true, versionKey: false }
);

// High-performance sharding + Lookup Indexes
schema.index({ riderId: 1, createdAt: -1 });
schema.index({ storeId: 1, createdAt: -1 });
schema.index({ userId: 1 });

module.exports = mongoose.model("ratings", schema);

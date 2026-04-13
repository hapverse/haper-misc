const mongoose = require("mongoose");
const { OrderConstants } = require("../constants");

const TransactionSchema = new mongoose.Schema(
    {
        orderId: { type: mongoose.Types.ObjectId, ref: "orders", required: true },
        storeId: { type: mongoose.Types.ObjectId, ref: "stores", required: true },
        userId: { type: mongoose.Types.ObjectId, ref: "users", required: true },
        totalOrderValue: { type: Number, required: true }, // The actual order value (items + charges)
        platformSharePercentage: { type: Number, required: true, default: 0 }, // e.g., 5 for 5%
        platformShareAmount: { type: Number, required: true },
        storeShareAmount: { type: Number, required: true },
        paymentMethod: { type: Number, enum: Object.values(OrderConstants.paymentMethod), required: true },
        status: { type: Number, default: 1 }, // 1: Completed, 0: Failed (or other states if needed)
    },
    { timestamps: true, versionKey: false }
);

TransactionSchema.index({ orderId: 1 }, { unique: true });
TransactionSchema.index({ storeId: 1 });
TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ storeId: 1, status: 1 });

module.exports = mongoose.model("transactions", TransactionSchema);

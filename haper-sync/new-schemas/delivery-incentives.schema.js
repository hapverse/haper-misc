const mongoose = require("mongoose");

const DeliveryIncentiveSchema = new mongoose.Schema(
    {
        orderId: { type: mongoose.Types.ObjectId, ref: "orders", required: true },
        displayOrderId: { type: String, required: true },
        storeId: { type: mongoose.Types.ObjectId, ref: "stores", required: true },
        deliveryBoyId: { type: mongoose.Types.ObjectId, ref: "delivery-boys", required: true },
        assignedOn: { type: Date, default: null },
        deliveredOn: { type: Date, required: true },
        orderValue: { type: Number, default: 0 },
        deliveryDurationMinutes: { type: Number, default: null },
        thresholdMinutes: { type: Number, default: 0 },
        rewardAmount: { type: Number, default: 0 },
        eligible: { type: Boolean, default: false },
        incentiveEnabled: { type: Boolean, default: false },
        payoutMonth: { type: String, required: true },
        payoutStatus: {
            type: String,
            enum: ["NOT_ELIGIBLE", "PENDING", "PAID"],
            default: "NOT_ELIGIBLE",
        },
        paidOn: { type: Date, default: null },
        paidAmount: { type: Number, default: 0 },
        note: { type: String, default: "" },
    },
    { timestamps: true, versionKey: false },
);

DeliveryIncentiveSchema.index({ orderId: 1 }, { unique: true });
DeliveryIncentiveSchema.index({ storeId: 1, deliveredOn: -1 });
DeliveryIncentiveSchema.index({ storeId: 1, deliveryBoyId: 1, deliveredOn: -1 });
DeliveryIncentiveSchema.index({ storeId: 1, payoutMonth: 1, payoutStatus: 1 });
DeliveryIncentiveSchema.index({ storeId: 1, deliveryBoyId: 1, payoutMonth: 1, payoutStatus: 1 });

module.exports = mongoose.model("delivery-incentives", DeliveryIncentiveSchema);

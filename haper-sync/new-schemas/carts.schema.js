const mongoose = require("mongoose");
const { ItemConstants, OrderConstants } = require("../constants");
const schema = new mongoose.Schema(
    {
        userId: { type: mongoose.Types.ObjectId, required: true, ref: "users" },
        storeId: { type: mongoose.Types.ObjectId, ref: "stores", required: true }, // Added storeId
        items: [
            {
                itemId: { type: String, required: true, ref: "items" },
                quantity: { type: Number, required: true, default: 1 },
                _id: false
            }
        ],
        type: { type: Number, required: true, enum: Object.values(ItemConstants.cartType) }, // 1-cart,2-wishlist
        status: { type: Number, default: OrderConstants.orderStatus.PAYMENT_INITIATED, enum: Object.values(OrderConstants.orderStatus) }//1=active, 0-closed  
    },
    { timestamps: true, versionKey: false }
);

schema.index({ userId: 1 }); // Existing index
schema.index({ storeId: 1, userId: 1, type: 1 }); // New index for store-specific carts

module.exports = mongoose.model("carts", schema);

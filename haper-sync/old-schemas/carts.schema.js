const mongoose = require("mongoose");
const { ItemConstants, OrderConstants } = require("../constants");
const schema = new mongoose.Schema(
    {
        userId: { type: mongoose.Types.ObjectId, require: true, ref: "users" },
        items: [
            {
                itemId: { type: String, require: true, ref: "items" },
                quantity: { type: Number, require: true, default: 1 },
                _id: false
            }
        ],
        type: { type: Number, require: true, enum: Object.values(ItemConstants.cartType) }, // 1-cart,2-wishlist
        status: { type: Number, default: OrderConstants.orderStatus.PAYMENT_INITIATED, enum: Object.values(OrderConstants.orderStatus) }//1=active, 0-closed  
    },
    { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("carts", schema);

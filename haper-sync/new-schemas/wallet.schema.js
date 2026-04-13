const mongoose = require("mongoose");
const crypto = require('crypto');
const { WalletConstant } = require("../constants");

const schema = new mongoose.Schema(
    {
        _id: { type: mongoose.Types.ObjectId, require: true, ref: "users" },
        coins: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
        status: { type: Number, default: WalletConstant.status.ACTIVE },
    },
    { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("wallets", schema);
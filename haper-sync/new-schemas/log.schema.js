const mongoose = require("mongoose");
const { LogConstant } = require("../constants");

const schema = new mongoose.Schema(
    {
        type: { type: Number, default: LogConstant.logType.UNKNOWN, required: true },
        userId: { type: mongoose.Types.ObjectId, default: null, ref: 'users' },
        meta: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { timestamps: { createdAt: true }, versionKey: false }
);

module.exports = mongoose.model("logs", schema);
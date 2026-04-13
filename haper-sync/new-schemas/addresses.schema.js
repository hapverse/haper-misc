const mongoose = require("mongoose");
const schema = new mongoose.Schema(
    {
        userId: { type: mongoose.Types.ObjectId, ref: "users" },
        name: { type: String },
        phone: { type: String, require: true },
        street: { type: String },
        village: { type: String },
        landmark: { type: String },
        pin: { type: Number, require: true },
        addressLine1: { type: String },
        location: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
                required: true,
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true,
            },
        },
        // ll: {},
        isDefault: Boolean,
    },
    { timestamps: true, versionKey: false }
);

schema.index({ userId: 1 });
schema.index({ _id: 1, userId: 1 });
schema.index({ userId: 1, isDefault: 1 }, { partialFilterExpression: { isDefault: true } });
schema.index({ location: "2dsphere" });

module.exports = mongoose.model("addresses", schema);

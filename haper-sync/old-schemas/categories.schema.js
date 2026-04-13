const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    status: { type: Number, required: true, default: 1 },
    icon: { type: String, required: true },
    seq: { type: Number, required: true, default: 1 },
    isSuggested: { type: Boolean, require: true, default: false },
}, { timestamps: true, versionKey: false });

// categorySchema.index({ status: 1, isSuggested: 1, seq: 1 });

module.exports = mongoose.model('categories', categorySchema);
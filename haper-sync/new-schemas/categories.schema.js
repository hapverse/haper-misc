const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'stores', required: true },
    name: { type: String, required: true },
    status: { type: Number, required: true, default: 1 },
    icon: { type: String, required: true },
    seq: { type: Number, required: true, default: 1 },
    isSuggested: { type: Boolean, require: true, default: false },
}, { timestamps: true, versionKey: false });

categorySchema.index({ storeId: 1, status: 1, isSuggested: -1, seq: -1, createdAt: -1 });
categorySchema.index({ storeId: 1, name: 1, status: 1 });

module.exports = mongoose.model('categories', categorySchema);

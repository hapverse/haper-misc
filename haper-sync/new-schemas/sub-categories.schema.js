const mongoose = require("mongoose");

const subcategorySchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'stores', required: true },
    name: { type: String, required: true },
    category: [{ type: mongoose.Types.ObjectId, ref: 'categories', required: true }],
    isSuggested: { type: Boolean, require: true, default: false },
    icon: { type: String, required: true },
    seq: { type: Number, required: true, default: 1 },
    status: { type: Number, required: true, default: 1 }
}, { timestamps: true, versionKey: false });

subcategorySchema.index({ storeId: 1, status: 1, category: 1, isSuggested: -1, createdAt: -1 });
subcategorySchema.index({ storeId: 1, name: 1, status: 1 });

module.exports = mongoose.model('sub-categories', subcategorySchema);

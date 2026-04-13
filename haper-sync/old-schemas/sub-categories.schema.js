const mongoose = require("mongoose");

const subcategorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: [{ type: mongoose.Types.ObjectId, ref: 'categories', required: true }],
    isSuggested: { type: Boolean, require: true, default: false },
    icon: { type: String, required: true },
    seq: { type: Number, required: true, default: 1 },
    status: { type: Number, required: true, default: 1 }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('sub-categories', subcategorySchema);

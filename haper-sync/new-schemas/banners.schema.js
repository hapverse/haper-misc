const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'stores', required: true },
    image: { type: String, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    actionType: { type: String, enum: ['category', 'item', 'url', 'internal-url', 'none'], default: 'none' },
    actionValue: { type: String, default: "" },
    isPermanent: { type: Boolean, default: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    status: { type: Number, required: true, default: 1 },
    seq: { type: Number, required: true, default: 1 },
}, { timestamps: true, versionKey: false });

bannerSchema.index({ storeId: 1, status: 1, seq: -1, createdAt: -1 });
bannerSchema.index({ storeId: 1, seq: -1, createdAt: -1 });
bannerSchema.index({ storeId: 1, status: 1, isPermanent: 1, startDate: 1, endDate: 1 });
bannerSchema.index({ storeId: 1, updatedAt: -1 });

module.exports = mongoose.model('banners', bannerSchema);

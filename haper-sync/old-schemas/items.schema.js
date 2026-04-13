const mongoose = require("mongoose");
const { ItemConstants } = require("../constants");
const Sequence = require("./sequence.schema");
const {
    commonUtils: { generateRandomNumber },
} = require("../utils");

const metaSchema = new mongoose.Schema(
    {
        form: { type: String, enum: Object.values(ItemConstants.form) },
        noOfItems: { type: Number },
        specialty: { type: String },
        package: { type: String, enum: Object.values(ItemConstants.packageForm) },
        flavour: { type: String },
        expiry: { type: String },
        skinType: { type: String },
        isScented: { type: String, enum: Object.values(ItemConstants.scentType) },
        materialFeature: { type: String },
        materialType: { type: String },
        ageRange: { type: String },
        color: { type: String },
        style: { type: String },
        dimension: { type: String },
        isElectric: { type: String },
        targetSpecies: { type: String },
        volume: { type: String },
        isReusable: { type: String },
        dietType: { type: String, enum: Object.values(ItemConstants.dietType) },
    },
    { _id: false, strict: false }
); // 'strict: false' allows additional fields

const schema = new mongoose.Schema(
    {
        name: { type: String, require: true },
        brand: { type: String, require: true },
        barcode: { type: String, require: false, default: "" },
        type: { type: String, require: false },
        quantity: { type: Number, require: true },
        lowQty: { type: Number, require: true },
        weight: { type: String, require: true },
        unit: { type: String, enum: Object.values(ItemConstants.units), require: true },
        description: { type: String, require: false, default: "" },
        image: { type: String },
        images: { type: [String], default: null },
        price: { type: Number, require: true },
        sellingPrice: { type: Number, require: true },
        costPrice: { type: Number, require: true },
        important: { type: Boolean, default: false, index: true },
        isSuggested: { type: Boolean, require: true, default: false },
        tags: { type: String, default: "" },
        category: { _id: { type: mongoose.Schema.ObjectId, ref: "categories", default: null }, name: String },
        subCategory: { _id: { type: mongoose.Schema.ObjectId, ref: "sub-categories", default: null }, name: String },
        meta: { type: metaSchema, default: null },
        status: { type: Number, enum: Object.values(ItemConstants.status), default: ItemConstants.status.ACTIVE },
        seq: { type: Number, required: true, default: 1 },
        iId: { type: String, required: false, default: "" },
        expiresAt: {
            type: Date,
            default: () => new Date(new Date().setFullYear(new Date().getFullYear() + 2)),
        },
    },
    { timestamps: true, versionKey: false }
);

// Unique, always present after pre('save')
schema.index({ iId: 1 }, { unique: true });

// Barcode: often unique, but field might be absent/empty.
// Use a partial unique index so multiple docs with no barcode don't clash.
// item.schema.js
schema.index(
    { barcode: 1 },
    {
        unique: true,
        partialFilterExpression: {
            // index only when barcode exists, is a string, and is not empty
            barcode: { $exists: true, $type: "string", $gt: "" },
        },
    }
);
// If you frequently filter/sort by these, they help too:
schema.index({ status: 1 });
schema.index({ lowQty: 1 });
schema.index({ "category._id": 1, status: 1 });
schema.index({ "subCategory._id": 1, status: 1 });

// If you ever sort by seq or query suggested items:
schema.index({ isSuggested: 1, seq: -1 });

schema.pre("save", async function (next) {
    if (this.isNew) {
        try {
            const sequence = await Sequence.findByIdAndUpdate(
                { _id: "itemId" },
                { $inc: { seq: 1 } },
                { new: true, upsert: true }
            );
            this.seq = sequence.seq;
            this.iId = "BI" + generateRandomNumber(2) + "" + sequence.seq;
        } catch (error) {
            console.error(error);
        }
    }
    next();
});

module.exports = mongoose.model("items", schema);

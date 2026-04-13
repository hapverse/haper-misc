const mongoose = require("mongoose");

const StoreSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true, trim: true },
        address: { type: String, required: true },
        mapLink: { type: String, default: null }, // New field
        image: { type: String, default: null }, // New field
        phone: { type: String, required: true, unique: true, trim: true },
        email: { type: String, required: true, unique: true, trim: true, lowercase: true },
        villages: { type: [String], default: [] },
        time: {
            mon: { start: { type: String, default: "07:00" }, end: { type: String, default: "20:00" } },
            tue: { start: { type: String, default: "07:00" }, end: { type: String, default: "20:00" } },
            wed: { start: { type: String, default: "07:00" }, end: { type: String, default: "20:00" } },
            thu: { start: { type: String, default: "07:00" }, end: { type: String, default: "20:00" } },
            fri: { start: { type: String, default: "07:00" }, end: { type: String, default: "20:00" } },
            sat: { start: { type: String, default: "07:00" }, end: { type: String, default: "20:00" } },
            sun: { start: { type: String, default: "07:00" }, end: { type: String, default: "20:00" } },
        }, // New field for store hours
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
        status: { type: Number, default: 1 }, // 1: Active, 0: Inactive, 2: Onboarding
        config: {
            minimumOrderValue: { type: Number, default: 0 },
            deliveryCharges: { type: Number, default: 0 },
            platformCharges: { type: Number, default: 0 },
            platformSharePercentage: { type: Number, default: 0 }, // New field
            deliveryIncentiveEnabled: { type: Boolean, default: false },
            deliveryIncentiveThresholdMinutes: { type: Number, default: 30 },
            deliveryIncentiveAmount: { type: Number, default: 2 },
            razorpayId: { type: String, default: null },
            razorpaySecret: { type: String, default: null },
            razorpayWebhookSecret: { type: String, default: null },
            // Other store-specific configs can go here
        },
        apiKey: { type: String, unique: true, sparse: true, default: null }, // API Key for store-specific admin access
        ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "admins", default: null }, // Super admin who owns/manages this store
        gstin: { type: String, default: null }, // GSTIN for invoice
    },
    { timestamps: true, versionKey: false }
);

// Create a geospatial index on the 'location' field
StoreSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("stores", StoreSchema);

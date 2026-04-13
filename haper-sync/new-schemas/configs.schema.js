const mongoose = require("mongoose");
const schema = new mongoose.Schema(
    {
        name: String,
        value: String,
        maintenance: {
            isActive: { type: Boolean, default: false },
            message: { type: String, default: 'We are currently down for maintenance.' },
            endTime: { type: Date, default: null }
        },
        forceUpdate: {
            minIosVersion: { type: String, default: "0.0" },
            minAndroidVersion: { type: String, default: "0.0" },
            updateMessage: { type: String, default: 'A new version of the app is available. Please update to continue.' },
        }
    },
    { timestamps: true, versionKey: false }
);

schema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model("configs", schema);

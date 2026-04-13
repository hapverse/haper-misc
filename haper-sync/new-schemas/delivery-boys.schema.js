const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { DeliveryBoyConstant } = require("../constants");


const DeliveryBoySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    avatar: { type: String, default: null },
    email: { type: String, required: true, unique: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    status: { type: Number, enum: Object.values(DeliveryBoyConstant.status), require: true, default: DeliveryBoyConstant.status.AVAILABLE },
    storeId: { type: mongoose.Types.ObjectId, ref: "stores", required: true }, // Added storeId
}, { timestamps: true, versionKey: false });

DeliveryBoySchema.index({ storeId: 1, status: 1 }); // New index for store-specific delivery boys
DeliveryBoySchema.index({ storeId: 1, createdAt: -1 });
DeliveryBoySchema.index({ storeId: 1, status: 1, createdAt: -1 });
DeliveryBoySchema.index({ storeId: 1, name: 1 });

DeliveryBoySchema.pre('save', async function (next) {
    try {
        if (!this.isModified('password')) {
            return next();
        }
        this.password = await bcrypt.hash(this.password, 10);
        next();
    } catch (err) {
        next(err);
    }
});

DeliveryBoySchema.pre('findOneAndUpdate', async function (next) {
    try {
        const update = this.getUpdate();
        if (update.password) {
            const hashedPassword = await bcrypt.hash(update.password, 10);
            this.getUpdate().password = hashedPassword;
        }
        next();
    } catch (err) {
        next(err);
    }
});

DeliveryBoySchema.methods.comparePassword = function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('delivery-boys', DeliveryBoySchema);

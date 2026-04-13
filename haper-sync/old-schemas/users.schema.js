const mongoose = require("mongoose");
const crypto = require('crypto');
const { UserConstants } = require("../constants");

const schema = new mongoose.Schema(
    {
        name: { type: String, default: null },
        email: { type: String },
        phone: { type: String },
        avatar: { type: String, default: null },
        sType: { type: Number, enum: Object.values(UserConstants.accountType), require: true },
        sId: { type: String, default: null },
        status: { type: Number, default: UserConstants.status.ACTIVE },
        refCode: { type: String, default: null },
        referredBy: { type: mongoose.Types.ObjectId, default: null, ref: 'users' }
    },
    { timestamps: true, versionKey: false }
);

schema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $ne: null } } });
schema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $ne: null } } });
schema.index({ refCode: 1 }, { unique: true });

schema.pre('save', async function (next) {
    try {
        if (!this.refCode) {
            let uniqueRefId;
            let isUnique = false;
            while (!isUnique) {
                uniqueRefId = crypto.randomBytes(3).toString('hex').substring(0, 6).toUpperCase();
                const existingUser = await mongoose.models.users.findOne({ refCode: uniqueRefId });
                if (!existingUser) {
                    isUnique = true;
                }
            }
            this.refCode = uniqueRefId;
        }
        next();
    } catch (error) {
        next(new Error('Failed to generate a unique referral code. Please try again later.'));
    }
});

schema.post('save', async function (doc, next) {
    try {
        const existingWallet = await mongoose.models.wallets.findOne({ _id: doc._id });
        if (!existingWallet) {
            await mongoose.models.wallets.create({ _id: doc._id, coins: 0, total: 0 });
        }
        next();
    } catch (error) {
        next(error);
    }
});

module.exports = mongoose.model("users", schema);
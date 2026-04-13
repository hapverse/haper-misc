const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { AdminConstants } = require("../constants");

const AdminSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
    },
    roles: {
        type: [String],
        enum: Object.values(AdminConstants.roles),
        default: [AdminConstants.roles.DELIVERY_ADMIN],
    },
    // New fields for multi-store support
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "stores",
        default: null, // Super admins or platform-level admins might not be tied to a specific store
    },
    status: {
        type: Number,
        default: 1, // 1: Active, 0: Inactive
    },
}, {
    timestamps: true, versionKey: false
});

AdminSchema.pre('save', async function (next) {
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

AdminSchema.pre('findOneAndUpdate', async function (next) {
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

AdminSchema.methods.comparePassword = function (password) {
    return bcrypt.compare(password, this.password);
};

AdminSchema.methods.hasRoles = function (requiredRoles) {
    return requiredRoles.some(role => this.roles.includes(role));
};

const Admin = mongoose.model('admins', AdminSchema);

module.exports = Admin;

const mongoose = require("mongoose");

const sequenceSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
}, { versionKey: false });

const Sequence = mongoose.model("sequences", sequenceSchema);

module.exports = Sequence;
const mongoose = require("mongoose");
const schema = new mongoose.Schema(
    {
        name: String,
        value: String,
    },
    { timestamps: true, versionKey: false }
);
module.exports = mongoose.model("configs", schema);

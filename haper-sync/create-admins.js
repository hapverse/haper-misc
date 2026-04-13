require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");

const MONGO_URI = process.env.NEW_DB_URI; // or your connection string
const STORE_ID = new ObjectId(process.env.STORE_ID); // your store _id

async function main() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();
    const admins = db.collection("admins");

    const SALT_ROUNDS = 10; // matches admins.schema.js

    // ── Super Admin ───────────────────────────────────────────
    const superAdminPassword = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, SALT_ROUNDS);
    await admins.updateOne(
        { email: process.env.SUPER_ADMIN_EMAIL },
        {
            $setOnInsert: {
                email: process.env.SUPER_ADMIN_EMAIL,
                password: superAdminPassword,
                name: "Super Admin",
                phone: "",
                roles: ["super_admin"],
                storeId: null, // super_admin has access to all stores
                permissions: [],
                createdBy: null,
                status: 1,
                fcmTokens: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { upsert: true },
    );
    console.log("✅ Super admin created: superadmin@haper.in");

    // ── Store Admin ───────────────────────────────────────────
    const storeAdminPassword = await bcrypt.hash(process.env.STORE_ADMIN_PASSWORD, SALT_ROUNDS);
    await admins.updateOne(
        { email: process.env.STORE_ADMIN_EMAIL },
        {
            $setOnInsert: {
                email: process.env.STORE_ADMIN_EMAIL,
                password: storeAdminPassword,
                name: "Store Admin",
                phone: "",
                roles: ["store_admin"],
                storeId: STORE_ID, // scoped to one store
                permissions: [],
                createdBy: null,
                status: 1,
                fcmTokens: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { upsert: true },
    );
    console.log("✅ Store admin created: admin@haper.in");

    await client.close();
}

main().catch(console.error);

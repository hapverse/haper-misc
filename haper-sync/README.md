# haper-sync

Idempotent MongoDB index + migration scripts for the Haper backend. All scripts
read the target DB from `NEW_DB_URI` in `.env` (gitignored — never commit it).

```bash
npm install

# Create/confirm every index used by the backend (safe to re-run):
npm run ensure-indexes        # node ensure-indexes.js

# One-time: make items.iId/barcode unique PER STORE (drops old global indexes).
# Run BEFORE the store-clone / multi-store features go live in prod:
npm run migrate-item-indexes  # node migrate-item-indexes.js
```

Both scripts use the native `mongodb` driver, are idempotent, and only touch
indexes (no document writes).

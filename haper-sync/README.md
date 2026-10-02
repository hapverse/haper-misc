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

The index scripts use the native `mongodb` driver, are idempotent, and only
touch indexes (no document writes).

The `items`/`products` `taxonomy` backfill (multi-category feature, Phase 1)
lives in `haper-backend` now, not here — see
`haper-backend/scripts/migrations/backfill-item-taxonomy.js` (run from the
`haper-backend` repo root; deploy/ops boxes only check out `haper-backend`, not
`haper-misc`).

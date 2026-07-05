# Important fixes / TODO — 2.03

Running list of fixes + deferred work. Newest on top.

---

## TODO: Make maintenance mode store-wise (+ an "All Stores" option)

**Status:** ⏳ deferred. Interim label fix shipped (see below).

**Problem.** Maintenance mode is **global** — one on/off for the whole app, set only by
super admin (`configs.maintenance`, served by store-agnostic `GET /user/config`, cached under one
global key). But the admin panel has a **top store-switcher**, so the toggle *looks* store-scoped
when it isn't → confusing. We want to be able to pause **one store** (e.g. Chapra) while others keep
selling, plus keep a master **"All Stores"** switch.

**Interim fix (DONE):** relabelled the toggle in `haper-admin/src/pages/Config/ConfigSettings.tsx`
to **"Maintenance Mode (All Stores)"** + hints that it's global and ignores the top-bar store
selection. No behaviour change — just removes the confusion.

**Design (when we build it):** two levels, mirroring the switcher —
- **"All Stores" selected → global maintenance** (today's behaviour, master switch).
- **A specific store selected → that store's maintenance** (new; store on `stores.config.maintenance`,
  where `pickingEnabled`/`batchesEnabled`/hours already live).
- **Effective for a customer = global.isActive OR theirStore.isActive**; message = store's if set, else global.

**The catch.** The customer app checks maintenance **at boot**, and `GET /user/config` is deliberately
store-agnostic (not behind the store/geo middleware, one global cache key; the admin PUT even sends
`skipStoreHeader: true`). So a per-store pause can only take effect **once the app knows the user's
store**. Global maintenance still works instantly at boot; per-store kicks in after the store resolves.

**Work + effort (maintenance only — leave force-update global):**
- **Backend (~0.5–1 day):** add `stores.config.maintenance` (schema + validator); branch
  `PUT /admin/config/maintenance` on store context (store selected → that store; none → global);
  make `GET /user/config` read `x-store-id` + merge global-OR-store + **per-store cache/invalidation**
  (the fiddly bit); tests. Response shape stays the same.
- **Admin UI (~0.5 day):** make the maintenance card follow the top switcher; show **both** states
  clearly ("Global: OFF · This store: ON"); wire the toggle to global vs store by the switcher.
- **Customer apps — android / iOS / web (~0–1.5 days total):** send `x-store-id` on the config fetch +
  refetch config after the store resolves. **Near-zero** if they already refetch; ~0.5 day each if not.

**Total ≈ 1.5–3 days.** Backend + admin alone ≈ 1 day. The swing is the 3 customer apps.

**Verify first (locks the estimate):** do haper-android / haper-ios / haper-web already send a store id
to `/user/config` and **refetch** it after resolving the store? If yes → apps need ~no change and the
backend merge does everything. If no → each app needs the small send-store-id + refetch change.

**Files touched (interim):** `haper-admin/src/pages/Config/ConfigSettings.tsx` (labels only).
**Related code:** `haper-backend/packages/admin/src/routes/config/controller.js` (`updateMaintenance`),
`haper-backend/packages/user/src/routes/config/controller.js` (`getAppConfig`),
`haper-backend/packages/shared/models/configs.schema.js`, `stores.schema.js` (`config`).

# Client follow-ups — change tracker

Every backend change that *might* need a matching change in a client app goes here,
with a checklist for **each** client so nothing is missed.

**Clients:** `admin` (ops console) · `web` (customer site) · `android` · `ios` ·
`delivery` (rider app) · `picker` (picker app).

**Status key:** ✅ done · ⏳ to do · ❓ verify (probably nothing) · — not affected

## How to use (new session)
1. Read this file.
2. To work, say e.g. **"let's do the admin client changes"** (or name any client / change).
   The session picks the pending (⏳ / ❓) items for that client, implements them
   one by one, and flips the status here when done.
3. Backend-first: only start client work after the backend change is merged-ready
   (see `haper-misc/inventory-v2-design.md`).
4. **Android/iOS rule:** any NEW field in an item/order/category JSON must be
   nullable or always-sent, or old app versions can crash (see memory
   `android_gson_kotlin_defaults`).

---

## CH-1 · Global categories + per-store enable/disable
**Backend:** `feat/inventory-v2` (haper-backend) — committed + pushed; PR into `dev` pending.
**Plain summary:** categories/sub-categories are now ONE shared list for all stores
(not a copy per store). A store's categories appear automatically based on what it
stocks. Only head office (super admin) can create / rename / delete a category; a
store admin can only turn a category **on/off** for their own store.

| Client | What to do | Status |
|---|---|---|
| **admin** | • Drop the "store / add-to-all-stores" picker when creating a category or sub-category — they're global now, so it's one create.<br>• Show **Create / Rename / Delete** for category & sub-category **only to super admin**; hide for store admin & manager (backend now returns 403 for them).<br>• Add a per-store **on/off toggle** on each category for store admins → calls `PATCH /admin/category/:id/store-state` with `{ "enabled": true|false }`.<br>• Category list can show all global categories + this store's item count + the on/off state.<br>• Item add/edit: the category dropdown is just the global list (no per-store filtering). | ⏳ to do |
| **web** | No code change expected — the customer category & sub-category responses are the **same shape**; categories now show up automatically when the store stocks an item. Just verify browsing + store-switch still work. | ❓ verify |
| **android** | No new fields were added to the category JSON → no Gson crash risk, no change expected. Verify category browse. | ❓ verify |
| **ios** | Same as android — no change expected; verify. | ❓ verify |
| **delivery** | Not affected (riders don't use categories). | — |
| **picker** | Not affected (works on items/tasks, not category management). | — |

**Backend endpoints for clients (CH-1):**
- **NEW** `PATCH /admin/category/:categoryId/store-state` — body `{ enabled: boolean }`,
  needs `x-store-id` — store admin/manager turns a category on/off for the current store.
- Category create / update / delete / activate — now **super-admin only** (others get 403).
- Customer `GET /user/home/category` and `/user/home/sub-category/:categoryId` — **same shape**;
  results are membership-based now (a category shows only if the store stocks an item in it).

---

## Future changes
For each later backend change (inventory-v2 Phase 2 batches/FEFO, reservations,
per-batch cost, product master — or anything else), add a new `CH-N` block above
with the same 6-client checklist. Design source: `haper-misc/inventory-v2-design.md`
(§7 = client scope).

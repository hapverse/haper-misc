# Test: item `meta` merges key-by-key (dietType save must not wipe siblings)

**Area:** Backend — item + product-master write path.
`packages/shared/utils/meta-update.utils.js` (new),
`packages/shared/repositories/item.repository.js` (`updateItem`),
`packages/shared/repositories/product.repository.js` (`updateByIId`, `syncToItems`),
`packages/admin/src/routes/product/controller.js` (`update`),
`packages/admin/src/routes/items/controller.js` (`isDisplayChange` for `meta`).
**PR/deploy:** backend-only → `dev` (`dapi.haper.in`). No client change, no API-shape change.

## Why
`meta` is one document holding ~19 independent catalogue attributes (`form`, `flavour`,
`package`, `dietType`, `color`, `volume`, …). Every form sends only the keys it knows
about — the new Veg/Non-Veg control sends `meta: { dietType: "VEGETARIAN" }` alone.

The write path applied it as a whole-object `$set: { meta: {...} }`, which REPLACES the
stored object. Real example proven on an in-memory DB:

```
BEFORE : { form: "SOLID", flavour: "SPICY", package: "POUCH", dietType: "VEGETARIAN" }
save dietType only
AFTER  : { dietType: "VEGETARIAN" }        <- form / flavour / package silently deleted
```

Nothing has populated `meta` in prod yet (0 of 3745 items, 0 of 1874 products), so no
data has been lost — it was a landmine waiting for the first `form`/`flavour` entry.
The master fan-out (`syncToItems`) carried the same wipe to EVERY store's item copy.

## The fix
Each `meta` key is now written on its own dot path — `$set: { "meta.dietType": ... }` —
so only that key changes and the siblings stay. Applied at every writer: the per-store
item update, the product-master edit, the master→items fan-out.

One wrinkle: `meta` defaults to **null** on both items and products, and Mongo refuses to
create a field under a null (`Cannot create field 'dietType' in element {meta: null}`).
So the writers first seed `meta: {}` on the rows where it is null, then apply the dot
paths. Enum validation still runs (`meta.dietType` must be `N/A` / `VEGETARIAN` /
`NON_VEGETARIAN`) — dot paths are still cast by Mongoose.

## Steps (backend jest, in-memory only)
`cd packages/admin && NODE_ENV=test npx jest __tests__/items.test.js __tests__/product-master-crud.test.js`

- ✅ **Siblings survive** — item with `meta { form: POWDER, flavour: SPICY, package: POUCH }`,
  `PUT /admin/item/:id` with `meta { dietType: VEGETARIAN }` → all four keys present.
- ✅ **Null meta still works** — item with no `meta` (the default today) → same save
  creates `{ dietType: ... }`, no error.
- ✅ **Only the sent key changes** — `dietType VEGETARIAN → NON_VEGETARIAN` leaves
  `flavour` untouched, and a `name` sent alongside still applies.
- ✅ **Master edit merges** — `PATCH /admin/product/:id` with `meta { dietType }` keeps the
  master's `form/flavour/package` AND merges them into every store's item, including a
  store item whose `meta` was still null.
- ✅ **Item edit routed to the master merges** — super admin saves `dietType` on an item
  that has a materialised product → master keeps its other meta keys.
- ✅ **A master with NO meta never wipes the items' meta** — master `meta` still null
  (the schema default), items carry `{ form: POWDER, dietType: VEGETARIAN }`;
  `PATCH /admin/product/:id` with `{ brand: "NewBrand" }` (meta not touched at all) →
  brand updates, item meta intact. Same after running the nightly reconcile job.
- ✅ **Drifted item catches up instead of silently no-op'ing** — item `meta.dietType = N/A`
  while the master already says `VEGETARIAN`; admin saves `VEGETARIAN` from the item form
  → the item is written to `VEGETARIAN` (before: 200 OK but the value never persisted and
  the dropdown reverted on reload). Master untouched.
- ✅ **Master meta enums are validated** — `POST /admin/product` with
  `meta { dietType: "VEGAN" }` → 400; an unknown attribute key (`someNewAttribute`) is
  still accepted (master meta stays an open bag).
- ✅ **A `__proto__` meta key can't pollute the process** — `PUT /admin/item/:id` and
  `PATCH /admin/product/:id` with the RAW body `{"meta":{"__proto__":{"polluted":1}}}` →
  `Object.prototype` gains nothing, the item's other meta keys are untouched, and the
  NEXT ordinary `dietType` save still returns 200.
- ✅ **`constructor` / `prototype` meta keys are rejected** — same routes → 400/403 with
  the key named in the message; nothing written.
- ✅ Regression: full `packages/admin` suite still green.

## Manual check (admin UI, dev)
1. Item → Edit → set Veg/Non-Veg → Save → reopen: the other attribute fields are still
   filled in (before the fix they came back blank once any of them was used).
2. Product Master → edit the same product → its meta attributes are intact, and the
   change is visible on every store's copy of the item.

## Meta key names are not just data
A meta key is written as a raw Mongo dot path (`meta.<key>`), so the KEY NAME reaches the
driver. Real example, proven end-to-end on the in-memory DB before the fix: saving
`{"meta":{"__proto__":{...}}}` made Mongoose walk `Object.prototype` while casting the
path and permanently add `$fullPath` / `$parentSchemaDocArray` to it — after which EVERY
later meta save in that server process died with
`this.$_terms[key].slice is not a function` until the app was restarted. One admin request
could take catalogue editing down for everyone.

Now: `metaUpdateUtils.SAFE_META_KEY` (letters, digits, `_`, `-`, and never `__proto__` /
`constructor` / `prototype`) is the single rule.
- The **writer** (`toMetaMergeUpdate`) DROPS any key that fails it, so one bad legacy
  document can never brick the master fan-out or the nightly reconcile.
- The **product-master validator** opens the bag by that same pattern instead of
  `.unknown(true)`, so a human gets a clear 400 rather than a silent no-op.
- Joi cannot see a `__proto__` key at all (JSON.parse makes it an own property Joi's key
  walk skips), so the writer-side guard is the load-bearing one — the validator is the
  readable second layer. A key-name allow-list regex WITHOUT the prototype-name exclusion
  is not enough: `__proto__` matches `^[A-Za-z0-9_-]+$`.
- Keys containing `.` or `$` never reach the validator at all — `express-mongo-sanitize`
  strips them app-wide first (that's why they looked like a "silent no-op").
- Zero risk to existing data: 0 of 3745 items in the prod dump have a populated `meta`,
  so no stored key would newly be rejected.

## Clearing a meta attribute — known limitation (deliberate)
There is **no route that clears a meta key** today, and that is on purpose:
- `PATCH /admin/product/:id` with `meta: null` returns 400 (`metaShape` does not
  `.allow(null)`).
- Allowing it would clear the master's WHOLE bag while the fan-out stays merge-only, so
  every store's item would keep its stale copy → exactly the master/item drift this
  feature was fixed twice to remove.
- The enum-backed attributes carry their own "not applicable" value instead —
  `dietType: "N/A"` is the supported way to say "no diet classification".
Revisit only if a real per-key clear is needed; it should then be a per-key
`$unset` (`meta.<key>`) that fans out, never a whole-object null.

## Edge cases / notes
- A `null` the SERVER manufactures is not a clear: `projectionFieldsFromProduct` omits
  `meta` entirely when the master has none, so the fan-out (and the nightly reconcile)
  can't delete an item's own meta.
- When a submitted display value matches the master but not the item's stale copy, the
  master's value is projected onto the item (`masterCatchUpValue`) instead of being
  dropped. The value written is always the MASTER's, never the caller's, so this needs no
  super-admin rights — it's the same one-way sync the fan-out does.
- The fan-out now MERGES the master's meta onto items instead of replacing it: a key that
  exists only on an item survives a master edit. Deliberate — that's the wipe we're
  fixing. Removing a key everywhere has no route today (see "Clearing" above).
- A store admin echoing an unchanged `meta` subset no longer 403s ("edit it on the
  master"): the change check now compares only the keys actually sent, per key.

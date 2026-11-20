# Plan: Brand admin (Phase 2 of Shop by Brand for Haper Business)

Status: APPROVED 2026-11-20 — in build (backend steps Backend 1–11, admin web steps Admin web 1–5). Depends on Phase 1 (`plan-brand-shop-business.md`, built, uncommitted).
Scope: dev only. Backend + admin web. **No app release** (Android contract unchanged).

## Owner decisions (2026-11-20)

These override the matching parts of sections 0–9 below.

1. **Catch-all names** (Generic, Local, NA, …) stay always hidden. They show as read-only rows in the admin list (D3).
2. **A merge changes only what buyers see.** Products are never renamed. Product Master stays the permanent fix (section 9, Q2).
3. **Look-alike hints are built now.** This overrides section 9, Q3 ("later").
   - `GET /admin/brand` rows carry `samples`: up to 3 active product names for the key.
   - Rows also carry `lookAlikes`: max 5 entries `{ key, name, products, reason }`. `reason` is one of `punctuation` | `prefix` | `spelling`. System-hidden keys are excluded.
   - The pair-finding logic moves from `haper-backend/scripts/migrations/report-brand-duplicates.js` into a shared util. The script then imports it. One implementation only.
4. **Merged spellings** are matched by search chips (D5). Old brand links open the target brand (D4).
5. **Logos:** transparent areas are filled white. Brand logos are 256 px square JPEG (D9). Category icons are fixed separately and keep transparency. They are not part of this plan.
6. **"View products" link:** later. Not in this build.
7. **UI:** follows `design-brand-admin.md`. It is a list with a right-side **drawer**, not a modal. Wherever this plan says "modal", read "drawer". The 409 and 400 reason codes are the backend's (sections 2.2 and 4.2). The admin UI maps them to copy.
8. **Copy:** say changes reach the app **"within 5 minutes"** (Android caches the list for 5 min). This replaces the "within a few minutes" wording in section 3.3 and the Admin web 3 step (edit modal).

Plain words: Phase 1 builds the brand list automatically from the free-text `brand` on items. Phase 2 lets a super
admin put a small "correction sheet" on top of that automatic list, one row per brand they touch:
- **merge** spellings: "Cadbbury" (1 product) is shown as part of "Cadbury" (43 products);
- **rename** what buyers see: key `pg` shown as "P&G";
- **logo**: upload an image, the app shows it instead of the letter badge;
- **hide** a real brand from the brand screens (its items stay in categories and search).

This sheet is the `brands` collection, called the **overlay**. It never changes products or items. Delete it and
the app is back to exactly Phase 1.

---

## 0. Decisions in this design (DBA calls; owner questions are in section 9)

| # | Call | Why (one line) |
|---|---|---|
| D1 | One **`claims`** array per row = `[key, ...aliases]` with ONE unique multikey index. Replaces the Phase 1 note "partial unique index on aliases". | A unique index on `aliases` alone only stops alias-vs-alias. It cannot stop "alias of A = key of B". `claims` stops all three collisions in one index, and it is never empty, so no partial filter is needed. |
| D2 | An alias is **one level only**. A key that is someone's alias cannot have its own row, and vice versa. | Falls out of D1 for free. No chains (A -> B -> C), no loops. |
| D3 | System catch-alls (`generic`, `genric`, `na`, `n/a`, `unbranded`, `local`, `none`, no letter/digit) can be **neither a key nor an alias** (400). | Merging "Generic" into "Amul" would put 368 unbranded products under Amul. The Phase 1 hidden list stays absolute. |
| D4 | Alias in a brand-page link -> **serve the target brand** (response `brand.key` is the target). Not `null`. | Old app cache (up to ~7 min) or a shared link with "cadbbury" still opens Cadbury. Android already re-sends its own key for page 2+ and shows `data.brand` (checked `BrandItemsViewModel.kt`), so no app change. |
| D5 | Search chips match the **key, every alias, and the display name**. | Buyer types "cadbb" or "procter" and still gets the chip. |
| D6 | `displayName` is **required when aliases are set**. | Otherwise a store that only stocks the misspelt "Cadbbury" would show "Cadbbury" as the merged name. |
| D7 | **No separate overlay cache.** The overlay is read (from the PRIMARY) inside the existing per-store list build, which is already cached 120 s. Writes delete the per-store keys. | One cache, one invalidation. Primary read stops a lagging secondary from re-caching the old overlay for 120 s right after an admin save. |
| D8 | Indexes built at **admin boot** via `mongoIndexUtils.ensureIndexesFor` + a spec check that makes brand WRITES answer 503 if the indexes are wrong. Not a migration script. | The house script pattern (`build-wholesale-indexes.js`) exists for BIG collections where a boot build is dangerous. `brands` is new and tiny (< 500 rows); the house pattern for small rule collections (variant-groups, cart-limit-rules, retailer-profiles) is the boot build. Every env and every test DB gets it. |
| D9 | Logo pipeline: **flatten onto white, square 256 px, JPEG**. Additive option on `s3Utils`. | Verified locally: today's pipeline turns a transparent PNG into a BLACK background (sharp 0.35.5, `.jpeg()` with no `.flatten()`). Most brand logos are transparent PNGs. 800 px is also 5-10x more bytes than a 56 dp tile needs (400 logos on the All brands grid). |
| D10 | Hard role gate `requireRoles([SUPER_ADMIN])`, NOT `requirePermission`. | `requirePermission` lets every store_admin through implicitly. Brands are global (all stores). |
| D11 | Cache key stays `CACHE_BRANDS_v1`. Readers tolerate entries without the new internal fields. | Old entries expire in 120 s; a bump only churns a test. |

---

## 1. Real numbers (offline prod copy, 2026-11-19 dump, counts only)

| Thing | Count |
|---|---|
| Stores | 2 |
| Products (master) | 2,124 (2,114 active) |
| Items (store copies) | 4,247 (2,123 + 2,124); 2,059 / 2,050 active |
| Wholesale items (`wholesaleOnly: true`) | **0** (Business lists are empty in prod today) |
| Raw brand spellings (active products) | 482 |
| Brand keys after Phase 1 auto-merge (case/space) | 404, of which **401 visible**, 3 system-hidden (367 products) |
| Keys with only 1 product | 222 |
| Biggest brands (products) | 94, 90, 62, 56, 50 |
| Key length | median 7, p99 18, max 31 |
| Keys with `&` or `'` (need URL encoding in the admin path) | 16 (e.g. `p&g`, `head & shoulders`, `l'oréal`); none contain `/` |
| Item brand key != its product's brand key | **0** (fan-out is clean, so `products` is a valid source for the admin key list) |
| Suspect duplicate pairs (same heuristic as Phase 0 report) | **27 pairs in 26 clusters, 53 keys**; largest cluster 3 |

Real suspect examples (products in brackets): `cadbury(43) ~ cadbbury(1)`, `reckitt(35) ~ reckit(2)`,
`coca cola(13) ~ coco cola(18) ~ coca-cola(1)`, `p&g(36) ~ pg(2)`, `goldiee(94) ~ goldie(5)`,
`marico(45) ~ marico ltd(1)`, `close up(2) ~ closeup(1)`, and false positives such as `gajendra ~ rajendra`.
Also `p&g` and `procter & gamble` are both keys but the heuristic does not pair them: only a person can.
So the overlay will realistically hold **~30 alias rows + however many logos staff upload (up to ~400)**.

---

## 2. Schema: `brands` collection

Model `BrandOverlayModel` (file `shared/models/brands.schema.js`, collection `brands`). Named "overlay" in code
because `BrandRepository` already means the derived per-store list.

| Field | Type | Rule |
|---|---|---|
| `key` | String, required | The brand it describes, already normalised (`normaliseBrand`). 1-120 chars. Never changes after insert. |
| `displayName` | String or null, default null | What buyers see. Trimmed, spaces collapsed, 1-60 chars, must contain a letter or digit. null = automatic (Phase 1 rule). Required when `aliases` is non-empty (D6). |
| `aliases` | [String], default [] | Other keys folded into this brand. Each normalised; max 20; not hidden; not equal to `key`; de-duplicated; stored sorted. |
| `claims` | [String], required | **Server-maintained** `[key, ...aliases]`. Never accepted from a client. Exists only to carry the unique index (D1). |
| `logoUrl` | String or null, default null | Only ever a URL our own upload returned. Never accepted as text from a client. |
| `hidden` | Boolean, default false | Admin hide of a real brand. |
| `rev` | Number, default 1 | Optimistic concurrency. +1 on every write. |
| `updatedBy` | `{ adminId: ObjectId, name: String }` | Snapshot for the list screen (no join). |
| `createdAt`, `updatedAt` | timestamps | |

Example:
```json
{ "key": "cadbury", "displayName": "Cadbury", "aliases": ["cadbbury"], "claims": ["cadbury", "cadbbury"],
  "logoUrl": "https://<cdn>/uploads/brands/<uuid>-cadbury.jpg", "hidden": false, "rev": 3,
  "updatedBy": { "adminId": "...", "name": "Ops Admin" } }
```

### 2.1 Indexes (specs in `BrandConstants.indexSpecs.brands`, single source for schema + boot build + check)

| Name | Key | Options | Guards |
|---|---|---|---|
| `uniq_brands_key` | `{ key: 1 }` | unique | One row per brand; the lookup index. (Implied by the claims index too; kept explicit because every write looks up by `key`.) |
| `uniq_brands_claims` | `{ claims: 1 }` | unique (multikey) | No key or alias is claimed by two rows: key-vs-key, alias-vs-alias, alias-vs-key. |

Mongo note: a unique multikey index compares across documents only; duplicates INSIDE one array are allowed. So
"alias = its own key" is not caught by the index and is checked in code (400 `ALIAS_SELF`).

Build: add `BrandOverlayModel` to `ensureIndexesFor([...])` in `admin/src/connections/mongo.js` and to the
second hardcoded list in `admin/__tests__/setup.js`. Then a `missingIndexes` spec check (key + unique, never name
only). If it fails: log CRITICAL and every brand WRITE answers 503 `BRAND_INDEX_MISSING` (re-checked at most once
a minute, same shape as `RetailerProfileRepository.assertIndexesReady`). Reads never depend on the index. The user
API only reads `brands`, so it needs no registration (a missing collection reads as empty).

Rollback of the indexes: `db.brands.dropIndex("uniq_brands_claims")` etc. (zero data impact).

### 2.2 Write validation (all in one pure function, `brandOverlayUtils.normaliseInput`)

| Check | Result |
|---|---|
| `:key` param not already normalised (`normaliseBrand(k) !== k`) | 400 `KEY_NOT_CANONICAL` (stops a second row "Amul" next to "amul") |
| `:key` is a system-hidden key | 400 `KEY_HIDDEN` |
| an alias is system-hidden | 400 `ALIAS_HIDDEN` + `details.alias` |
| an alias equals `key` | 400 `ALIAS_SELF` |
| more than 20 aliases | 400 `TOO_MANY_ALIASES` |
| aliases non-empty and no `displayName` | 400 `DISPLAY_NAME_REQUIRED` |
| `rev` missing / not an integer | 400 `REV_REQUIRED` |
| `:key` is already another row's alias | 409 `KEY_IS_ALIAS` + `details.brand` ("cadbbury is merged into Cadbury") |
| an alias has its own row | 409 `ALIAS_IS_BRAND` + `details.alias` ("reset Coco Cola first, then merge it") |
| an alias is another row's alias | 409 `ALIAS_TAKEN` + `details.{alias, brand}` |
| `rev` does not match | 409 `STALE` + `details.rev` (current) |
| Joi shape errors (unknown field, wrong type, `logoUrl` sent as text) | 403 (admin validator house convention) |

All semantic errors use `errorUtils(msg, status, { errorType: "BRAND", reason, details })`, so the admin UI gets
`reason` + `details` (the error middleware only surfaces `reason` when `errorType` is set).

An alias does NOT have to exist in products today (a spelling may arrive later, or exist only in one store). The
admin screen shows each alias's current product count, so a dead alias is visible as "0 products".

---

## 3. How the overlay plugs into the existing pipeline

### 3.1 One function: `buildBrandList(rows, overlay = [])`

`overlay` = plain rows `{ key, displayName, aliases, logoUrl, hidden }`. Empty or missing = byte-identical Phase 1
output (a test pins this). Steps:

1. Build `aliasTo` (alias -> target key) from overlay rows sorted by `key`. Defensive, for bad data the index
   should make impossible: a key that has its own row is never an alias; an alias claimed twice goes to the
   smaller target key (logged once).
2. For each aggregation row (one per raw spelling): `k = normaliseBrand(brand)`. Skip if `isHiddenBrandKey(k)`
   (system hidden is checked on the RAW key first, so the hidden list always wins). `target = aliasTo.get(k) ?? k`.
3. Group per `target` exactly as today: union of size-group ids (so `itemCount` = cards over the merged brand, a
   size group split across "Cadbury" and "Cadbbury" counts once), raw `spellings` kept (so the brand page's
   `brand: { $in: spellings }` automatically includes the alias items), cards per display spelling.
4. Per target: drop if `overlay[target].hidden`. Then
   - `name` = `displayName` if set; else Phase 1 `pickName` over spellings whose key IS the target; if the store
     has none of those, over all spellings.
   - `logoUrl` = overlay `logoUrl` or null.
   - internal `aliasKeys` = overlay aliases of the target (all of them, present in this store or not).
   - internal `matchKeys` = `[key, ...aliasKeys, normaliseBrand(displayName)]` de-duplicated.
5. Sort as today, by `key` (contract: clients derive the A-Z letter from `key`). Cap 1,000 as today.

Example: store has "Cadbury" (3 cards), "CADBURY" (1), "Cadbbury" (1 card, a size group also listed under Cadbury).
Overlay `cadbury: { displayName: "Cadbury", aliases: ["cadbbury"] }` -> one entry `{ key: "cadbury", name:
"Cadbury", itemCount: 4, spellings: ["Cadbury", "CADBURY", "Cadbbury"] }`.

`toPublicBrand` already whitelists `{key, name, itemCount, logoUrl}`, so `spellings`, `aliasKeys`, `matchKeys`
never reach a client.

### 3.2 Repository (`brand.repository.js`)

- `compute(storeId, wholesale)`: run the existing aggregation and `BrandOverlayModel.find({}, {key, displayName,
  aliases, logoUrl, hidden}).read("primary").lean()` in parallel; pass both to `buildBrandList`.
  If the overlay read fails: build WITHOUT the overlay, log, and **do not cache** that result (next request
  retries). Never cache a list missing its overlay for 120 s.
- `findByKey(storeId, key)`: `list.find(b => b.key === key) || list.find(b => (b.aliasKeys || []).includes(key))`.
- `matchChips`: match on `b.matchKeys ?? [b.key]` (tolerates a Phase 1 cache entry during deploy). Exact = any match
  key equals the query; prefix rule (>= 3 chars) unchanged; sort and max 3 unchanged.
- NEW `cacheKeysFor(storeId)` -> both `:business` and `:retail` keys, built with the same `toOid` canonical id as
  `listForStore` (one place builds the key).
- NEW `invalidateAll()`: `StoreModel.find({}, {_id: 1})` (all stores, any status: 2 today) -> `del` each of the two
  keys per store, each in try/catch. Never throws; returns how many keys it deleted. No pattern delete
  (`distributedCacheUtils` has none).

### 3.3 Freshness after an admin save

Save commits -> controller calls `invalidateAll()` -> next buyer request rebuilds from the primary.
- With Redis: the change is live on the next request; the app's own 5-min cache means a buyer sees it within ~5 min
  (pull-to-refresh at once). Admin screen copy: "Changes reach the app within a few minutes."
- Race: a request that built the old list just before the commit and writes it just after the delete keeps it for
  up to 120 s. Accepted (bounded by TTL).
- Without `REDIS_URL` (per-process node-cache fallback) the admin process cannot clear the user API's memory: worst
  case 120 s. Accepted.

---

## 4. Admin API (`/admin/brand`, admin service)

All routes: `authenticate` -> `requireRoles([SUPER_ADMIN])` (D10). Global (no store header needed;
`skipStoreHeader` on the FE like the audit log). Every write: `assertIndexesReady` (503) -> guarded write ->
`auditUtils.log` -> `BrandRepository.invalidateAll()` -> respond. Single-document writes, so no transaction and
no pre-create list entry beyond the index build in 2.1.

### 4.1 `GET /admin/brand`
No paging (401 keys today, ~80-120 KB JSON; FE filters and searches in memory). Optional `?q=` is NOT added.

Built by `catalogue.js` from three reads:
1. `products` aggregation: active products, `$group` by raw `brand` -> count (one scan of 2.1k docs, ~10 ms).
2. Overlay rows, read from the primary (so the admin sees their own save; admin otherwise reads secondaries).
3. Per store: `BrandRepository.listForStore(storeId, { wholesale: true })` (cached; the exact numbers the app shows).

Response:
```json
200 { "msg": "Brands fetched", "data": {
  "stores": [ { "_id": "...", "name": "Bhagwan Bazar" } ],
  "brands": [ {
      "key": "cadbury",
      "autoName": "Cadbury",
      "name": "Cadbury",
      "products": 43,
      "spellings": [ { "name": "Cadbury", "products": 41 }, { "name": "CADBURY", "products": 2 } ],
      "aliasOf": null,
      "systemHidden": false,
      "inCatalogue": true,
      "business": [ { "storeId": "...", "cards": 0 } ],
      "overlay": { "displayName": "Cadbury", "aliases": [ { "key": "cadbbury", "products": 1 } ],
                   "logoUrl": "https://...", "hidden": false, "updatedAt": "...", "updatedBy": { "name": "..." } },
      "rev": 3
  } ] } }
```
- Rows = union of product keys, overlay keys and overlay aliases, sorted like the app.
- `aliasOf`: set on a key that is folded into another brand (its row is read-only in the UI: "Merged into Cadbury").
- `systemHidden`: catch-all keys are listed (so staff see why they are missing) but not editable.
- `rev`: `0` when there is no overlay row (that is the value a first PUT must send).
- `business` only on canonical rows (alias counts are folded into the target).
- `inCatalogue: false` = an overlay row whose key no longer exists in any active product (see 4.5).
- `samples` and `lookAlikes` (built now, Owner decisions item 3): `samples` = up to 3 active product names;
  `lookAlikes` = max 5 `{ key, name, products, reason }`, `reason` in `punctuation` | `prefix` | `spelling`.
  System-hidden keys are never in `lookAlikes`.

### 4.2 `PUT /admin/brand/:key` (multipart/form-data, upsert)
Path `:key` is the normalised key, `encodeURIComponent`-ed by the FE (`p&g` -> `p%26g`; Express decodes params).

| Field | Rule |
|---|---|
| `displayName` | string, "" = automatic (null) |
| `aliases` | JSON array string, e.g. `["cadbbury"]` (multipart has no arrays; one field avoids the 1-vs-many ambiguity) |
| `hidden` | `"true"` / `"false"` |
| `rev` | integer; `0` = "no row yet" (insert), `n >= 1` = update the row at rev n |
| `images` | optional, 1 file, JPEG/PNG (the existing `upload.array("images", 1)` field name) |

Full replace of `displayName`, `aliases`, `hidden`. Logo: a new file replaces it; no file keeps it; removal is 4.3.
Write: `rev 0` -> `insertOne` (`rev: 1`); E11000 on `uniq_brands_key` -> 409 `STALE` (someone created it first),
on `uniq_brands_claims` -> re-run the conflict lookup for the exact 409 code. `rev n` -> `findOneAndUpdate({key,
rev: n}, {$set: {..., claims}, $inc: {rev: 1}})`; a miss re-reads: row gone or rev moved -> 409 `STALE`.
A friendly pre-check (`find({ claims: { $in: [key, ...aliases] }, key: { $ne: key } })` on the primary) gives the
specific 409 code first; the unique index is what actually guarantees it under a race.

Response `200 { msg: "Brand saved", data: { brand: <same row shape as GET> } }`. The FE replaces its row from this
response (does not re-GET; admin reads may lag a second).

Upload detail: the S3 upload runs BEFORE the validator (multer must parse the body first). A router-level error
handler deletes the just-uploaded object (`s3Utils.deleteFromS3`) on any rejected request (403/400/409/503), so
retries do not orphan files. A REPLACED old logo is NOT deleted: cached lists and app caches still point at it for
a few minutes; the old URL is kept in the audit `before`.

### 4.3 `DELETE /admin/brand/:key/logo`  body `{ rev }`
Sets `logoUrl: null`, `rev + 1`. No row -> 404 `NOT_FOUND`. Audit `brand.logo.remove`. App falls back to the
letter badge.

### 4.4 `DELETE /admin/brand/:key`  body `{ rev }`  (reset to automatic)
Deletes the overlay row (frees its aliases). 404 if none, 409 `STALE` on rev mismatch. Audit `brand.reset`.
Needed because "un-merge" and "clean up an orphan row" otherwise have no clean action.

### 4.5 Overlay row whose key no longer exists in products
Kept, harmless, shown under the "Not in catalogue" filter with Reset. It still applies whenever any of its claims
appears: if every "Cadbury" product were renamed but "Cadbbury" items remain, they still show as "Cadbury". If the
key later comes back (new products), its logo and name return automatically.

### 4.6 Audit (`auditUtils.log`, non-blocking like coupons)
| Action | target | before / after | metadata |
|---|---|---|---|
| `brand.update` (insert or update) | `{ displayName: key }` | `{ displayName, aliases, logoUrl, hidden, rev }` (before `null` on insert) | `{ brandKey, logoUploaded }` |
| `brand.logo.remove` | same | logoUrl + rev | `{ brandKey }` |
| `brand.reset` | same | full row / `null` | `{ brandKey }` |
`storeId: null` (global). Readable in the existing Audit Log page.

### 4.7 Logo processing (D9)
Additive option on the shared helper, every existing caller unchanged:
`uploadAndProcessImages_OPTIONAL("brands", { square: 256, background: "#ffffff" })` ->
`sharp(buf).rotate().flatten({ background }).resize(256, 256, { fit: "contain", background }).jpeg({ quality: 80 })`.
Square output = predictable tile rendering; ~10-20 KB per logo instead of ~60-100 KB. JPEG/PNG only (no SVG).
S3 key `uploads/brands/<uuid>-<sanitised name>.jpg`.

---

## 5. Migration, rollback, compatibility, performance

**Migration.** None. Deploy backend; admin boot creates `brands` and its two indexes. Empty collection = Phase 1.
**Rollback.**
- Data only: `db.brands.drop()` (owner runs it) -> Phase 1 output after <= 120 s (cache TTL). Products/items were
  never touched.
- Code revert: safe. `brands` is a new collection (not a new kind of row inside an existing one), so old code
  simply never reads it. Old code reading a v1 cache entry written by new code still works (`toPublicBrand`
  whitelists fields) for <= 120 s.
- Whole feature: `BRAND_SHOP_ENABLED` off, as in Phase 1.
- Uploaded logos stay in S3 (tiny, harmless).

**Backward compatibility (apps).** Same routes, same brand object. What changes in values only: `logoUrl` becomes
a URL for brands with a logo (Android A5 already shows it, falls back to the badge on load failure); `name` may be
the admin's display name; merged brands show a bigger `itemCount`; an alias key in a link returns the target
brand. iOS/web are not live on Business. No Gson risk (all fields already nullable).
**Backward compatibility (backend).** `buildBrandList(rows)` with one argument is unchanged (pinned test).
`s3Utils` helpers with one argument are unchanged (pinned test). No change to products, items, Product Master.

**Performance.**
| Path | Cost |
|---|---|
| Buyer list (cache miss, once per store per 120 s) | + one primary read of `brands` (<= ~450 rows x ~250 B = ~110 KB worst case, ~1 ms server). Merge O(rows + overlay). |
| Buyer list (cache hit) | unchanged |
| Admin GET | 1 products aggregation (2.1k docs) + 1 overlay read + 2 cached list reads. < 100 ms. |
| Admin write | 1 pre-check + 1 write + 1 audit insert + 4 cache DELs (2 stores x 2 views) |

**Failure analysis.** Under load nothing here is hot: the overlay is read once per store per 120 s, writes are a
few per day by one super admin. What degrades: (1) Redis down -> every buyer list request recomputes (aggregation +
overlay read), as in Phase 1, still correct; (2) overlay read fails -> list served without merges/logos/hides and
not cached, so the next request heals; (3) index missing -> brand writes 503, buyers unaffected; (4) primary
unreachable -> overlay read fails -> case 2. **What breaks first at 10x** (20 stores, ~4k keys): the admin GET
payload (~1 MB) — then add server paging and `q`; invalidation becomes 40 DELs (pipeline them). The overlay
read stays small because rows only exist for brands staff touched.

---

## 6. Test plan (backend: in-memory Mongo only; admin web: Vitest)

Backend unit (`user/__tests__/brand.utils.test.js`, extend; `brand-overlay.utils.test.js`, new):
- `buildBrandList(rows)` and `buildBrandList(rows, [])` deep-equal the Phase 1 output (parity pin).
- Alias merge: spellings folded, `itemCount` unions groups (group split across alias + target counts once).
- Name: displayName wins; no displayName -> target-key spellings only; store with only alias spellings.
- Hidden overlay drops the brand; system-hidden raw key never folded in even if a bad row aliases it.
- Bad data: alias claimed by two rows -> smaller target; key with own row listed as another's alias -> ignored.
- `logoUrl` passed through; `toPublicBrand` never leaks `aliasKeys`/`matchKeys`/`spellings`.
- Chips: "cadbb" -> Cadbury via alias; "procter" -> P&G via displayName; entry without `matchKeys` still matches.
- `normaliseInput`: every 400 code in 2.2; aliases sorted, de-duplicated, normalised ("  Cad Bbury " -> "cad bbury").

Backend integration:
- `user/__tests__/brand-overlay.test.js`: `/user/brand` shows merged/renamed/logo/hidden; brand page with alias key
  returns target brand + alias items; hidden brand page -> `brand: null`; overlay read throwing -> list served
  and NOT cached; Phase 1 suites (`brand-shop`, `brand.repository`, `item-search-brand-chip`) still green.
- `admin/__tests__/brand-admin.test.js`: store_admin / manager / support -> 403, super_admin ok; create (rev 0),
  update (rev n), 409 STALE both ways (stale rev; concurrent create); each 409 conflict code; concurrent PUTs
  claiming the same alias via `Promise.all` -> exactly one wins (index proves it); key `p&g` via `%26`;
  `logoUrl` in body -> 403; upload mocked (`jest.spyOn(s3Utils, ...)` as `admin-gaps-upload.test.js`) and
  `deleteFromS3` called on a 409; DELETE logo / reset; audit rows written with before/after; cache keys for both
  stores deleted after a write (spy on `distributedCacheUtils.del`); GET shape incl. `aliasOf`, `systemHidden`,
  `inCatalogue: false`, `rev: 0`.
- `admin/__tests__/brand-index-registration.test.js`: model in `ensureIndexesFor` list; `missingIndexes` clean;
  writes 503 when the spec check fails.
- `s3Utils` options: one-arg call unchanged; with options a transparent PNG comes out white, 256 x 256.

Admin web (Vitest): api client encodes keys; page filters (All / Edited / Merged / Hidden / Not in catalogue /
search); modal: alias picker excludes self, hidden and already-merged keys; 409 STALE -> "Someone changed this
brand, reload" + reload; 409 codes -> field messages; logo preview / remove; non-super-admin cannot see the menu.
Baseline rule: still exactly the 5 known failing OrderDetailsModal tests.

Manual guide: NEW `haper-misc/test-brand-admin.md` (QA owner, same session as the build): merge Cadbbury into
Cadbury and see one tile in the app; rename `pg` -> "P&G"; upload a transparent PNG logo (white, not black);
hide a brand; reset; two tabs editing the same brand -> second gets the stale message; store admin has no menu.

---

## 7. Build slices (each <= 10 min, disjoint files, in order within a lane)

Rules from Phase 1 apply (reuse, minimal comments, grep callers, additive, in-memory tests:
`cd packages/<pkg> && NODE_ENV=test npx jest <file>`).

### Backend — backend engineer

| Slice | Files | Acceptance |
|---|---|---|
| **Backend 1** constants + model | `shared/constants/brand.constant.js` (add `OVERLAY_MAX_ALIASES 20`, `DISPLAY_NAME_MAX 60`, `errorType "BRAND"`, `reasons`, `indexSpecs.brands`); NEW `shared/models/brands.schema.js`; one export line in `shared/models/index.js` | Schema per section 2, indexes declared from `indexSpecs` via `indexOptions`. Existing `brand.utils.test.js` constants assertion still passes. |
| **Backend 2** pure input rules | NEW `shared/utils/brand-overlay.utils.js`; one export line in `shared/utils/index.js` | `normaliseInput({key, displayName, aliases, hidden})` -> value or `{reason, details}`; `claimsFor(key, aliases)`; `conflictReason(key, aliases, otherRows)`. Test NEW `user/__tests__/brand-overlay.utils.test.js`. |
| **Backend 3** merge | `shared/utils/brand.utils.js` only | Section 3.1 + `matchChips` on `matchKeys`. Extend `user/__tests__/brand.utils.test.js` (parity pin first). |
| **Backend 4** list repo | `shared/repositories/brand.repository.js` only | Overlay primary read in `compute` (no-cache on overlay failure), alias `findByKey`, `cacheKeysFor`, `invalidateAll`. Extend `user/__tests__/brand.repository.test.js`. |
| **Backend 5** overlay repo | NEW `shared/repositories/brand-overlay.repository.js`; one export line in `shared/repositories/index.js` | `listAll()` (primary), `save({key, rev, input, logoUrl, admin})`, `removeLogo`, `reset`, `assertIndexesReady`/`verifyIndexes`; E11000 -> codes. Test NEW `admin/__tests__/brand-overlay.repository.test.js` (incl. `Promise.all` race). |
| **Backend 6** logo option | `shared/utils/s3.utils.js` only | Optional 2nd arg `{ square, background }` on both `uploadAndProcessImages*`; no arg = identical. Test NEW `admin/__tests__/s3-image-options.test.js` (sharp only, S3 send mocked). |
| **Backend 7** boot + test harness | `admin/src/connections/mongo.js`, `admin/__tests__/setup.js` | Model in both lists + spec check + `verifyIndexes()` call. Test NEW `admin/__tests__/brand-index-registration.test.js`. |
| **Backend 8** admin GET builder | NEW `admin/src/routes/brand/catalogue.js` | Section 4.1 payload from the three reads. Unit-tested inside the Backend 10 test file or its own `brand-catalogue.test.js`. |
| **Backend 9** routes + validator | NEW `admin/src/routes/brand/router.js`, `validator.js`; mount line in `admin/src/routes/index.js` | `requireRoles([SUPER_ADMIN])`, upload with options, Joi (403 house convention), router-level S3 cleanup error handler, swagger comments. |
| **Backend 10** controller | NEW `admin/src/routes/brand/controller.js` | GET/PUT/DELETE flows of section 4 (write -> audit -> invalidate). Test NEW `admin/__tests__/brand-admin.test.js` (section 6 list). |
| **Backend 11** user-side e2e + docs | NEW `user/__tests__/brand-overlay.test.js`; `docs/reference/brand-shop.md` (Phase 2 section); `.env.example` untouched | Full `packages/user` and `packages/admin` jest green. |

Parallel: Backend 1, 2, 6 together; Backend 3 after Backend 1; Backend 4 after Backend 3; Backend 5 after Backend 1 and 2; Backend 7 after Backend 1; Backend 8-10 after
Backend 4, 5 and 6; Backend 11 last.

### Admin web — admin web engineer (`haper-admin/src`)

| Slice | Files | Acceptance |
|---|---|---|
| **Admin web 1** API + types | NEW `api/brands.ts`, NEW `api/brands.test.ts` | `listBrands()`, `saveBrand(key, {displayName, aliases, hidden, rev, file?})` (FormData, `aliases` as JSON string, `encodeURIComponent(key)`), `removeLogo(key, rev)`, `resetBrand(key, rev)`; `skipStoreHeader: true`; error -> `{reason, details}`. |
| **Admin web 2** list page | NEW `pages/Brands/BrandsPage.tsx` | Search box, filter chips (All / Edited / Merged / Hidden / Not in catalogue / System hidden), rows: badge or logo, name (+ "auto" tag), key, products, per-store Business cards, alias chips, state pills; merged rows read-only "Merged into X". |
| **Admin web 3** edit modal | NEW `pages/Brands/BrandEditModal.tsx` | Display name (prefilled with auto name; required once an alias is added), alias picker from GET keys (excludes self, system-hidden, already merged, keys with own rows -> shown disabled with reason), hidden switch, logo upload preview (JPEG/PNG) + Remove, sends `rev`; 409 STALE -> reload prompt; reason codes -> field errors; helper text "Changes reach the app within a few minutes". |
| **Admin web 4** route + menu | `App.tsx` (route in the super-admin-only block), `hooks/useMenu.ts` (`superAdminOnly: true`, keywords brand/logo/merge) | Store admin sees no menu and is redirected; FE/BE role mirror = super_admin on both sides (no `permissions.ts` change). |
| **Admin web 5** tests | NEW `pages/Brands/BrandsPage.test.tsx`, `BrandEditModal.test.tsx` | Section 6 admin-web list; `tsc -b` + eslint no new errors; Vitest baseline unchanged. |

QA: `haper-misc/test-brand-admin.md` + a row in `haper-misc/client-followups.md` (admin client). Project lead assigns.

---

## 8. Things found while reading (not caused by this feature)

1. **Transparent images turn black** in `s3Utils.uploadAndProcessImages*` (`.jpeg()` with no `.flatten()`),
   verified with sharp 0.35.5. Existing category icons uploaded as transparent PNGs are affected today. Backend 6 fixes
   it for brands only (opt-in); fixing categories is a separate owner call.
2. `uploadAndProcessImages_OPTIONAL` does not sanitise the file name (only spaces), unlike the non-optional one.
   Harmless for S3 but inconsistent; Backend 6 may use the same sanitiser for the new option path only.

---

## 9. Open questions (recommendation first)

1. **Can staff un-hide a system catch-all (e.g. show "Local" as a brand)?** Recommend **no** (D3). Changing the
   hidden list is a code change to `HIDDEN_KEYS`.
2. **Should merges also fix search/category data (rename the products)?** Recommend **no**: the overlay is
   display-only and reversible. Product Master renames (Phase 0) remain the permanent fix; the overlay covers
   pairs that are blocked by size groups or that ops has not cleaned yet.
3. **Show "maybe the same as X" hints on the admin page** (reuse the Phase 0 pair finder)? **Superseded 2026-11-20: built now (Owner decisions, item 3).** Original recommendation was **later**: it
   means moving `findSuspectPairs` out of `scripts/` into `shared/utils`. The 27 pairs fit on one CSV today.
4. **`goldiee` (94) vs `goldie` (5)**: the heuristic cannot tell which spelling is right. Staff decide per pair;
   the alias direction (which is the target) is their choice.
5. **Admin GET paging:** recommend **none until ~2,000 keys** (401 today).

---

STATUS: done
OUTPUT: `brands` overlay design (claims-array unique index, one-function merge, 4 admin routes, 11 backend + 5 admin-web slices); prod copy: 401 visible keys, 27 suspect pairs, 0 wholesale items, 2 stores
NEXT: backend engineer — Backend 1-11 from this file; admin web engineer — Admin web 1-5 (Admin web 1 and 2 can start on a mocked API); a database reviewer after build — `explain()` the list aggregation + overlay read on dev once wholesale items exist

# Implementation plan — product `thumbnail` field (backend + admin + 3 clients)

Author: shavinder (planning). Date: 2026-09-17.
Design source of truth: `haper-misc/product-thumbnail-design.md` (chanchal).
Backend change-site review: rajit-backend-arch (incorporated + re-verified against live files below).

Status: **awaiting user approval**. No code written yet.

---

## 1. Goal

Products get a new, admin-curated `thumbnail` field — one square (1:1) image whose only job is to
be legible in a small product card. Home / listing / search / cart / order card images read it
first; if it is absent they fall back to the first real entry in the existing `images[]` array
(exactly today's behaviour), and only if that is also absent do they show a local placeholder
glyph. The `images[]` array and the item-detail carousel are **unchanged**.

Plain-English example: today the Aashirvaad Atta card shows the same wide packet photo that the
detail page shows, so inside a 94dp square well the packet shrinks and sits off-centre. After this
change a catalogue admin can upload a tight square crop of just the packet; the card shows that.
Until they do, the card looks exactly like it does today.

### Acceptance criteria (testable, user's view)

**Customer (all 3 clients)**
- [ ] A product with a `thumbnail` shows the thumbnail on home / listing / search / cart / order
      rows.
- [ ] A product with no `thumbnail` but with `images[]` shows the first non-blank `images[]` entry —
      pixel-identical to today. (On day 1 this is 100% of the catalogue: 1,955/1,955 products and
      3,909/3,909 item rows already have a real image.)
- [ ] A product with neither shows a local placeholder glyph (no text, no external network call),
      and the card is still fully functional — name, price, Add-to-cart all work.
- [ ] `thumbnail` of `""`, `null`, whitespace-only, or key-absent all behave identically to "no
      thumbnail".
- [ ] A `thumbnail` that 404s shows the placeholder — it does **not** retry into `images[0]`.
- [ ] The item-detail carousel still shows the `images[]` array, manual swipe/click only, no
      auto-rotate, no thumbnail slide — **except** when `images[]` is empty and a thumbnail exists,
      where it shows the thumbnail as one non-swipeable slide with no dots.
- [ ] Card image wells show a neutral shimmer while loading, never a spinner and never a layout
      shift.
- [ ] `haper-web` makes **zero** requests to `via.placeholder.com`.

**Admin**
- [ ] Super admin can upload a thumbnail in Product Master; the crop is locked to 1:1 and the
      1:1/Free toggle is not rendered.
- [ ] Saving fans the thumbnail out to every store's item row (verifiable: the customer app shows
      it in every store).
- [ ] Admin can Replace and Remove the thumbnail; Remove makes the card silently fall back to
      `images[0]`.
- [ ] A status chip shows "Using first image" / "No card image" when the thumbnail is unset.
- [ ] In the per-store Item form the thumbnail is **read-only** for everyone, labelled "Managed in
      Product Master".
- [ ] ItemModal's Images label no longer says "first image is the thumbnail".

**Backend**
- [ ] A master edit that changes only `thumbnail` produces `modifiedCount > 0` on the `items`
      rows.
- [ ] The nightly reconcile keeps item thumbnails in sync with no code change to the job.
- [ ] Every existing API response shape is unchanged apart from one additive, always-optional
      `thumbnail` string.

**Docs**
- [ ] `haper-misc/test-product-thumbnail.md` exists with ✅/❌ steps for all nine §6 design rows.

---

## 2. Current state (verified in the live tree, 2026-09-17)

### Backend — `haper-backend`

| Thing | File | Verified fact |
|---|---|---|
| Master schema | `packages/shared/models/products.schema.js:33` | `images: { type: [String], default: [] }`; neighbours `barcode`/`brand`/`weight`/`description` all use `default: ""`, confirming the `""`-not-`null` convention. |
| Item schema | `packages/shared/models/items.schema.js:64` | `images: { type: [String], default: [] }` — the denormalised copy clients actually read. |
| Fan-out down | `packages/shared/repositories/product.repository.js:50-63` `projectionFieldsFromProduct` | The ONE function feeding `syncToItems`, the on-edit path, item-edit routing and `assignToStores`. |
| Fan-out up | same file, `:28-44` `masterFieldsFromItem` | Used by materialise + new-item create. |
| Materialise projection | same file, `:436-439` | Inclusion projection — any field not listed is silently dropped. |
| API input whitelist #1 | `packages/admin/src/routes/product/validator.js:30-52` `masterFields()` | Joi. |
| API input whitelist #2 | `packages/admin/src/routes/product/controller.js:27-30` `MASTER_INPUT` + `pick()` | Anything not in this array is dropped before the DB write. |
| Item-edit routing gate | `packages/admin/src/routes/items/controller.js:69-72` `MASTER_DISPLAY_FIELDS` | Includes `images`. |
| Change detection | same file, `:77-98` `isDisplayChange` | Default branch is `String(newVal ?? "") !== String(masterVal ?? "")` — **already correct for a plain string field**, no special case needed. |
| Image upload | `packages/admin/src/routes/product/controller.js` `uploadImage` | S3 middleware has already resized/uploaded; the handler just returns `req.fileLocations`. Reusable as-is. |
| Nightly reconcile | `packages/cron/src/jobs/product-master-reconcile.js` | Calls the same `syncToItems` — **no change needed**. |

**Newly verified, and important — no client projection changes are needed anywhere.**
Design §3.2 asked for `thumbnail` to be added to "every client-facing projection that returns
`images`". Checking the live code, every customer-facing item read uses an **exclusion** projection,
not an inclusion one:
- `packages/shared/repositories/item.repository.js:444, 497, 533, 556, 584` → `.select({ __v: 0, createdAt: 0, costPrice: 0 })` etc.
- Order reads: `packages/shared/repositories/order.repository.js:226, 253, 371, 395, 415` → `.populate({ path: "items.itemId", select: "-status -createdAt -updatedAt -__v -costPrice" })`.
- `packages/user/src/routes/**` contains **no** reference to `images` at all.

So once `thumbnail` is on `items.schema.js`, it flows to every client endpoint for free.
The only *inclusion* projections touching `images` are:
- `item.repository.js:617, 653` — admin/warehouse lookups, **explicitly out of scope** (rajit).
- `order.repository.js:2743, 2772, 2899, 2911` — admin analytics (top-selling items), out of scope.
- `admin/src/routes/warehouse/controller.js:233, 534` — warehouse UI, out of scope.

### haper-admin
- `src/components/ImageEditorModal.tsx` — props `{ isOpen, file, onCancel, onApply }` (line 37);
  `aspectMode` state already defaults to `'square'` (line 40); the 1:1/Free segmented control lives
  at lines ~215-232. `react-easy-crop@^6.2.3`, `lucide-react@^0.577.0` already installed.
- `src/pages/Products/productForm.ts:81-86` — `MASTER_DISPLAY_KEYS` = `['name','brand','categoryId','subCategoryId','weight','unit','gstRate','tags','description','dietType']`. Note `images` is deliberately **not** in it (the uploader is gated on `!displayLocked` instead).
- `src/pages/Products/ProductModal.tsx` — master form, uploads images immediately via `productApi.uploadImage`.
- `src/pages/Items/ItemModal.tsx` — per-store form; images are staged and uploaded **on Save as multipart**; line ~741 carries the "first image is the thumbnail" copy.
- Test baseline: Vitest, 273 tests with exactly 5 known-failing `OrderDetailsModal` tests; eslint `.` = 113 problems. "Green" means still exactly those numbers.

### haper-web
- `services/mappers.ts:4-9` — `mainImage = allImages[0] || ''`, assigned to `Product.image`.
- `types.ts:101-129` — `ItemModel`, no `thumbnail`.
- `components/ProductCard.tsx:86-90` — `src={product.image}` with
  `onError={(e) => { e.target.src = 'https://via.placeholder.com/150?text=No+Image'; }}`.
- **`lucide-react@^0.344.0` is already a dependency** (so `ImageOff` needs no new package).
- No eslint gate in this repo (per project memory) — verify with `tsc --noEmit` + `vite build`.

### haper-android (`app/src/main/java/com/bheldi/`)
`data/model/HomeModels.kt:80` and `data/model/OrderModels.kt:432` both hold
`val images: List<String>? = null`. Card/row call sites: `ui/components/ProductCard.kt`,
`ui/components/ProductRailCard.kt`, `ui/components/HaperItemRow.kt`,
`ui/screens/cart/CartScreen.kt`, `ui/screens/orders/OrdersScreen.kt`,
`ui/screens/orders/OrderDetailScreen.kt`, `ui/screens/support/CustomerSupportScreen.kt`,
`ui/screens/itemdetail/ItemDetailScreen.kt` (detail hero).
Gson decodes a missing key to `null`, not the Kotlin default — so a nullable field is safe.

### haper-ios (`haper/`)
- `Models/HomeModels.swift:86-160` — `ItemModel` has `let images: [String]?` (line 94), an explicit
  `private enum CodingKeys` (lines 128-132) **and a hand-written `init(from decoder:)`** (line 140+).
- `Models/OrderModels.swift:392-403` — `OrderItemInfo` has `let images: [String]?` and uses the
  **auto-synthesized** decoder (no CodingKeys).
- Views: `Components/HaperProductCard.swift`, `Components/FeaturedItemsSection.swift`,
  `Views/SearchView.swift`, `Views/CartView.swift`, `Views/ItemDetailView.swift`.

---

## 3. Proposed design

Purely additive denormalised field, mirroring exactly how `images` already works.

```
Admin (Product Master)
   └─ POST/PUT /admin/product  { thumbnail: "<s3 url>" , ... }
        ├─ validator.js  masterFields()   ← must allow `thumbnail`
        ├─ controller.js MASTER_INPUT pick() ← must list `thumbnail`
        ├─ products collection  .thumbnail
        └─ syncToItems → projectionFieldsFromProduct → items.updateMany($set)
                                     │
                                     └─ items collection .thumbnail  (per store)
                                              │
                    exclusion-projection reads (no change needed)
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                web mappers.ts          Android resolver          iOS resolver
                (cardImage)             (util fn)                 (computed)
                    │                         │                         │
              thumbnail → first non-blank images[] → local placeholder
```

Nightly `product-master-reconcile` calls the same `syncToItems`, so it self-heals for free.

### Three design decisions that go beyond the brief

**D1 — web: a NEW `Product.cardImage`, do NOT repoint `Product.image`.**
Design §4.1 suggests filling `Product.image` from the resolver so "every consumer gets it for
free". **That would be a bug.** `pages/ProductDetail.tsx:32` does
`setSelectedImage(mapped.image)` — the detail-page **hero** reads `product.image`. Repointing it
would put the square card crop on the detail hero whenever a thumbnail exists, directly violating
approved decision "thumbnail never appears on the detail screen except case 3".
So: `Product.image` keeps meaning `images[0]` (byte-identical to today); a new
`Product.cardImage: string | null` carries the resolver output, and only card surfaces read it.
`pages/ProductDetail.tsx:78` gets the §6.1 case-3 rule: `images` if non-empty, else
`cardImage ? [cardImage] : []`.

**D2 — ItemModal's thumbnail is read-only for EVERYONE, including super admin.**
Design §5.1/§5.4 wants a super admin to be able to edit and stage the thumbnail in ItemModal.
Checking the live item route: `packages/admin/src/routes/items/validator.js` handles images only
as multipart (line 229-236), so an editable item-level thumbnail would need a new multipart field,
validator branch, upload wiring **and** master-routing of a file — a large amount of new surface for
a field that decision #3 already makes master-owned. Recommend: ItemModal shows a preview +
"Managed in Product Master (super admin)" for all roles, with no upload affordance. The super admin
edits it one click away in Product Master. `MASTER_DISPLAY_FIELDS` still gains `"thumbnail"` as a
cheap defensive guard against any other caller. Listed in Open Questions as Q1 in case the user
wants the fuller version.

**D3 — one resolver per platform, and it takes the "first NON-BLANK entry", not `images[0]`.**
The approved fallback chain says "first non-empty entry in `images[]`", which is stricter than
both today's code and design §4.1's pseudocode (`images[0]`). The resolver must
`firstOrNull { it.isNotBlank() }`, not `first()`. Same on all three platforms.

---

## 4. Data model changes

Two schema edits, no migration, no backfill, no index.

| File | Change |
|---|---|
| `packages/shared/models/products.schema.js` (next to `images`, line 33) | `thumbnail: { type: String, default: "" },` |
| `packages/shared/models/items.schema.js` (next to `images`, line 64) | `thumbnail: { type: String, default: "" },` |

**The landmine:** Mongoose strict mode silently drops unknown paths from `updateMany`. If
`thumbnail` lands only on `products.schema.js`, the admin form will save fine, the master document
will hold the value, and the fan-out `$set` will be **silently discarded** — every customer keeps
seeing `images[0]` forever with no error anywhere. This is why the `modifiedCount > 0` assertion in
§8 is mandatory.

**No index.** Nothing queries by `thumbnail`. The deferred "missing thumbnail" filter (decision #7)
would want one later; do not add it speculatively.

**No backfill.** Per decision #8 the whole catalogue already has real `images[]`, so day-1 behaviour
is visually identical to today everywhere.

**`default: ""` is not retroactive.** Existing documents will emit **no `thumbnail` key at all** until
something writes them (`.lean()` reads skip Mongoose defaults). So every consumer must treat
*missing*, `null`, `""` and whitespace identically — which the resolver already does. Do not write
any code that assumes the key is present.

---

## 5. API contract

No new endpoints. No response-shape breaks.

**`POST /admin/product` and `PUT /admin/product/:id`** (super admin, existing auth)
- Request gains one optional key: `"thumbnail": "<absolute s3 url or empty string>"`, max 500 chars,
  `""`/`null` allowed (= clear the field).
- Omitting the key leaves the stored value untouched (`pick()` skips `undefined`) — so older admin
  builds are unaffected.
- Response: the saved master document, now additionally carrying `thumbnail`.

**`POST /admin/product/upload-image`** — unchanged, reused verbatim for thumbnail uploads.

**All customer item-bearing responses** (home feed, category/aisle listing, search, item detail,
cart hydrate, order list/detail, support) gain an additive optional `thumbnail: string`. Present as
`""` on any document written since the deploy; **absent entirely** on documents not yet rewritten.
No client may require it.

**Per-client decode surface (each must be edited explicitly — none of these is free):**

| Client | Decoder | Note |
|---|---|---|
| Android | `HomeModels.kt:80` area, `OrderModels.kt:432` area | Gson reflection → adding `val thumbnail: String? = null` is sufficient. |
| iOS `ItemModel` | `Models/HomeModels.swift` | **Hand-written `init(from:)` + explicit `CodingKeys`.** Adding the stored property alone is not enough — the key must be added to the `CodingKeys` enum (line ~129) AND a `decodeIfPresent` line added to `init(from:)` (~line 150). Swift will fail to compile if the property is left uninitialised, which is the safety net — but writing `let thumbnail: String? = nil` would compile and be permanently nil. Do not do that. |
| iOS `OrderItemInfo` | `Models/OrderModels.swift:392-403` | Auto-synthesized decoder — adding the property is sufficient. |
| Web | `types.ts` `ItemModel` | `thumbnail?: string` + mapper. |

---

## 6. Build order

Phases 1 → 2 are strictly sequential. Phases 3a/3b/3c/3d run fully in parallel after phase 1 is
**deployed to dev** (`dapi.haper.in`). No file is touched by two specialists.

> Deploy gate: deployment is user-manual. Phases 2-3 can be *written and compiled* against the
> phase-1 code locally, but cannot be *verified end-to-end* until the user deploys the backend to
> dev. Call this out before starting phase 2.

---

### Phase 1 — Backend: schema + fan-out + API whitelists
**Owner: sumit-backend.** Repo: `haper-backend`. Blocks everything else.

1. **Schemas (both, in one change — this is the landmine).**
   - `packages/shared/models/products.schema.js` — add `thumbnail: { type: String, default: "" },`
     next to `images` (line 33).
   - `packages/shared/models/items.schema.js` — add the identical line next to `images` (line 64).
2. **Fan-out, both directions + materialise.** All in
   `packages/shared/repositories/product.repository.js`:
   - `projectionFieldsFromProduct` (~line 50-63): add `thumbnail: product.thumbnail || "",`.
     This single function feeds `syncToItems`, the on-edit path, item-edit routing **and**
     `assignToStores` — it is the only fan-out edit needed.
   - `masterFieldsFromItem` (~line 28-44): add `thumbnail: item.thumbnail || "",`.
   - `materializeMissing`'s inclusion projection (~line 436-439): add `thumbnail: 1,`.
3. **API input whitelists (two separate lists — missing either means a silent no-op).**
   - `packages/admin/src/routes/product/validator.js` `masterFields()` (~line 39, beside `images`):
     `thumbnail: Joi.string().allow("", null).max(500).optional(),`
   - `packages/admin/src/routes/product/controller.js` `MASTER_INPUT` (~line 27-30): add
     `"thumbnail"`.
4. **Item-edit routing guard.**
   `packages/admin/src/routes/items/controller.js` `MASTER_DISPLAY_FIELDS` (~line 69-72): add
   `"thumbnail"`. No `isDisplayChange` special case — the default string branch is already correct.
5. **NOT touched, deliberately:** `packages/cron/src/jobs/product-master-reconcile.js` (inherits
   `syncToItems`), `item.repository.js:594/630`, `pick-task.utils.js:111-123`, every user-package
   route (exclusion projections carry the field for free), and every admin-analytics/warehouse
   inclusion projection.

**Verify:** `cd packages/admin && NODE_ENV=test npx jest` (in-memory Mongo only), plus
`cd packages/cron && NODE_ENV=test npx jest`. New tests per §8 — including the mandatory
`modifiedCount > 0` / re-read-the-item assertion. All existing product/item tests
(`product-master-crud`, `product-master-assign-edit`, `product-master-materialize`,
`product-auto-provision`, `items`, `product-master-reconcile`) must stay green.

---

### Phase 2 — haper-admin: thumbnail slot + editor props
**Owner: tanmoy-web.** Repo: `haper-admin`. Needs phase 1 deployed to dev to verify end-to-end.

> **Split recommendation (answering the caller's question): YES, brief phases 2 and 3a as two
> separate briefings.** Same specialist, but different repos, different verification commands
> (`tsc -b` + eslint + Vitest vs `tsc --noEmit` + `vite build`), different acceptance criteria,
> and — decisively — **phase 3a can start immediately in parallel with phase 2 while phase 2 waits
> on the backend deploy**, which only works if they are separate units of work. Bundling them also
> makes the diff span two repos, which this project's direct-to-dev workflow reviews badly.

6. `src/components/ImageEditorModal.tsx` — add two optional props to `ImageEditorModalProps`
   (line 6) and the component signature (line 37): `aspectLock?: 'square'` and `title?: string`
   (default `"Edit photo"`). When `aspectLock === 'square'`: force `aspectMode` to `'square'` and
   **do not render** the 1:1/Free segmented control (~lines 215-232). Nothing else changes —
   crop, rotate, brightness/contrast, canvas bake, focus/Esc/backdrop, z-index all untouched.
7. `src/pages/Products/ProductModal.tsx` — new thumbnail field **directly above** the Images
   field: 96×96 dashed dropzone when empty / preview + Replace + Remove when set; single-file
   picker (`multiple` OFF); opens `ImageEditorModal` with `aspectLock="square"` and
   `title="Edit thumbnail"`; on apply, upload immediately via the existing `productApi.uploadImage`
   and set `form.thumbnail`; status chip per design §5.3; helper copy per §5.2; states per §5.6;
   a11y per §9 (real `<label>` + `<input type="file">`, `aria-label="Replace card thumbnail"` /
   `"Remove card thumbnail"`).
8. `src/pages/Products/productForm.ts` — add `'thumbnail'` to `MASTER_DISPLAY_KEYS` (line 81-86)
   and include `thumbnail` in the request body builder.
9. `src/pages/Items/ItemModal.tsx` — read-only thumbnail preview for **all** roles (per D2):
   96×96 preview at `opacity: 0.6`, no ⓧ, no Replace/Remove, helper line "Managed in Product
   Master (super admin)." reusing the Barcode field's copy/styling. Also fix the Images label copy
   at ~line 741: drop "first image is the thumbnail", use "(2/3 · shown on the product detail
   screen)".
10. Type additions for `thumbnail` wherever the admin's product/item types are declared (follow
    whatever `images` does in the same file).

**Verify:** `npx tsc -b`, `npx eslint .` (must stay at the 113-problem baseline, no NEW errors),
`npx vitest run` (must stay at exactly the 5 known-failing `OrderDetailsModal` tests).
Manual: upload → crop is locked square with no Free toggle → save → confirm the customer app in a
second store shows it (proves the fan-out).

---

### Phase 3a — haper-web
**Owner: tanmoy-web** (separate briefing from phase 2). Repo: `haper-web`.

11. `types.ts` — add `thumbnail?: string;` to `ItemModel` (~line 110, beside `images`); add
    `cardImage: string | null;` to `Product`.
12. `services/mappers.ts` — add the single resolver (the only one in this repo):
    `thumbnail` non-blank → first non-blank `images[]` entry → `null`, each prefixed with
    `imgBase`. Assign it to `cardImage`. **Leave `mainImage`/`image` exactly as it is today** (D1).
13. `components/ProductCard.tsx` — read `product.cardImage`; **delete the
    `via.placeholder.com` `onError`** (line 90) and replace with a local `ImageOff` glyph from
    `lucide-react` (already a dependency) rendered when `cardImage` is null or the image errors;
    add the shimmer/pulse on the `h-40` well with a 150ms opacity fade-in, reduced-motion aware.
    No geometry changes.
14. `pages/Checkout.tsx` (~line 654) and `pages/Landing.tsx` (~line 229) — switch those card/row
    images to `cardImage` with the same placeholder fallback. (Not in chanchal's §10 table; they
    are card surfaces and must not disagree with the grid.)
15. `pages/ProductDetail.tsx` — §6.1 case 3 only: line ~78 becomes "if `images` is non-empty use
    it, else `cardImage ? [cardImage] : []`"; and case 4 (neither) renders the same placeholder
    glyph at hero size instead of a broken `<img>`. The hero and thumbnail strip otherwise stay
    exactly as they are — still click-to-select, no auto-advance.

**Verify:** `npx tsc --noEmit` and `npx vite build` (no eslint gate in this repo).
Manual: DevTools Network tab shows zero `via.placeholder.com` requests on the home grid.

---

### Phase 3b — haper-android
**Owner: siddhart-android.** Repo: `haper-android`.

16. `app/src/main/java/com/bheldi/data/model/HomeModels.kt` (~line 80) and
    `.../data/model/OrderModels.kt` (~line 432) — add `val thumbnail: String? = null,` beside
    `images`.
17. **One** resolver util (new file, e.g. `.../data/model/ItemImage.kt` or the existing model-utils
    file if one exists): `fun resolveCardImage(thumbnail: String?, images: List<String>?): String?`
    → non-blank thumbnail, else `images?.firstOrNull { it.isNotBlank() }`, else `null`. Plus
    extension overloads for the two model types so no call site inlines the chain.
18. Wire the resolver + Coil `placeholder`/`error` shimmer into:
    `ui/components/ProductCard.kt` (~209), `ui/components/ProductRailCard.kt` (~104),
    `ui/components/HaperItemRow.kt` (~112), `ui/screens/cart/CartScreen.kt` (~811),
    `ui/screens/orders/OrdersScreen.kt` (~408), `ui/screens/orders/OrderDetailScreen.kt` (~773),
    `ui/screens/support/CustomerSupportScreen.kt` (~398). Well geometry, radius, photo caps and
    `.multiplyBlend()` are all unchanged.
19. `ui/screens/itemdetail/ItemDetailScreen.kt` (~378-460) — **only** the two fallback rules:
    case 3 (thumbnail present, `images` empty) → pager over `listOf(thumbnail)` with the dot row
    still hidden because `size == 1`; case 4 (neither) → the placeholder glyph at hero size instead
    of an empty well. Do **not** add auto-rotate; do not add the thumbnail as an extra slide when
    `images` is non-empty.
20. Placeholder glyph: reuse an existing catalogue/basket vector; no new bitmap asset.
    `contentDescription` stays the product name. Shimmer → static fill under reduced motion.

**Verify:** `./gradlew assembleDebug`. Manual walkthrough of design §6 rows 1-6 against dev.

---

### Phase 3c — haper-ios
**Owner: setu-ios.** Repo: `haper-ios`.

21. `haper/Models/HomeModels.swift` — add `let thumbnail: String?` beside `images` (~line 94),
    **add `thumbnail` to the `private enum CodingKeys`** (~line 129) **and add
    `thumbnail = try container.decodeIfPresent(String.self, forKey: .thumbnail)` to
    `init(from:)`** (~line 150). All three edits or the field is silently always-nil.
22. `haper/Models/OrderModels.swift` — add `let thumbnail: String?` to `OrderItemInfo`
    (~line 392-403). Auto-synthesized decoder, so no CodingKeys work here.
23. **One** computed resolver — a single `var cardImagePath: String?` (or a shared free function
    both models call): non-blank `thumbnail`, else first non-blank `images` element, else `nil`.
24. Wire it into `haper/Components/HaperProductCard.swift` (~43), `haper/Components/FeaturedItemsSection.swift`,
    `haper/Views/SearchView.swift` (~327), `haper/Views/CartView.swift` (~97). Replace
    `HaperProductCard.swift`'s `Color.clear` placeholder (~166) with the neutral shimmer block;
    add the SF Symbol `photo` glyph for the null case.
25. `haper/Views/ItemDetailView.swift` (~33-58) — §6.1 case 3 only: when `images` is empty and a
    thumbnail exists, the `TabView` renders that one slide with `indexDisplayMode: .never`. The
    existing `ProgressView` hero placeholder and manual-swipe behaviour stay as they are.

**Verify:** build in Xcode locally. **Never trigger the iOS pipeline or fastlane** (project rule) —
`xcodebuild test` is separately broken by a pre-existing compile error, so do not gate on it.

---

### Phase 3d — docs
**Owner: whoever lands the last client phase** (assign explicitly — most naturally tanmoy-web with
phase 3a, since web is the quickest to demo).

26. New `haper-misc/test-product-thumbnail.md` — ✅/❌ walkthrough covering all nine rows of design
    §6, plus: fan-out to a second store, Remove, the locked-crop check in the editor, the
    read-only ItemModal state, the "zero `via.placeholder.com` requests" network check, and which
    deploys each step needs (backend dev deploy; admin build; app builds).
27. Add the feature row to `haper-misc/client-followups.md` (per-change × per-client tracker) so
    the three client phases are tracked to completion.

**Project rule reminder:** the test doc must land in the **same session** as the build, not after.

---

## 7. Edge cases, risks, backward compatibility

### New risks I am surfacing (not in the brief)

**R1 — web's detail-page hero would silently start showing the thumbnail.** `ProductDetail.tsx:32`
reads `mapped.image`. Following design §4.1's "repoint `Product.image`" advice breaks approved
decision #5/#6. Mitigated by D1 (new `cardImage` field). **This is the single highest-value catch in
this plan** — it would have shipped as a visual regression on every product with a thumbnail.

**R2 — iOS `ItemModel` has a hand-written decoder.** Three coordinated edits are needed
(property + CodingKeys + `init(from:)`). The failure mode of getting it wrong is silent: thumbnails
simply never appear on iOS and everyone blames the backend. Swift's "property not initialised"
error catches the common mistake, but `let thumbnail: String? = nil` compiles and is permanently
nil — call this out in setu's briefing.

**R3 — the first nightly reconcile after deploy will mass-write the whole catalogue.** Adding
`thumbnail: ""` to `projectionFieldsFromProduct` means the next `syncToItems` `$set` genuinely
changes every item row that lacks the key. Expect `modifiedCount ≈ 3,909` in the reconcile job's
log/report instead of the usual near-zero. This is harmless and is in fact how the field gets
populated to `""` — but if anyone watches that number, warn them first. It is also a single
`updateMany` per product, so no load concern at this catalogue size.

**R4 — `default: ""` is not retroactive; the key will be ABSENT, not empty.** `.lean()` reads skip
Mongoose defaults. Until R3's reconcile runs, clients receive no `thumbnail` key at all. Every
resolver must treat missing/null/""/whitespace as one case. This has bitten this codebase before.

**R5 — "first non-blank entry" ≠ `images[0]`.** The approved chain is stricter than the design
doc's pseudocode. If a platform implements `images[0]`, a product whose `images[0]` is `""` shows a
broken-image icon instead of the placeholder. Explicitly write "first non-blank" into all three
client briefings.

**R6 — blank-string truthiness is the single most likely bug.** `thumbnail != null` passes on `""`.
Require `isNotBlank()` / `trimmingCharacters(in:.whitespaces).isEmpty == false` / `.trim() !== ''`
in each resolver, and make it a unit test on all three platforms.

**R7 — deploy ordering.** Clients that ship before the backend is deployed simply see the key
absent and fall back to `images[0]` — safe. The reverse (backend deployed, clients old) is also
safe: the extra key is ignored by Gson, by Swift's `decodeIfPresent`, and by TS. So **there is no
required deploy order**, which is worth saying out loud. But phases 2-3 cannot be *verified*
against dev until the user deploys phase 1.

**R8 — no rollback complications.** Rollback = revert the code; the `thumbnail` column can stay in
the data harmlessly (nothing reads it). No destructive step anywhere in this plan; there is no
migration to undo. The only mildly irreversible thing is admins having curated thumbnails, and that
data survives a code revert.

**R9 — the "phase 2 blocks on deploy" scheduling trap.** If phases 2 and 3a are given to tanmoy as
one briefing, the whole web repo waits on the backend deploy for no reason. Hence the split.

### Backward compatibility — what this touches and how it keeps working

| Existing behaviour | Kept working by |
|---|---|
| Card images everywhere today | Tier 2 of the chain *is* today's behaviour, and 100% of live data hits it (decision #8). Day-1 output is identical. |
| `images[]` array, its order, its editing | Untouched in schema, API, admin and all clients. |
| Item-detail carousel on all 3 clients | Untouched except the two `images`-empty fallback cases. Still manual-only. |
| `item.repository.js:594/630` `image: it.images[0]` (admin lookups) | Explicitly not touched — admin surfaces keep showing `images[0]`. |
| `pick-task.utils.js:111-123` (picker app images) | Explicitly not touched. |
| Nightly `product-master-reconcile` | No code change; it gains the field via `syncToItems`. See R3 for the log-count change. |
| Existing admin product/item save payloads | `pick()` skips `undefined`, so an older admin build that omits `thumbnail` never clears it. |
| Older mobile app builds against the new backend | Unknown extra key: Gson ignores it, `decodeIfPresent`/synthesized Swift decoders ignore it, TS ignores it. |
| `ImageEditorModal` used by the existing gallery flows | Both new props are optional; `undefined` = today's exact behaviour including the Free toggle. |
| Admin Vitest / eslint baselines | Explicit acceptance criterion: numbers stay at 5 failures / 113 problems. |

---

## 8. Test strategy

**Backend — jest, in-memory Mongo only, run from the package dir (`cd packages/admin && NODE_ENV=test npx jest`).**

*Mandatory (this is the assertion that catches the schema landmine — a test that only asserts the
master saved will pass even with the feature completely broken):*
1. Create a master, assign it to 2 stores, then `PUT` a thumbnail-only edit. Assert
   `modifiedCount > 0` on the returned item write result **and** re-read both `items` rows and
   assert each `thumbnail` equals the new URL.
2. Same edit with `thumbnail: ""` → both item rows read back `""` (clearing fans out too).

*Also:*
3. `masterFields()` validator accepts `""`, `null`, a 500-char string; rejects >500.
4. `MASTER_INPUT`/`pick()` — a `thumbnail` in the body reaches the DB; a body **without**
   `thumbnail` leaves the stored value untouched (no accidental clear).
5. `materializeMissing` — an item carrying a thumbnail with no master produces a master whose
   `thumbnail` matches (guards the inclusion projection).
6. `assignToStores` — assigning a thumbnail-bearing master to a new store creates the item row with
   the thumbnail already set.
7. Reconcile (`packages/cron`) — drift an item's thumbnail by hand, run the job, assert it is
   restored from the master.
8. Regression: a master edit that changes only `name` still behaves exactly as before and does not
   blank an existing item thumbnail.

**haper-admin — Vitest + `tsc -b` + eslint.** Unit: `ImageEditorModal` with `aspectLock="square"`
renders no segmented control and crops at aspect 1; without the prop, the control still renders
(regression guard for the gallery). Unit: the status-chip state machine (set / images-only /
neither). Manual/e2e: full upload → crop → save → fan-out visible in a second store.

**haper-web — `tsc --noEmit` + `vite build`.** Unit-test the mapper resolver against all six input
shapes (thumbnail / blank thumbnail / images with a blank first entry / empty images / missing keys
entirely / both absent) if a test runner exists; otherwise a manual matrix in the test doc. Manual:
Network tab proves no `via.placeholder.com`; detail hero still shows `images[0]` when a thumbnail
exists (R1 regression check).

**haper-android — `./gradlew assembleDebug`.** Pure-Kotlin unit test on the resolver util covering
the same six shapes, including blank-string and blank-first-element. Manual: home grid, rail, aisle,
cart, order detail, support screen.

**haper-ios — Xcode build only** (never trigger the pipeline; `xcodebuild test` is pre-broken).
Add a decode test to `haperTests/ItemModelsTests.swift` asserting `thumbnail` decodes from JSON
**and** is nil when the key is absent — that test is the only thing that catches the CodingKeys
landmine (R2).

**Cross-cutting:** design §6's nine rows are the e2e matrix and belong verbatim in
`haper-misc/test-product-thumbnail.md`.

---

## 9. Open questions (decide before build starts)

1. **D2 — is a read-only thumbnail in ItemModal acceptable for super admins too?** Design §5.1 gives
   the super admin an editable slot there. Making it editable requires a new multipart field, an
   item-route validator branch, and master-routing of an uploaded file — real extra scope for a
   field that is master-owned anyway. My recommendation: read-only for all, edit in Product Master.
   **This is the only thing in this plan that changes the approved design; everything else is
   sequencing.**
2. **Which surfaces count as "card" on web?** I have included `Checkout.tsx` and `Landing.tsx`
   alongside `ProductCard.tsx` (they are card/row surfaces and would otherwise disagree with the
   grid). Confirm, or restrict phase 3a to `ProductCard.tsx` only.
3. **Who owns phase 3d (the test doc)?** I have suggested tanmoy-web with phase 3a; it could equally
   be a fifth briefing.
4. **Is anyone alerting on the nightly reconcile's `modifiedCount`?** (R3.) If yes, warn them before
   the backend deploy so a ~3,909-row write does not read as an incident.
5. **Does the 96×96 thumbnail get the same `sharp` 800×800 normalisation as gallery images?** The
   upload endpoint is shared, so yes by default — confirm that is intended for a square crop
   (it should be fine; it only ever downsizes).

---

## 10. Specialist / file ownership summary (no overlap)

| Phase | Owner | Repo | Files |
|---|---|---|---|
| 1 | **sumit-backend** | haper-backend | `packages/shared/models/products.schema.js`, `packages/shared/models/items.schema.js`, `packages/shared/repositories/product.repository.js`, `packages/admin/src/routes/product/validator.js`, `packages/admin/src/routes/product/controller.js`, `packages/admin/src/routes/items/controller.js`, + new tests under `packages/admin/__tests__/` and `packages/cron/__tests__/` |
| 2 | **tanmoy-web** (briefing A) | haper-admin | `src/components/ImageEditorModal.tsx`, `src/pages/Products/ProductModal.tsx`, `src/pages/Products/productForm.ts`, `src/pages/Items/ItemModal.tsx` |
| 3a | **tanmoy-web** (briefing B) | haper-web | `types.ts`, `services/mappers.ts`, `components/ProductCard.tsx`, `pages/Checkout.tsx`, `pages/Landing.tsx`, `pages/ProductDetail.tsx` |
| 3b | **siddhart-android** | haper-android | `data/model/HomeModels.kt`, `data/model/OrderModels.kt`, new resolver util, `ui/components/{ProductCard,ProductRailCard,HaperItemRow}.kt`, `ui/screens/cart/CartScreen.kt`, `ui/screens/orders/{OrdersScreen,OrderDetailScreen}.kt`, `ui/screens/support/CustomerSupportScreen.kt`, `ui/screens/itemdetail/ItemDetailScreen.kt` |
| 3c | **setu-ios** | haper-ios | `haper/Models/HomeModels.swift`, `haper/Models/OrderModels.swift`, `haper/Components/{HaperProductCard,FeaturedItemsSection}.swift`, `haper/Views/{SearchView,CartView,ItemDetailView}.swift`, `haperTests/ItemModelsTests.swift` |
| 3d | tanmoy-web (or separate) | haper-misc | `haper-misc/test-product-thumbnail.md`, `haper-misc/client-followups.md` |

Git workflow for every phase: work directly on `dev`, stage by explicit path, push to `dev`.
No branches, no PRs, `main` off-limits.

# Test: product size variants (one card per product, sizes picked in a sheet)

**Area:** Backend (admin API, customer API, cron reconcile, scripts) + admin FE "Size groups" screen.
Android / iOS / web sections are appended by those lanes later.
- Admin API: `packages/admin/src/routes/variant-group/` (mounted at `/admin/variant-group`)
- Rules: `packages/shared/utils/variant-rules.utils.js`; repo: `shared/repositories/variant-group.repository.js`
- Customer read side: `user/src/middleware/variant-mode.js`, `user/src/utils/present-items.js`, `item.repository.js`
- Scripts: `scripts/migrations/` (`build-variant-indexes.js`, `report-variant-candidates.js`, `seed-variant-groups.js`)
- Design: `haper-backend/docs/plans/product-size-variants.md`

**Database:** `variant-groups` (new, global), plus 3 additive fields on `products` and `items`:
`variantGroupId`, `variantLabel`, `variantRank`. Ungrouped docs never get these keys.

## How it works (plain words)

An admin links products that are the same thing in different sizes (e.g. "Premium Sugar 500 g" and
"Premium Sugar 1 kg") into one **size group**. Each size is still its own item, with its own price,
stock and cart line. For a customer app that opts in, browse and search show **one card** per group;
tapping it opens a sheet listing every size. Old apps, and stores with the switch off, see exactly
what they saw before.

Three things must all be true for a customer to see grouped cards:
1. The store's **Size variants** switch is ON (default OFF).
2. The app sends the header `x-client-features: variants-v1`.
3. The group is active and has at least 2 sizes buyable in that store.

## Prerequisites and DEPLOY ORDER

1. **Indexes first (user-run, dev DB only), BEFORE the cron reconcile change ships:**
   ```bash
   node scripts/migrations/build-variant-indexes.js            # dry run
   node scripts/migrations/build-variant-indexes.js --apply
   ```
   Without `items.idx_items_iid` every per-product sync scans the whole items collection.
2. **Backend** (cron, admin and user on the same `shared` version), switch OFF everywhere.
3. **Admin FE.**
4. Pilot data: report, then groups (see Scripts below).
5. Switch ON for the dev store only.
6. **Clients** (Android, then iOS, then web).

Per-store switch is OFF by default. Prod is user-driven; none of this runs on prod without the user.

## What each PR / deploy needs

| Piece | Depends on | Notes |
|---|---|---|
| `build-variant-indexes.js --apply` | nothing | Run before the cron reconcile change |
| Backend (admin + user + cron + shared) | indexes built | All three processes on one `shared` version; switch OFF |
| haper-admin (Size groups screen, store switch, Product Master badge) | backend live | Super admin sees the badge |
| `report-variant-candidates.js` | backend schema | Read-only; note the masterless count |
| `materialize-products.js` | user decision | Global (all stores), dry run first. Only if the masterless count matters |
| `seed-variant-groups.js` / admin screen | backend + brand fixes | Dev DB only |
| Store switch ON | groups exist | Dev store only first |
| Android / iOS / web | backend + switch ON | Sections appended by those lanes |

## BACKEND + ADMIN walkthrough (dev)

Prereqs: dev store with several in-stock products that share a brand and category, e.g. "Premium
Sugar 500 g", "Premium Sugar 1 kg", "Premium Sugar 5 kg". Roles needed: `super_admin`,
`warehouse_manager`, `store_admin`, `warehouse_staff`.

### A. Size groups: create, edit, dissolve ✅

1. Log in as `super_admin`, open **Size groups**, click **New group**.
2. Search products (type at least 2 letters), add "Premium Sugar 500 g" and "Premium Sugar 1 kg".
3. Name it "Premium Sugar". Labels "500 g" and "1 kg", ranks 1 and 2. Save.
4. ✅ 201, the group appears in the list with 2 members and a coverage table per store.
5. Click Save again without changes. ✅ 200 `unchanged:true`, no duplicate group.
6. Edit: add "Premium Sugar 5 kg" with label "5 kg", rank 3. Save. ✅ Members now 3, `rev` goes up by 1.
7. Open the same group in a second tab, change something in the first tab and save, then save the
   second tab. ❌ Expect 409 `REV_MISMATCH` ("reload").
8. Dissolve the group. ✅ 200 `dissolved:true`; members lose the three keys; dissolving again returns 200.
9. Edit a dissolved group (PUT). ❌ 409 `GROUP_DISSOLVED`.
10. ✅ Each create / update / dissolve wrote an audit row (`variant_group.create|update|dissolve`) with
    before/after members.

### B. Roles ✅ / ❌

| Role | Open screen / call any `/admin/variant-group` route |
|---|---|
| `super_admin` | ✅ allowed |
| `warehouse_manager` | ✅ allowed |
| `store_admin` | ❌ 403 `{error, requiredRoles}` |
| `warehouse_staff` | ❌ 403 |
| `manager`, `support` | ❌ 403 |

The menu item must be hidden for blocked roles too (menu role list and route role list match the API).

### C. Validation blocks (400 `BLOCKED`, cannot save) ❌

Try each; every one must show a clear message and save nothing:
1. **Brand mismatch**: one product with a different brand (or a blank brand, or a trailing-space typo).
2. **Category mismatch**: members with different primary categories.
3. **More than 8** members, or fewer than 2.
4. **Already grouped**: add a product that is in another group. ❌ 409 `ALREADY_GROUPED` listing the conflicts.
5. **Inactive** product, or a product with no master.
6. **Duplicate label** ("1 kg" twice, case-insensitive), empty label, label over 20 characters.
7. **Unit family mismatch** (a weight product with a volume product), non-unique ranks, default size not a member.
8. **Duplicate group name** for the same brand while the other group is active. ❌ 409 `DUPLICATE_NAME`.
   A name freed by dissolving can be reused.

### D. "Save anyway" warnings (422 `NEEDS_CONFIRMATION`) ✅

Each shows a warning list and a **Save anyway** button, which resends with `confirmWarnings:true`:
1. `PRICE_OUTLIER`: one size is priced far out of line per 100 g.
2. `MULTIPACK_NAME`: a member name looks like a multipack ("2 x 500 g", "pack of 3").
3. `SIZE_NAME_MISMATCH`: name says 5 kg but stored weight/unit is "5 g".
- ✅ Without confirmation nothing is saved; with it the group saves and the warning codes stay visible on the group.

### E. Edit guards on grouped products ❌

1. In **Product Master**, change the **brand**, **category** or **unit** of a grouped product.
   ❌ 409 "Remove from size group X first". Same on the Items edit path.
2. Change name, price, images (non-guarded fields) of a grouped product. ✅ Allowed.
3. Hard delete a grouped product (`DELETE /admin/product/:id`). ❌ 409 "Remove it from size group X first".
4. Remove the product from the group (or dissolve), then delete / edit again. ✅ Allowed.
5. Create the same iId as an item in a new store. ✅ It inherits the group keys.

### F. Store switch ✅

1. As an admin with store-config permission, open the store config and turn **Size variants** ON.
   ✅ Saved via the store update (`config.variantsEnabled`), and an audit row `store.config.variantsEnabled`
   records before/after.
2. Turn it OFF. ✅ Another audit row.
3. ✅ Takes effect for customers within about 5 seconds (flag cache TTL), no restart.

### G. Scripts (user-run, dev DB only)

Every script prints the DB host and name first and **hard-aborts** on a prod-looking host/db unless
`--confirm-db=<exact db name>` is given. Confirm the printed target is the dev DB before continuing.

```bash
# 1. Read-only CSV for the pilot store (never writes); note the masterless count in the trailer
node scripts/migrations/report-variant-candidates.js --store=<storeId> --out=variant-candidates.csv

# 2. Seed groups: copy data/variant-groups.example.json, put real iIds/labels from the report
node scripts/migrations/seed-variant-groups.js --file=<your file.json>                # dry run first
node scripts/migrations/seed-variant-groups.js --apply --actor=<admin _id> --file=<your file.json>
```
- ✅ Dry run prints one line per group: `created` / `skipped` (same members already grouped) / `409` /
  `blocked` / `needs-confirmation`. Add `--confirm-warnings` only after reading the warnings.
- ✅ `--apply` needs `--actor` of an existing `super_admin` or `warehouse_manager`; the audit row carries that admin.
- ❌ Without `--actor` the apply is refused. Exit code 1 if any group failed, 2 if aborted before any group ran.
- ✅ Re-running is safe. Undo a seeded group by dissolving it in the admin screen.

### H. Customer endpoints: legacy vs variants

Placeholders: `BASE=https://<dev-api-host>`, `TOKEN=<customer jwt>`, `STORE=<store id>`.
Affected GETs: `/user/home/items/:cat/:sub/:page`, `/user/home/items`, `/user/item`,
`/user/item/search/:query/:page` and `/user/item/:itemId`.

```bash
# Legacy (no header): same payload as before this feature, even with the switch ON
curl -s "$BASE/user/item/?page=1" -H "Authorization: Bearer $TOKEN" -H "x-store-id: $STORE"

# Capable client: grouped cards collapse, switch must be ON for the store
curl -s "$BASE/user/item/?page=1" -H "Authorization: Bearer $TOKEN" -H "x-store-id: $STORE" \
     -H "x-client-features: variants-v1"
```

Expected, switch ON + header:
- One entry per group (the card item) instead of one per size; the response has `Vary: x-client-features`.
- Each entry has `variantGroup` and `variants`; both are `null` for ungrouped items.
- `variantGroup` keys: `_id`, `name`, `optionCount`, `inStockCount`, `showPicker`, `fromPrice`,
  `allSamePrice`, `defaultItemId`.
- `variants[]` rows (sorted by `variantRank`, **include the card item itself**): `_id`, `iId`, `name`,
  `variantLabel`, `variantRank`, `weight`, `unit`, `price`, `sellingPrice`, `discountedPrice`,
  `discountAmount`, `discountLabel`, `appliedDiscounts`, `pricePerUnit`, `quantity`, `lowQty`, `status`,
  `thumbnail`, `images` (first image only). ❌ Never `costPrice`, `description`, `meta` or taxonomy.
- Item detail returns the same two keys, with sold-out siblings included.

Expected, no header, or switch OFF: no `variantGroup` / `variants` keys, one entry per size, and the
raw `variantGroupId/variantLabel/variantRank` keys are stripped. Both must match the previous payload.

### I. Search and sold-out sizes ✅

1. With switch ON + header, search "sugar". ✅ One card for "Premium Sugar"; it is the best-matching size.
2. Search "sugar 1kg". ✅ The card item is the 1 kg size.
3. Search a word that matches nothing. ✅ The recommended fallback is also collapsed; `isFallback` is unchanged.
4. Set one size's quantity to 0. ✅ Its `variants[]` row is still present with `quantity: 0` (the app shows a
   greyed "Sold out" row with no ADD); `optionCount` still counts it, `inStockCount` does not.
5. Make an inactive or unpriced size. ✅ It is absent from `variants[]` and from `optionCount`.

### J. Edge cases ✅

1. **Dissolved group, stale item**: dissolve while an item still carries the id. ✅ Plain card, one warn
   log; the nightly reconcile heals the item.
2. **One size in stock** (`inStockCount: 1`): ✅ `showPicker:false`, the app shows today's single card.
3. **All sizes sold out**: ✅ The group is not listed; detail of a sold-out item stays null as today.
4. **Flag flip**: turn the switch off and on. ✅ Customer responses change within about 5 s; flipping
   mid-scroll shows at most one duplicate or missing card once.
5. **Old app**: ✅ An app that never sends the header behaves identically, switch ON or OFF.
6. **Discount on one size**: ✅ Only that row is decorated; `fromPrice` includes the discounted price.
7. **Cart and checkout**: add two sizes of one group. ✅ Two separate cart lines, each with its own
   quantity cap, price and cart-limit rules (e.g. the 5 L oil max-1 rule); orders list each size separately.
   Cart and order payloads gain at most `variantGroupId`, `variantLabel`, `variantRank` on grouped
   items. The cart `giftOffer`, coupons and offers are never collapsed.

### K. Rollback ✅

1. **Instant**: turn the store's **Size variants** switch OFF (about 5 s).
2. **Data**: dissolve groups in the admin screen (or `DELETE /admin/variant-group/:id`), or leave them;
   they do nothing with the switch off.
3. **Code**: revert the deploy. Dissolve groups first for a clean revert. Audit rows are the only thing
   that is not undone.

## Automated checks (backend)

- `cd packages/user && NODE_ENV=test npx jest variant-additive-keys variant-old-client-snapshot --coverage=false`
- `cd packages/admin && NODE_ENV=test npx jest variant --coverage=false`

## Android

**Status: built, NOT device-tested, NOT released.** No engineer has run this on an emulator or a phone.
The first device QA pass is still needed. Unit tests were reported green by the build lane; this docs
pass did not re-run them.

**Area:** `haper-android` (Kotlin, `dev`). Customer app only. Nothing in this section tests admin, backend or picker.
- Header: `x-client-features: variants-v1` is added in `buildAuthInterceptor()` (`data/api/NetworkModule.kt`).
  It goes on the **main, invoice and print-upload** clients. It is **not** on the token-refresh client.
- Card/sheet logic: `ui/variants/` (`VariantPresentation.kt`, `VariantCardBinding.kt`, `VariantSheetHost.kt`)
  and `ui/components/` (`VariantPickerSheet.kt`, `VariantCardParts.kt`, `VariantTiles.kt`).
- Detail: `ui/screens/itemdetail/ItemDetailScreen.kt`, `ItemDetailVariants.kt`.
- Per-line cap: `util/CartQuantityCap.kt` (`CART_QUANTITY_CAP = 6`).

### Prerequisites

| # | Need | How |
|---|---|---|
| 1 | Dev backend `dapi.haper.in` with the variants code | Per the deploy order above |
| 2 | **Size variants** ON for the test store only | Admin → store config → **Size variants** (`config.variantsEnabled`). Default OFF |
| 3 | At least one group with ≥2 sizes **in stock** at that store | Admin **Size groups** screen, or `seed-variant-groups.js` (dev DB only). Example: "Premium Sugar" with "500 g", "1 kg", "5 kg" |
| 4 | A debug build from `dev` | `./gradlew assembleDebug`, install the debug APK. **NEVER run release builds or fastlane** |
| 5 | A customer account with a resolved store | Used for the normal path (scenarios A–G) |
| 6 | A second install or account with **no store resolved** | Used for the location-prompt path (E2). Clear app data or deny location |
| 7 | An older app build (before this change) on a second device | Used for the old-app check (K1). If you cannot get one, mark K1 **NOT RUN** |
| 8 | A proxy such as Charles or mitmproxy on the test phone | Only needed to confirm the header and the "no refetch" check (G2) |

Fictional names only in this guide. Use the same group in every scenario so results are comparable.

### How a grouped card works (plain words)

- **Card, list, grid:** one card per group. It shows "from ₹X" and "N options". It has no MRP, no % OFF and no size tag.
- **Tap ADD, +, or −** with nothing in the cart (or ≥2 sizes in the cart): the **size sheet** opens.
- **Exactly one size in the cart:** the card's +/− change **that size** directly. No sheet.
- **Sheet:** one full-width row per size. Each row has its own ADD and stepper.
- **Detail:** a row of "Select Unit" tiles. The selected tile drives price, stock and the bottom bar.

### A. Card variants on Home, Aisle and Search

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| A1 | Open a **single-size** product card on Home, Aisle or Search | ✅ Exactly as before this change: MRP, % OFF, per-unit price and size tag shown. ADD → stepper works as today |
| A2 | Find the "Premium Sugar" group card (≥2 sizes in stock) | ✅ "from ₹X" (no "from" if every size costs the same, then plain "₹X"). ✅ No MRP, no % OFF, no per-unit line, no size tag. ✅ ADD button and caption "3 options" (count of sizes) |
| A3 | Make all but one size of that group sold out in admin, then reload | ✅ The card now behaves like a single product (`showPicker` false). It shows that one size's full price line |
| A4 | Make **every** size sold out, then reload | ✅ The group is **not listed** (server rule). ❌ No group card. If a group card ever shows with 0 in stock, it reads "Out of stock" and has **no ADD** |
| A5 | Tap ADD on the group card with nothing in the cart | ✅ The size sheet opens. ✅ Nothing is added to the cart yet |
| A6 | Tap the card's **+** or **−** with nothing in the cart | ✅ Same as A5: the sheet opens |

### B. The size sheet (rows)

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| B1 | Open the sheet for "Premium Sugar" | ✅ Title = group name. ✅ One full-width row per size, each with thumbnail, size label (e.g. "500 g"), current price in ₹ (no decimals) |
| B2 | Look at a discounted row | ✅ MRP struck through. ✅ "N% OFF" chip only when N is 1–70. ❌ No % OFF chip above 70%. ✅ Per-unit price line shown when the size has a weight/unit |
| B3 | Tap **ADD** on the "500 g" row | ✅ Row becomes a stepper showing **1**. ✅ The card caption changes to "1 in cart" |
| B4 | Tap **+** and **−** on that row | ✅ Count goes up and down. ✅ At 1, **−** removes the line and the row goes back to ADD |
| B5 | Look at a row with 0 < stock ≤ low-stock level | ✅ "Only N left" under the price (amber) |
| B6 | Tap ADD and watch the row during the request | ✅ A spinner replaces the control while the request is in flight. ✅ Taps on that row are ignored until it finishes |
| B7 | Look at a **sold-out** row | ✅ Row is greyed. ✅ "Sold out" text. ✅ **No** ADD and **no** stepper. ❌ Tapping the row does nothing |
| B8 | Sold-out row that **is** in the cart | ✅ Code shows "Sold out" and **no** stepper (sold-out check runs first). The bottom bar on detail is different (see G5). **Record what you see**; this is a product decision to confirm |
| B9 | Close the sheet with the round ✕ (top right) or by swiping down | ✅ Sheet closes. ✅ Cart keeps every change made in the sheet |

### C. Cap at 6 per line, cap at stock, server errors

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| C1 | Tap **+** on a row until its count is **6** | ✅ At 6 the **+** is disabled (greyed). ✅ No error text. Per-line cap is 6 |
| C2 | Use a size with stock 3, tap **+** to 3 | ✅ **+** disabled at 3. ✅ No error text. The cap is the lower of stock and 6 |
| C3 | Add a size that the server rejects (e.g. the 5 L oil **max 1** rule from test §J7) | ✅ Red inline error **under that row only** with the server message. ✅ Other rows unchanged. ✅ The error clears on the next tap of that row |
| C4 | Server returns 5xx or the phone is offline, tap ADD in the sheet | ✅ Inline error under the row ("Unable to update cart" or the server text). ✅ Spinner clears. ❌ No global red banner |
| C5 | Cart limit across sizes: put 2 sizes in the cart that together break a server rule | ✅ Server error shown inline on the row you tapped. ✅ The line you added is not kept |

### D. Cart state seen from the card

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| D1 | Add "500 g" ×1 and "1 kg" ×2 from the sheet, then close it | ✅ Card shows **3 in cart** with a stepper. ✅ Card **+** or **−** opens the sheet (two sizes in cart) |
| D2 | In the sheet, remove "500 g" until only "1 kg" is in the cart, then close | ✅ Card **+** now changes **1 kg** directly. No sheet. ✅ Card count = the 1 kg count |
| D3 | With one size in the cart, tap card **+** until that size reaches 6 | ✅ **+** disabled at the cap for that size. ✅ Still no sheet |
| D4 | With ≥1 in cart, tap the card's "N in cart" caption | ✅ Sheet opens |
| D5 | Remove the last size with card **−** | ✅ Card goes back to ADD with the caption "N options". ✅ Cart line gone |

### E. Store switch and location prompt

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| E1 | Open the sheet, then switch to another store (store selector on Home) | ✅ Sheet closes at once. ✅ Cards reload for the new store |
| E2 | No store resolved (deny location). Tap **ADD** on the "1 kg" row in the sheet | ✅ The location prompt sheet opens. ✅ No row error is shown. ✅ After you resolve location, **1 kg** (the **size**, not the group card) is added **once**. ❌ Not added twice. ❌ Not the wrong size |
| E3 | Same as E2, then **cancel** the location prompt | ✅ Nothing is added. ✅ No error |
| E4 | During E2 check which sheet is on top | Record it. The location sheet and the size sheet are both modal; stacking is **not verified** |

### F. Lists: de-dup and keys (Home, Aisle, Search)

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| F1 | Home: scroll until the next page loads | ✅ No group card appears twice. ✅ If a later page holds another size of a group already shown, it is dropped (the first card wins) |
| F2 | Aisle with 40+ items: scroll to the end and back | ✅ No duplicate cards. ❌ No crash (a duplicate list key crashes the screen) |
| F3 | Search "sugar": then search "sugar 1kg" | ✅ "sugar": one card for "Premium Sugar". ✅ "sugar 1kg": the card is the 1 kg size. ✅ Opening the card's sheet lists **all** sizes |
| F4 | Search "sugar", scroll to load page 2 | ✅ No group repeats from page 1 |

### G. Item detail ("Select Unit" tiles)

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| G1 | Open "Premium Sugar 1 kg" from a list | ✅ A horizontal row of size tiles (no heading text in this build, by code). ✅ The **1 kg** tile is selected first (the item you opened). ✅ Row snaps as you swipe |
| G2 | Tap the "500 g" tile | ✅ Price, MRP, % OFF, per-unit, stock text and the bottom bar switch to 500 g. ✅ **No** loading spinner and **no** new item request (check the proxy: no `/user/item/…` call on tile tap) |
| G3 | Tap ADD on the bottom bar for the selected tile | ✅ Only the **selected** size is added. ✅ Cart count goes to 1 |
| G4 | Select a **sold-out** tile | ✅ Tile greyed with "Out of stock". ✅ Tile can be selected (radio). ✅ Bottom bar shows **"Pick another size"** (disabled). ❌ No ADD |
| G5 | Sold-out tile that **is** in the cart | ✅ Stepper stays on the bottom bar (no "Pick another size"). ✅ No "View cart" button on a grouped item (see G6) |
| G6 | Grouped item bottom bar | ✅ **No** "View cart" button. ✅ The **top-right cart icon** still opens the cart |
| G7 | Related rail ("you may also like") under a grouped item | ✅ No size of **the same group** appears in the rail |
| G8 | Related rail shows a **different** grouped card | ⚠ **CODE FINDING.** The rail card is built **without** the picker binding. Expect a plain card (its own price and MRP) and **ADD adds that card's size directly**. It does **not** open the size sheet. Record what you see and confirm the intent before device QA |
| G9 | Open a **single-size** item | ✅ No tiles. ✅ "View cart" button present. ✅ Looks exactly as before |
| G10 | Select the "1 kg" tile, send the app to the background, then kill its process (`adb shell am kill com.bheldi` while it is in the background), and reopen the item | ✅ "1 kg" is still selected. The selection survives process death |
| G11 | Open a grouped item from a **different** entry point (e.g. Search) on a size that is not the default | ✅ Detail starts on the size you opened, not the group default |

### H. Offline and errors

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| H1 | Airplane mode, open the sheet, tap ADD | ✅ Inline error under that row. ✅ No global banner. ✅ Spinner clears |
| H2 | Airplane mode on a grouped detail, tap a tile | ✅ Tile changes locally (no request needed). ✅ ADD on the bar shows an error, not a crash |

### I. TalkBack and accessibility

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| I1 | Focus a grouped card's ADD | ✅ Announced as "Choose size, 3 options" (a button). ✅ With items in cart, the stepper count reads "N in cart across sizes" |
| I2 | Focus a sheet row | ✅ One element: size, price, MRP, % OFF, per-unit, "sold out" if so (e.g. "500 g, ₹31, MRP ₹35, ..., sold out") |
| I3 | Focus a sheet row's stepper | ✅ Actions are "Add one 500 g" and "Remove one 500 g" |
| I4 | Focus the sheet's round ✕ | ✅ Announced as "Close size picker", button role, 48 dp target |
| I5 | Focus a detail tile | ✅ Radio button role. ✅ Selected state announced. ✅ Tiles sit in a selectable group |
| I6 | Change the selected tile | ✅ Price change is announced (polite live region) |

### J. Display: font scale, long names, dark theme

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| J1 | Set font scale to **1.3** (Display → Font size). Check card, sheet, detail | ✅ "from ₹X" and "N options" not clipped. ✅ Sheet row name wraps. ✅ Sheet scrolls once it reaches its height cap (640 dp). ❌ No clipped tiles |
| J2 | Long group name and long size label ("Family Pack Extra Large Value 2 kg") | ✅ Sheet title max 2 lines then "…". ✅ Row label ellipsised. ❌ No overlap with the price |
| J3 | Phone system in **dark** theme | Sheet uses a **fixed light** surface (by code). ✅ Text must stay readable. ❌ No white-on-white. Record the result |
| J4 | Narrow phone (e.g. 360 dp wide) | ✅ Detail tiles scroll sideways and peek the next tile at the edge |

### K. Flag and old apps

| # | Step | ✅ / ❌ Expected |
|---|---|---|
| K1 | Older app build (no header), same store | ✅ Same list as before this change: one card per size, no "options" caption, no sheet. ❌ No picker anywhere |
| K2 | Admin: turn **Size variants** OFF for the test store. Reopen Home (or pull to refresh) within ~5 s | ✅ Lists show one card per size again. ✅ Detail shows no tiles |
| K3 | Admin: turn it back ON, reopen Home | ✅ Grouped cards return |
| K4 | Token refresh (session renewal) on the new build | ✅ Login stays valid. Header is **not** sent on the refresh call (by code: `createRefreshOkHttpClient`). Confirm on the proxy if you can force a refresh; otherwise mark **by code only** |

### L. Automated checks (unit tests)

Run from the `haper-android` folder. Each command runs one slice of the feature.

```bash
# Card binding, row cap, selected variant, group key (truth table)
./gradlew testDebugUnitTest --tests 'com.bheldi.ui.variants.*'

# Card parts (from price, options caption, sold-out caption), tiles
./gradlew testDebugUnitTest --tests 'com.bheldi.ui.components.Variant*'

# Detail helpers (selected row, related rail, "Pick another size")
./gradlew testDebugUnitTest --tests 'com.bheldi.ui.screens.itemdetail.ItemDetailVariantsTest'

# Response decoding (old payload, nulls, rows) and the header on each client
./gradlew testDebugUnitTest --tests '*ApiContractTest' --tests '*NetworkModuleClientConfigTest'

# Home de-dup by group
./gradlew testDebugUnitTest --tests '*HomeViewModelTest'

# Build check
./gradlew assembleDebug
```

- Full unit suite (`./gradlew testDebugUnitTest`): **green**, as reported by the build lane. Not re-run in this docs pass.
- The header test for the main, invoice and print-upload clients is `NetworkModuleClientConfigTest`
  (`main client advertises variants-v1`, `invoice client …`, `print upload client …`). There is **no** test
  that the refresh client omits the header. That part is by code only.

### Edge cases to watch

- A group where two sizes share the same price: the card says "₹X" (no "from").
- A size with a discount above 70%: the % OFF chip is hidden (by code). The price and MRP still show.
- A size with stock equal to its low-stock level: "Only N left" shows in the sheet and on the tile.
- Tapping the same size's ADD twice fast: the second tap is ignored while the first is in flight.
- The store switches while a request is in flight: the sheet closes. Record what the cart shows after it finishes (the backend cart is store-locked).
- A group dissolved on the server: the next list reload shows plain cards (server rule, test §J1).

### NOT verified yet (read before signing off)

1. **No emulator or device run** by any engineer. First device QA is required, on a debug build from `dev`.
2. **Wide-screen tile grid** is not built. Tiles are one horizontal row at all widths.
3. **Detail related rail does not open the sheet** for grouped cards (G8). Confirm the intent before QA.
4. **Sheet cap has no toast.** At 6 or at stock, "+" is just disabled. The only messages are server errors (C3, C5).
5. **Sold-out size that is in the cart:** the sheet hides its count (B8). The detail bar keeps the stepper (G5). Confirm the rule.
6. **Item created outside "assign"** does not inherit its group yet (backend L3 gap, plan §16). An item added by hand in a store is not grouped until it is re-assigned.
7. **Dark theme:** the sheet uses a fixed light surface. Not checked on a device.
8. **Refresh client:** no header by code. No test asserts the absence.
9. **Location-prompt stacking** (E4) with the size sheet open: not verified.

**Android QA status: NOT RUN.** Record the result of each row (✅ / ❌ / NOT RUN) when device QA runs.

## iOS

_Appended by the iOS lane._

## Web

_Appended by the web lane._

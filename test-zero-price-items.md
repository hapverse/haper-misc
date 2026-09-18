# Test: ₹0 (unpriced) items — hidden from customers + admin worklist

**Area:** Backend customer read paths, cart, checkout, admin catalogue filter.
- `packages/shared/utils/item-visibility.utils.js` (NEW — the one price predicate)
- `packages/shared/repositories/item.repository.js` (customer branches + `missingSellingPrice`)
- `packages/shared/repositories/sub-category.repository.js` (tile membership)
- `packages/shared/repositories/category.repository.js` (`getStoreCategoryMeta` + `getAll` tile membership)
- `packages/shared/repositories/cart.repository.js` (`add`, `incrementCounter`)
- `packages/user/src/routes/cart/controller.js` (`buildCartPayload` auto-prune)
- `packages/user/src/routes/order/controller.js` (`prepareOrderItemsAndInventory`)
- `packages/admin/src/routes/pos/controller.js` (counter sale guard)
- `packages/admin/src/routes/items/{controller,validator}.js`
- Admin FE: Items list needs an "Unpriced" filter chip (separate task, not in this change)

**PR/deploy:** backend → `dev` (`dapi.haper.in`); admin FE follow-up → `damin.haper.in`.
**No client-app change** (Android/iOS/web customer apps untouched — deliberately).

## Why
Some catalogue rows are created before pricing is finished (product-master assign
seeds `sellingPrice: 0`; warehouse pricing fan-out fills it in later) and they are
created **ACTIVE**. No customer read path filtered on price, so such an item with
stock rendered on the app at **₹0** and could genuinely be bought at ₹0 — order
lines freeze `salePrice: item.sellingPrice` verbatim. One item was live in prod
(`Indulekha Bringha Shampoo - 100ml`) and 4 past orders already sold at ₹0.
Prod dump: 165 items at `sellingPrice: 0`, 164 of them parked at `quantity: 0`.

## What changed
- **New rule:** to a CUSTOMER, an item with `sellingPrice` missing / `<= 0` behaves
  exactly like out-of-stock — silently absent, never an error. Admin / picker /
  warehouse paths are untouched: ops must still see these rows to fix them.
- Applied to every customer branch of `item.repository.js`: `getPaginated4User`,
  `getDetail4User`, `search4User`, `regexFallbackSearch` (non-admin),
  `getPaginatedItemsBasedOnCatSubCat` (non-admin), `getPaginated`/`getCount`/
  `search`/`searchOld` (non-admin branch only).
- Category/sub-category **tiles** mirror the drill-down: `getStoreCategoryMeta`
  (`itemsCount` / `cheapestPrice`) and the sub-category tile membership now ignore
  unpriced items, so no tile says "from ₹0" or opens an empty list.
- Category **tile list** (`CategoryRepository.getAll` membership) also ignores unpriced
  items, so a category whose only in-stock items are all unpriced is no longer a
  clickable tile that opens an empty drill-down. (Out-of-stock ghost tiles are a
  separate, pre-existing behaviour — deliberately not changed here.)
- **Cart** refuses to add one (stale client/cached listing), drops it on increment, and
  `buildCartPayload` now auto-prunes a line whose price was zeroed AFTER it was added —
  the same silent removal an out-of-stock line already got, instead of a ₹0 row that
  only errored at checkout.
- **POS counter sale** (`POST /admin/pos/sale`) rejects an unpriced item with 400
  `"<name>" has no selling price — fix it in Items before selling`, before any stock
  decrement / ledger row / order insert. This is a real money path, not a display one.
- **Checkout** (`prepareOrderItemsAndInventory`, used by BOTH `placeOrder` and
  `placeScheduledOrder`) rejects an unpriced line with
  `Price not available: <name>. Please remove this item from your cart to continue.`
  (400), checked BEFORE the stock decrement.
- **Admin:** `GET /admin/item/catalog?missingSellingPrice=true` lists exactly the
  unpriced rows (paginated, composes with `q`/store/category filters).
- **Write side:** admin item create + update now reject `sellingPrice` of 0
  (`Joi.number().greater(0)`). Product-master **assign** still allows 0 (assign-then-
  price is a real workflow) and still creates the store row ACTIVE — the warehouse
  pricing fan-out (`updatePricingByBarcode`) only touches ACTIVE rows, so flipping
  them INACTIVE would strand them unpriced forever. They stay invisible to customers
  via the read guard instead.

## Steps — backend jest (in-memory Mongo only)
```
cd packages/user  && NODE_ENV=test npx jest __tests__/unpriced-item-hidden.test.js
cd packages/admin && NODE_ENV=test npx jest __tests__/items-missing-selling-price.test.js __tests__/pos-sale.test.js
```
(If jest dies with a `buffer-equal-constant-time` / `SlowBuffer` error, the default
`node` is too new — run it with node 22: `/usr/local/bin/node ../../node_modules/.bin/jest …`.)
- ✅ user: 15 tests — listing/detail/search/category-drilldown omit the ₹0 item, admin
  variants of the same functions still return it, cart add refused, checkout 400 with
  "Price not available" and stock untouched, priced item checks out at ₹135, a category
  backed only by unpriced items is absent from `GET /user/home/category`, and a cart line
  whose price is zeroed after adding disappears from `GET /user/cart/`.
- ✅ admin `pos-sale`: an unpriced item sale → 400 "no selling price", item quantity
  unchanged, zero StockMovement rows, zero pos orders.
- ✅ admin: 6 tests — `missingSellingPrice=true` returns zero/negative/missing-field rows
  only, paginates, composes with `q`, and the unfiltered catalogue still shows them.

## Steps — dev API (after deploy)
1. Pick an unpriced item id from
   `GET /admin/item/catalog?page=1&limit=100&missingSellingPrice=true` (admin token).
   ✅ Response rows carry name, barcode, price, sellingPrice, costPrice, quantity, status.
2. As a customer on that store: `GET /user/item/<thatId>` → ✅ `data.item` is null.
   `GET /user/item/?page=1` and search → ✅ that item never appears.
3. `POST /user/cart` with that itemId → ✅ 404 "Item not found or out of stock".
4. Give the item a real selling price in admin → ✅ it appears on the app immediately.

## Edge cases
- `sellingPrice` field absent entirely (legacy rows) — treated as 0. ✅ covered.
- Negative price — treated as unpriced. ✅ covered.
- Price zeroed WHILE the item sits in a cart → the line is dropped the next time the
  cart is fetched (no ₹0 row, no manual removal); if the client skips the cart fetch,
  checkout still 400s, nothing charged, no stock decrement. ✅ both covered.
- In-store till (POS) scan of an unpriced item → 400, nothing sold. ✅ covered.
- Category tile backed only by unpriced items → not listed. A tile backed only by
  OUT-OF-STOCK (but priced) items still shows — pre-existing, out of scope.
- Editing an existing ₹0 item in admin: the update validator now demands a real
  `sellingPrice` if the form sends the field, so saving an unrelated change on one of
  the 165 rows requires filling in the price. Intentional — that IS the fix — but it is
  the one visible admin behaviour change; watch for ops complaints.
- The 165 existing rows are NOT rewritten by this change. Fixing them is an ops task
  through the new filter (or a separate, explicitly approved migration).

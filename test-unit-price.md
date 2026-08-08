# Test: unit price on customer product cards ("₹X/kg" comparison price)

**Area:** Backend + web, Android, iOS clients.
Backend: `packages/shared/utils/unit-price.utils.js` (pure calc) + `packages/shared/repositories/item.repository.js`
(calc runs at controller) + `packages/user/src/routes/item/controller.js` (`getAll`, `getDetail`, `search`) + 
`packages/user/src/routes/home/controller.js` (`getAllItems`, `getSuggestedItems`).
Clients: web renders below price on search/category/home; Android and iOS display small muted text in the same spot.
**PR/deploy:** `dev` (`dapi.haper.in`). All clients built in the same change.

## Why
Shoppers can't compare pack sizes across brands from price alone — is a ₹28 70g pack cheaper per-gram than a
₹40 200g pack? The backend now computes a normalised comparison price **once, server-side** (countable → per
piece; weight → per kg or per 100g; volume → per L or per 100ml) so all three clients render the exact same
number without recomputing it themselves.

**The rule that matters most: anything the backend can't confidently parse shows NOTHING, never a wrong
number.** `pricePerUnit` is always present as a key (`{ value, unit }` or `null`) so a missing key never decodes
to a client-side default — but the *value* is only ever set when every guard is satisfied. A messy weight
field ("5g", "0", "217.8/"), an unrecognised unit, or a name that reads like a multipack ("2x70g", "Pack of 2",
"Set of 3") all suppress the field rather than risk showing a number that's wrong.

## Client implementation

The unit price line appears **only on browsing surfaces** — search results, category listings, home-by-category, and suggested items. It sits directly beneath the selling price in small, muted text. Example: a product priced at ₹307 shows ₹61.4/kg on the line below.

**Web:** rendered below the selling price on item cards in search results and category pages.

**Android:** small muted text below the price on item cards in search, category browse, and home surfaces.

**iOS:** small muted text below the price on item cards in search, category browse, and home surfaces.

**Cart and checkout:** deliberately do NOT show the unit price line — only browsing surfaces do.

## The guards (in order)
1. `sellingPrice` must be a finite positive number (never the MRP/`price` field — always what the customer
   actually pays).
2. `unit` must be one of the catalogue's five known units (`unit(s)`, `g`, `kg`, `ml`, `L`) — near-miss
   spellings ("Kg", "kilogram", "litre") are rejected, not guessed at.
3. `name` must NOT match a multipack pattern — see table below. A multipack's `weight` field holds the
   *per-piece* size in some rows and the *whole pack* size in others (unreliable either way), so the whole
   computation is skipped rather than guessed.
4. `weight` must be a strictly plain positive decimal string (`^\d+(\.\d+)?$` after trimming) — `"1e3"`,
   `"0x10"`, `"1,000"`, `"+5"` are all rejected even though plain `Number()` would silently accept them.
5. **Final-value invariant** (closes 3 bugs with one guard): the computed price must be finite, `> 0`, and
   `<= the pack's own sellingPrice`. This catches a sub-gram/sub-ml weight (e.g. 0.5g saffron) that would
   otherwise price HIGHER than the pack itself, a huge weight typo that would round down to a free-looking
   "₹0", and an extreme `sellingPrice` that would overflow to `Infinity`.

## Multipack name patterns (all suppress `pricePerUnit` → `null`)
| Pattern | Examples |
|---|---|
| `Pack of N` / `N Pack` | "Pack of 2", "2 Pack" |
| `Multi Pack` / `Multipack` / `Multi-Pack` | any spacing/hyphen variant |
| `Twin Pack` | |
| `N x M` (compact or spaced, any unit suffix) | "12 x 200 ml", **"2x70g", "6x1kg"**, "12x200ml", "2X70G", "2×70g" |
| Reversed `qty unit x N` | "Frooti 200 ml x 12" |
| `N pcs` / `N pc` / `N piece(s)` | "5 Pcs", "6 Pieces" |
| `Set of N` | "Set of 3" |
| `Buy N Get M` | "Buy 2 Get 1" |
| `N N` (Indian FMCG Nos shorthand) | "Parle-G - 5 N" |
| `combo` | "Value Combo Pack" |

**Does NOT false-positive on:** a bare "Pack" with no digit ("Family Pack Snacks"), "6 X" with nothing after
it, or dimension strings like "Notebook Ruled 21 x 29 cm" / "Garbage Bag 19 x 21 Inch" (these stay suppressed
too — fails safe, not a bug).

## Resilience: corrupted or missing fields (clients)

**The critical behaviour:** if the backend sends no `pricePerUnit` field, sends `null`, or sends corrupted data, the client ignores it and renders the product card exactly as before — no crash, no placeholder, no blank row.

**Android:**
- ✅ Search results: field absent → card renders, no line, no crash.
- ✅ Category browse: `null` → card renders normally, no line.
- ✅ Search results: `value` as a string (`"61.4"` not `61.4`) → no line, card normal.
- ✅ Category browse: corrupted value (`{}`, `[]`, bare number, negative `value`) → no line, card normal.
- ✅ Search results with mixed data: one product has bad `pricePerUnit`, the next product has valid data → first card renders without line, second card shows its line correctly; list does not break.

**iOS:**
- ✅ Search results: field absent → card renders, no line, no crash.
- ✅ Category browse: `null` → card renders normally, no line.
- ✅ Search results: `unit` is an empty string or absurdly long string → no line, card normal.
- ✅ Category browse: `value` is zero or negative → no line, card normal.
- ✅ Search results with mixed data: one product has bad `pricePerUnit`, neighbouring products render correctly → list does not break.

**Web:**
- ✅ Search results: field absent → card renders, no line, no crash.
- ✅ Category page: `null` → card renders normally, no line.
- ✅ Search results: corrupted object (`"garbage"`, `value` missing, `unit` unrecognised) → no line, card normal.
- ✅ Category page with multiple products: one has invalid `pricePerUnit`, others are valid → first card safe, neighbours show their lines; page does not break.

## Steps (backend jest, in-memory — `cd packages/user && NODE_ENV=test npx jest unit-price.utils.test.js item.test.js home.test.js item-search-fallback.test.js`)
- ✅ Worked examples compute correctly and round to 2dp: Atta 5kg @ ₹307 → `{ value: 61.4, unit: "kg" }`;
  eggs 12 @ ₹110 → `{ value: 9.17, unit: "piece" }`; water 10L @ ₹130 → `{ value: 13, unit: "L" }`.
- ✅ **Step-down guard:** a 50ml perfume @ ₹251 would read ₹502/100ml (more than the bottle costs) → steps
  down to `{ value: 5.02, unit: "ml" }` instead.
- ✅ **The critical bug this round fixed** — "Maggi 2x70g" @ ₹28 with `weight: "70"` (the per-cake size, the
  exact ambiguity the multipack guard exists for): before the fix the compact `2x70g` spelling wasn't
  recognised as a multipack, so it silently computed **₹40/100g** — double the real ₹20/100g. Now: `null`.
- ✅ Sub-gram weight (0.5g saffron @ ₹150) → `null`, not ₹300/g (twice the pack price).
- ✅ A huge weight typo (100,000,000g @ ₹25) → `null`, not "₹0/kg" (which reads as free).
- ✅ An extreme `sellingPrice` (1e308) → `null`, not `Infinity` (which `JSON.stringify` would otherwise turn
  into `{"value":null,"unit":"g"}` — a shape no client decoder expects).
- ✅ `calculatePricePerUnit(null)` and `calculatePricePerUnit()` never throw — always `null`.
- ✅ The 10 real prod "bad rows" as of 2026-08-08 (weight `"0"`, various multipack names) all → `null`.
- ✅ `GET /user/item/`, `GET /user/item/:itemId`, `GET /user/item/search/:query/:page` (incl. the no-match
  recommended-items fallback), `GET /user/home/items` (suggested), `GET /user/home/items/:cat/:sub/:page` —
  every response includes `pricePerUnit` on every item, correctly computed for good data and `null` (key
  present) for bad data.
- ✅ Regression: 480+ `packages/user` tests still pass; `costPrice` still never leaks on any of the 5 paths.

## Why ~177 items show no line (not a bug)

About 177 of 1,605 active catalogue items correctly show no unit price line. These are not regressions:

**Multipacks:** The stored `weight` field is unreliable — sometimes it holds the per-piece size, sometimes the whole-pack size. Real examples now suppressed: `Dettol Reg ( 4+1 ) 100 g`, `Margo ( 3+1 ) - 75 g`, `Dettol Handwash 180 + 180 Ml`, `Godrej No-1 sandal Turmeric - (4 Unit x 43gm)`, `Maggi 2x70g`, `Pack of 2`, `Pro-ease XL Sanitary Pad (6Pads)`. Before this was caught, those showed prices 2× to 10× too high — the Dettol 4+1 read ₹3.64/g against a true ₹0.364/g.

**No selling price:** Items currently out of stock with `sellingPrice: null` or zero — around 5 such items. No line, as intended.

**Weight zero or unparseable:** About 10 items have `weight: "0"` or a non-numeric string. These are pending manual correction in the catalogue — no line shown, guards working correctly.

## Denominator may change (expected, not a regression)

The backend may change which unit it uses as the denominator for whole product categories — for example, switching baby formula from `kg` to `100g` to show smaller, clearer numbers. Clients render whatever denominator the backend sends in each response. **If you see a denominator change after a backend deploy, this is expected; you do not need to file a regression.**

## Edge cases / notes
- `pricePerUnit` is computed at the **controller**, not baked into the DB — it reflects the *current*
  `sellingPrice`/`weight`/`unit` on every read, no stale cache to invalidate.
- A hydrated Mongoose **document** (not `.lean()`'d) passed into `attachPricePerUnit` is defensively converted via
  `.toObject()` first — all 5 current callers already use `.lean()`/`aggregate`, so this is a no-op today, but
  protects a future caller that forgets `.lean()` from silently spreading Mongoose internals into the response.
- **Not done (flagged, not built):** suppressing `pricePerUnit` for a countable (`unit(s)`) item whose `weight`
  is `"1"` — e.g. "₹40/piece" on a single ₹40 item is technically correct but adds no comparison value. Left
  as a product-team call, not a bug fix.

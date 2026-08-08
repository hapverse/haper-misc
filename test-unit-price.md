# Test: unit price on customer product cards ("₹X/kg" comparison price)

**Area:** Backend + web, Android, iOS clients.
Backend: `packages/shared/utils/unit-price.utils.js` (pure calc) + `packages/shared/repositories/item.repository.js`
(calc runs at controller) + `packages/user/src/routes/item/controller.js` (`getAll`, `getDetail`, `search`) + 
`packages/user/src/routes/home/controller.js` (`getAllItems`, `getSuggestedItems`).
Clients: web renders below price on search/category/home; Android and iOS display small muted text in the same spot.
**PR/deploy:** `dev` (`dapi.haper.in`). All clients built in the same change.

## Why
Shoppers can't compare pack sizes across brands from price alone — is a ₹28 70g pack cheaper per-gram than a
₹40 200g pack? The backend now computes a normalised comparison price **once, server-side** so all three
clients render the exact same number without recomputing it themselves.

**Denominator rule (business-decided, replacing an earlier magnitude-threshold rule that shipped and was then
reverted): FIXED denominators, no magnitude thresholds, no step-down, no exceptions.**
- weight (`g`/`kg`) → always **per 100g**
- volume (`ml`/`L`) → always **per 100ml**
- countable (`unit(s)`) → always **per piece**

The earlier rule (per kg when ≥1000g else per 100g, same idea for L/ml, with a "step-down" that dropped a
level if the computed value exceeded the pack price) was found to make **16 of 17 live categories show mixed
denominators on one screen** (Snacks showed per-g, per-100g, per-kg AND per-piece side by side) — numbers a
shopper can't compare at a glance, defeating the point of the feature. The fixed rule trades that away: a
small/expensive pack (Nestle Munch, 10g @ ₹4.5) now legitimately shows **₹45/100g**, a unit price *higher*
than the pack price — this is normal and expected (supermarkets worldwide print exactly this), not suppressed.

**The rule that matters most: anything the backend can't confidently parse shows NOTHING, never a wrong
number.** `pricePerUnit` is always present as a key (`{ value, unit }` or `null`) so a missing key never decodes
to a client-side default — but the *value* is only ever set when every guard is satisfied. A messy weight
field ("5g", "0", "217.8/"), an unrecognised unit, or a name that reads like a multipack ("2x70g", "Pack of 2",
"Set of 3") all suppress the field rather than risk showing a number that's wrong. A unit price *higher* than
the pack price is **not** one of these cases anymore — see above.

## Client implementation

The unit price line appears **only on browsing surfaces** — search results, category listings, home-by-category, and suggested items. It sits directly beneath the selling price in small, muted text. Example: a product priced at ₹307 for 5kg shows ₹6.14/100g on the line below (not ₹61.4/kg — see denominator rule above).

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
5. **Final-value invariant** (now only 2 conditions — the 3rd, "must not exceed the pack price", was removed
   when the denominator rule changed to fixed 100g/100ml/piece, since exceeding the pack price is now normal
   and expected, see above): the computed price must be **finite** (an extreme `sellingPrice` can overflow
   `round2()` to `Infinity`, which `JSON.stringify` would silently turn into `{"value":null,...}`) and **> 0**
   (a huge weight typo can round down to a free-looking "₹0").

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
- ✅ Worked examples compute correctly and round to 2dp, ALWAYS on the fixed denominator: Atta 5kg @ ₹307 →
  `{ value: 6.14, unit: "100g" }` (not ₹61.4/kg); eggs 12 @ ₹110 → `{ value: 9.17, unit: "piece" }`; water 10L
  @ ₹130 → `{ value: 1.3, unit: "100ml" }` (not ₹13/L).
- ✅ **No magnitude threshold, at any pack size:** 999g, 1000g, 1001g, 5000g all resolve to `"100g"` — never
  flips to `"kg"`. Same for ml/`"100ml"` vs `"L"`.
- ✅ **The 43% case renders, is not suppressed:** a unit price ABOVE the pack price is normal and expected —
  Nestle Munch 10g @ ₹4.5 → `{ value: 45, unit: "100g" }` (not `null`); a 50ml perfume @ ₹251 → `{ value: 502,
  unit: "100ml" }` (previously step-down-guarded to a near-null-adjacent `5.02/ml` — now renders as-is); a 20g
  saffron sachet @ ₹150 → `{ value: 750, unit: "100g" }`.
- ✅ **The critical bug an earlier round fixed** — "Maggi 2x70g" @ ₹28 with `weight: "70"` (the per-cake size, the
  exact ambiguity the multipack guard exists for): the compact `2x70g` spelling is recognised as a multipack,
  so it stays `null` (never the wrong ₹40/100g a naive gram calc would compute).
- ✅ A huge weight typo (100,000,000g @ ₹25) → `null`, not "₹0/100g" (which reads as free) — the `value > 0`
  guard, now load-bearing on its own with the step-down guard removed.
- ✅ An extreme `sellingPrice` (1e308) → `null`, not `Infinity` (which `JSON.stringify` would otherwise turn
  into `{"value":null,"unit":"g"}` — a shape no client decoder expects) — the `Number.isFinite` guard, likewise
  now load-bearing on its own.
- ✅ `calculatePricePerUnit(null)` and `calculatePricePerUnit()` never throw — always `null`.
- ✅ The 10 real prod "bad rows" as of 2026-08-08 (weight `"0"`, various multipack names) all → `null`.
- ✅ `GET /user/item/`, `GET /user/item/:itemId`, `GET /user/item/search/:query/:page` (incl. the no-match
  recommended-items fallback), `GET /user/home/items` (suggested), `GET /user/home/items/:cat/:sub/:page` —
  every response includes `pricePerUnit` on every item, correctly computed for good data and `null` (key
  present) for bad data.
- ✅ Regression: `packages/user` full suite — 530/530 passing, 24/24 suites (was 526/24 before this round).

## Why ~354 of 3,211 active items show no line (not a bug)

Measured against the local prod-dump snapshot (`prod-dump/haper-prod/items.bson`, 2026-08-08 — offline BSON
analysis, no live DB touched): **2,857 of 3,211 active items (89%) render a `pricePerUnit`; 354 (11%) are
correctly suppressed.** These are not regressions:

**Multipacks (~172 items):** The stored `weight` field is unreliable — sometimes it holds the per-piece size, sometimes the whole-pack size. Real examples suppressed: `Dettol Reg ( 4+1 ) 100 g`, `Margo ( 3+1 ) - 75 g`, `Dettol Handwash 180 + 180 Ml`, `Godrej No-1 sandal Turmeric - (4 Unit x 43gm)`, `Maggi 2x70g`, `Pack of 2`, `Pro-ease XL Sanitary Pad (6Pads)`. Before this was caught, those showed prices 2× to 10× too high — the Dettol 4+1 read ₹3.64/g against a true ₹0.364/g.

**No/invalid selling price (~170 items):** Items currently out of stock or otherwise priced at `sellingPrice: null`/`0`. No line, as intended.

**Weight zero or unparseable (~12 items):** `weight: "0"` or a non-numeric string. Pending manual catalogue correction — no line shown, guards working correctly.

Of the **2,857 rendered** items, **~1,081 (~34% of all active items, ~38% of rendered items)** have a computed
value ABOVE their pack's `sellingPrice` — this is the "43% of the catalogue" case referenced in the plan (that
figure came from an earlier snapshot/scope; both measurements land in the same range and confirm the same
finding: a large minority of the catalogue was being wrongly suppressed under the old step-down rule and now
renders correctly, e.g. every low-gram, high-margin chocolate/spice SKU).

## Denominator is now FIXED — no more "may change per category"

The earlier version of this doc said the denominator "may change per category" as an expected, non-regression
behaviour. That is now false: the rule is fixed at 100g / 100ml / piece for every item, unconditionally. If you
see `"kg"` or `"L"` as a `pricePerUnit.unit` value after this change, that IS a regression — file it.

## Edge cases / notes
- `pricePerUnit` is computed at the **controller**, not baked into the DB — it reflects the *current*
  `sellingPrice`/`weight`/`unit` on every read, no stale cache to invalidate.
- A hydrated Mongoose **document** (not `.lean()`'d) passed into `attachPricePerUnit` is defensively converted via
  `.toObject()` first — all 5 current callers already use `.lean()`/`aggregate`, so this is a no-op today, but
  protects a future caller that forgets `.lean()` from silently spreading Mongoose internals into the response.
- **Not done (flagged, not built):** suppressing `pricePerUnit` for a countable (`unit(s)`) item whose `weight`
  is `"1"` — e.g. "₹40/piece" on a single ₹40 item is technically correct but adds no comparison value. Left
  as a product-team call, not a bug fix.

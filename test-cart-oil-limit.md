# Test: cooking-oil per-order limit (2 L combined, bulk packs 1/SKU)

**Area:** Backend only. `packages/shared/repositories/cart.repository.js` — `SUBCATEGORY_SIZE_LIMIT_GROUPS`
config, `toBaseUnits()` (was `toGrams`), `_limitGroupForSubCategory()`, `_formatBaseUnits()` and the
size-enforcement block inside `add()`. No client change needed: the error already surfaces through the
existing `LIMIT_EXCEEDED:` path (error middleware sets `X-Cart-Notice: LIMIT_EXCEEDED`, HTTP 400).
**PR/deploy:** backend to dev; a deploy is required for it to take effect (no config/DB change).

## What changed
- The old one-subcategory-per-limit `Map` is now a list of GROUPS. One group = several subCategory ids
  sharing one combined cap. Sugar stays **disabled** (still commented out, now as a group of one).
- New group **Cooking Oil**: Mustard Oil (`6679b349d15b89674794a7ba`) + Refined Oil
  (`682a33257b7e8240162cbbf7`), **combined 2 L (2000 ml) per order** across both subcategories.
- **Bulk packs** (item's own pack size ≥ 5000 ml, i.e. 5 L / 15 L) are exempt from the 2 L cap and are
  instead capped at **1 unit per SKU**. Different bulk SKUs are independent (1×5 L + 1×15 L is fine).
  Bulk packs also do not consume any of the 2 L combined budget.
- `toGrams` → `toBaseUnits`: kg/g behave exactly as before; `l/liter/litre(s)` now ×1000 and
  `ml/milliliter(s)/millilitre(s)` ×1. One universal base unit (1 g ≡ 1 ml).

## Steps
- ✅ **Combined cap across the two subcategories.** Cart has 1 L Mustard Oil → add 1.5 L Refined Oil →
  **400** with `LIMIT_EXCEEDED: Max 2 L of Cooking Oil per order (combined). ...`, header
  `X-Cart-Notice: LIMIT_EXCEEDED`.
- ✅ **Exactly at the cap is allowed.** 1 L Mustard + 500 ml Refined + 500 ml Refined = 2000 ml → OK.
  One more 500 ml (2500) → blocked.
- ✅ **Helpful tip.** When some room is left, the message ends with `You can add N more of "<item>"
  (≈ X left in this category).`; when none is left, `You've reached the 2 L limit for Cooking Oil.`
- ✅ **Bulk pack, first unit always allowed.** Empty cart → add 1× "5 L" oil → OK (never hits the 2 L
  block).
- ✅ **Bulk pack, second unit of the SAME SKU blocked.** Add the same 5 L item again → **400**
  `LIMIT_EXCEEDED: Max 1 unit of 5 L Cooking Oil per order.`
- ✅ **Two different bulk SKUs allowed.** 1× 5 L Refined + 1× 15 L Mustard in one cart → both OK.
- ✅ **Bulk packs don't eat the combined budget.** With 1× 5 L + 1× 15 L in the cart, adding a 2 L
  Mustard Oil still succeeds.
- ✅ **Non-oil items untouched.** Any item outside the two oil subcategories (e.g. 5 kg rice ×10) is
  never blocked — Sugar included, since Sugar's group is still commented out.
- ✅ **Nothing else in `add()` changed:** store-switch cart reset (P15), the stock-quantity check and
  the WISHLIST path all behave as before (full `packages/user` jest suite: 1281 passed).

## Edge cases
- **Mislabelled catalog rows behave per their STORED `weight`/`unit`, not their name** — deliberate;
  fixing the catalog is a separate data-cleanup task. Known examples on prod data:
  - "Fortune Refined Oil - 5 Ltr Bottle" stored as `1 L` → treated as 1 L, so it is **not** bulk and
    counts 1000 ml against the 2 L cap (2 of them fill the cap).
  - "Shehnai Mustrad Oil - 15Ltr" stored as `15 g` → 15 base units, not bulk, near-zero against the cap.
  - "Mahakosh Refined Oil - 500 ML" stored as `375 ml` → counts 375 ml.
- Missing/unparseable `weight` → 0 base units: the item never trips the combined cap and is never bulk.
- The cap uses the item's **primary** `subCategory` (derived from `taxonomy[0]`). An oil item whose
  primary pair is some other category (multi-category item) is NOT capped — see follow-ups.
- Quantity decrements (`quantity <= 0`) skip the whole check, so users can always remove items.

## Not covered / follow-ups
- **Checkout is not re-validated.** The cap is enforced at add-to-cart only; a cart built before this
  ships (or via `incrementCounter`, which has no size check) can still exceed 2 L at checkout.
- **Multi-category items**: only the derived primary subCategory is matched, matching the pre-existing
  Sugar behaviour. If oil SKUs start being tagged with oil as a secondary pair, the cap will miss them.
- **Sugar stays disabled** — re-enabling it is a separate decision; the commented group entry is ready.
- No client-side copy/UI work: apps just render the API error message.

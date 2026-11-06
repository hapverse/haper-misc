# Print page (Android) - empty-state redesign + price-breakdown fix

Owner sample: Print documents empty state with an orange accent. Mockups: `haper-misc/design-print-page-samples.html` (variants A/B/C + D).
**Recommendation: Variant A + fix D.** Everything below is variant-agnostic unless a line says "B only".
Platform: haper-android only. iOS/web print screens (`test-print-customer-ios.md`, `test-print-customer-web.md`) are NOT in scope - decide parity separately.

## 1. Flow (unchanged)
1. Home Print tile -> Print documents (empty state).
2. User ticks consent -> taps Choose file -> system picker (PDF/JPG/PNG from `allowedTypes`).
3. Upload -> file card + preview + options + price breakdown + sticky "Total / Continue" bar (D).
4. Continue -> Review/checkout. Exits: back (discard dialog if a file exists), upload error card, offline banner.

## 2. Layout - empty state (top to bottom, 16dp side padding, 12dp gap; unchanged scroll column)
| # | Element | Spec |
|---|---|---|
| 1 | Top bar | Existing `HaperTopBar("Print documents", onBack)` - unchanged |
| 2 | Hero | Existing `EmptyHero`: 92dp well, 30dp radius, `SurfaceSunken`, Print icon 44dp `GreenPrice`; title 21sp Quicksand Bold `InkPrimary`; line 1 13sp `InkSecondary`; line 2 "Word file? Save it as PDF first." 12.5sp **`InkSecondary`** (was `InkTertiary`, fails AA) |
| 3 | Consent | Existing `ConsentRow` - unchanged (48dp min row) |
| 4 | Choose file | Existing `HaperPrimaryButton`, Green accent, 54dp, leading upload icon 20dp. **B only:** new accent (see section 3) |
| 5 | Caption(s) | "Tick the box to choose a file." (when unticked) + "Black & white, A4. Delivered to your door." 11.5sp, **`InkSecondary`** (was `InkTertiary`) |
| 6 | **NEW Rate card** | `PrintPanel` (existing). Row: 56dp well (`SurfaceSunken`, 18dp radius, B&W printer icon 30dp `InkPrimary`), 14dp gap, column: "Black & White" 14sp Quicksand Bold `InkPrimary`; figure "₹2" 34sp/38 Quicksand Bold + " / page" 14sp `InkSecondary`; chip row (6dp gap, 8dp top): "Double-sided ₹1.50 / page", "A4" |
| 7 | **NEW Minimum strip** | 16dp radius, `SurfaceMint` fill, 1dp white border, 10/14dp padding, min 48dp. 22dp dot `GreenPrice` (C: `AuthEyebrow`) with white "i". Line 1 13sp Medium `InkPrimary`; line 2 11.5sp `InkSecondary` |

Colour card: **hidden** (not rendered at all). Do not build the C "Coming soon" tile.

## 3. Tokens (all existing, `ui/theme/Color.kt`)
- Price figure (34sp bold): `AuthEyebrow` #C2691A (same hex as `AddButtonDeep`) - large text only. **B only:** `GreenPrice`.
- Any orange text below 18.7sp bold (chips, "₹1.50"): `SaveChipInk` #A85212 on `SaveChipSurface` #FDF0E3, 1dp `SaveChipOutline` - the existing SAVE-chip pair. Chip 11.5sp SemiBold, 4/10dp padding, pill. **B only:** chips become `SurfaceChip`/`GreenAction`.
- Never use `AddButtonMid` #E58124 or `AddCtaMid` #EE8B33 as text, or under white text.
- **B only:** new `HaperButtonAccent.AmberDeep` = 150° `AddButtonDeep` -> `SaveChipInk`, shadow `AddButtonShadow`. Must be a NEW enum value; do not edit the existing `Amber` ramp (item-detail Add to cart uses it - note: that existing button's white label is 2.51:1, a separate pre-existing a11y bug).

Contrast (computed): #C2691A on card 3.74-3.94 (large text pass); #A85212 on white/chip 5.41/4.83; white on B ramp mid 4.59; `InkSecondary` on SurfaceApp/SurfaceMint 4.92/4.56; `InkTertiary` captions today 2.41 (fail -> fixed).

## 4. Copy and data binding (numbers from `PrintConfig`; wording is app copy - config has no copy fields)
| Copy | Source | Show when |
|---|---|---|
| "₹{single} / page" | `pricePerSideSingle` via `formatPrintMoney` | single != null && > 0 |
| "Double-sided ₹{double} / page" | `pricePerSideDouble` | double != null && double < single (same rule as the existing hint in `PrintPriceSummary`) |
| "A4" chip | `paper` | paper not blank |
| "Minimum order ₹{min} · about {n} pages" | `minimumOrderAmount`; n = ceil(min / single) | min != null && > 0; drop " · about n pages" if single missing |
| "Delivery ₹{d} per order" / "Free delivery" | `printDeliveryCharge` | d != null (0 -> "Free delivery") |
| "Up to {mb} MB and {pages} pages" | existing `fileSizeLimitMb`, `pagesLimit` | always (has defaults) |

"page" here = one printed side (billing unit is per side; single-sided page = side).

## 5. States
- **Config loading:** existing `ConfigSkeleton`; add one 96dp-tall skeleton block for the rate card + one 48dp strip block so nothing jumps when config lands.
- **Config failed (no config):** existing `ConfigRetry` - unchanged.
- **Config loaded but price fields null:** hide rate card AND minimum strip; rest of the screen works. Never show "₹0" or a default price.
- **Printing disabled (`!isEnabled`):** existing `HaperEmptyState` - unchanged.
- **Offline:** existing banner; Choose file disabled (existing); rate card + strip still show.
- **Consent unticked:** existing behaviour (tap scrolls to consent + hint line).
- **Colour:** never rendered.
- **D - quote loading:** existing 0.6 alpha dim applies to the new rows too. Quote failed: existing sticky-bar error; panel hidden (existing `vm.quote?.let`).

## 6. Fix D - Options screen price breakdown
> **Status (checked 2026-10-27): already in the haper-android working tree, uncommitted (parallel WIP)** - `PrintScreen.kt` passes `showDeliveryAndTotal = true, showTotal = true`; `PrintComponents.kt` has the "Delivery charge" row (hidden when 0 via `PrintLogic.shouldShowDeliveryRow`) and a `showTotal` bold row (default false, so Review's own Total is not doubled). Use this section as the acceptance check. Only gap vs this spec: the 1dp divider above Total.


Order: `4 pages x 1 copy | 4 sides` / `Rate (single-sided) | ₹2 / side` / `Printing | ₹8` / `Minimum order top-up | ₹12` / helper "Minimum print order is ₹20." / **`Delivery charge | ₹20`** / `Includes GST (n%)` if gst > 0 (existing) / 1dp `BorderHairline` divider, 8dp margins / **`Total | ₹40`** bold (existing `PriceRow(bold = true)`) / double-sided hint (existing).
- Values: `quote.deliveryCharge`, `quote.total`. Never add up on the phone - Total must equal the sticky bar, which already reads `quote.total`.
- Label "Delivery charge" (WIP already uses it; Review screen shares the row, which is fine).
- Delivery 0 -> row hidden (WIP rule). Acceptable; Total still matches the bar.

## 7. Accessibility
- Rate card: one merged node, contentDescription "Black and white printing, 2 rupees per page. Double-sided 1 rupee 50 paise per page." (build from the same numbers). Not focusable as a button (no click).
- Minimum strip: merged node "Minimum order 20 rupees, about 10 pages. Delivery 20 rupees per order." Icon `contentDescription = null`.
- Price breakdown Total row: `heading()` semantics not needed; ensure rows read label then value (Row merge).
- Targets: back 48dp (existing), consent row 48dp, Choose file 54dp, Replace 48dp. Font scaling 200%: rate-card chips wrap (FlowRow), figure never truncates.
- Focus order: back -> hero text -> consent -> Choose file -> captions -> rate card -> strip.

## 8. Code changes (haper-android)
- `ui/screens/print/PrintScreen.kt`: `EmptyHero` caption colour; after the Choose-file captions (inside `if (!hasFile)`) add `PrintRateCard(config)` + `PrintMinimumStrip(config)`; skeleton blocks in `ConfigSkeleton`. (D's flag flip is already in WIP.)
- `ui/screens/print/PrintComponents.kt`: new `PrintRateCard`, `PrintMinimumStrip` (use `PrintPanel`, `formatPrintMoney`); D: only add the 1dp divider before the `showTotal` row (rest is in WIP).
- **B only:** `ui/components/HaperButton.kt` new `AmberDeep` accent (shared file - grep all `HaperButtonAccent` callers).
- No backend/admin change for A/C/D. Colour printing would need backend (colour rate in config, quote, order validation) + admin setting first.
- Update `haper-misc/test-print-customer-android.md` (rate card values follow admin config; null price hides card; D total matches bar).

## 9. Effort
A: ~0.5 dev-day Android (two small composables + caption colours + skeleton). D: ~15 min left (divider) on top of the WIP. B adds ~0.5 day (shared button accent + regression check). C not recommended.

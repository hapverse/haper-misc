# Print entry points: APPROVED, AS BUILT (haper-android, dev d928f9a)

Source of truth is the code: `HomeScreen.kt` (`WalletPrintRow`, `WalletStrip`) and `ui/screens/print/PrintComponents.kt` (`printEntrySurface`, `PrintEntryTile`, `PrintEntryCard`). Replaces the lost 4-option comparison and HTML samples.

## 1. Home: wallet + Print row (under the promo carousel)
```
 16dp top padding
 +------------------------------------------+ 10dp +---------+
 | (wallet) Wallet  Rs 120.00          >    |      |   [P]   |
 | subtitle, one line, ellipsised...        |      |  Print  |
 +------------------------------------------+      +---------+
        weight(1f), fills remaining width          square, ~64dp
```
- Row: `Arrangement.spacedBy(10.dp)`, `padding(top = 16.dp)`, `height(IntrinsicSize.Min)`.
- Wallet card: `weight(1f).fillMaxHeight()`, `singleLineSubtitle = true` (subtitle ellipsised to one line), chevron kept.
- Tile: `fillMaxHeight().aspectRatio(1f, matchHeightConstraintsFirst = true)`. Same height as the wallet card, so about 64dp, and it grows with font scale.
- Tile surface (`printEntrySurface`): `SurfaceMint` (0xFFE7F3EC) fill, `1.dp` `WhiteBorder90` border, `glassRowShadow` (same as wallet), shape `RoundedCornerShape(HaperDimens.sheetLargeCardMax)` = 21dp.
- Content: `Icons.Outlined.Print` 24dp + "Print" 13sp Bold, both `GreenDeep` (0xFF20654E). Text `maxLines = 1`, `softWrap = false`, `padding(top = 3.dp)`. Tile `padding(6.dp)`, centred column.
- No price, eyebrow or subtitle. No entrance animation.
- Tap calls `onPrintClick` (opens the print route).
- Print off (`showPrintTile = false`): tile is not composed, no gap, `WalletStrip` is `fillMaxWidth()` as before.

## 2. Stationery aisle: `PrintEntryCard`
- Full width, same `printEntrySurface` (mint fill, white border, 21dp, shadow). `padding(horizontal 15.dp, vertical 13.dp)`, `spacedBy(12.dp)`.
- Filled `Icons.Default.Print` 24dp `GreenDeep`; "Print documents" 14sp Bold `GreenDeep`; subtitle "Upload a PDF or photo. We print it and deliver it." 11.5sp `InkSecondary` (0xFF5A7268), `padding(top = 2.dp)`; chevron `KeyboardArrowRight` `GreenDeep`.
- `pressScale(PressScaleDefaults.Card)` + ripple.

## 3. States and a11y
- Default; pressed (`pressScale` `PressScaleDefaults.Button` on tile, `Card` on aisle card, plus ripple); print-off (tile absent); font-scale up (tile and wallet grow together, "Print" never wraps).
- No loading, error or disabled state: a static entry. The destination screen owns those.
- TalkBack: tile reads "Print documents, button" (`contentDescription` + `Role.Button`; icon and "Print" text hidden from semantics); `onClickLabel` "Open print documents". Min size 48x48dp (`defaultMinSize`).

## 4. Contrast finding
`InkTertiary` (0xFF93A79C) on white is about 2.55:1, which fails AA (4.5:1 for small text). So the Stationery card subtitle uses the darker `InkSecondary`, not `InkTertiary`. Do not use `InkTertiary` for the subtitle copy.

## 5. Options considered and rejected
- Bold green promo card: too loud, competes with the carousel.
- Services tile row: heavier, implies more services than exist.
- Carousel slide: easy to miss and rotates away.
- Search-bar chip: cramped and low discoverability.
Owner chose the compact tile beside the wallet, icon + "Print" only.

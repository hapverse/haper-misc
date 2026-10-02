# Map Picker screen — pin + recenter button polish

Screen: `MapPickerScreen.kt` (Android) / `MapPickerView.swift` (iOS) — the full-screen
"drag the map to place the pin on your exact gate/door" location confirmation screen,
opened from Add/Edit Address. This spec covers ONLY the two elements the user flagged:
the fixed center pin and the "use current location" button. Nothing else on this screen
changes.

Read against current code:
- Android: `haper-android/app/src/main/java/com/bheldi/ui/screens/address/MapPickerScreen.kt`
- iOS: `haper-ios/haper/Views/MapPickerView.swift`
- Brand colors: `haper-android/app/src/main/java/com/bheldi/ui/theme/Color.kt`,
  `haper-ios/haper/Utils/HaperColors.swift` (hexes match 1:1 across platforms already)

## Color update (2026-09-08) — orange replaces green, button moved higher

**CORRECTION (same day):** the first pass of this note specified a newly-invented hex
(`OrangeAction` #D84315). The user asked for "my theme orange," meaning the app's OWN
existing amber/orange accent, not a new one. Both platforms already define it —
`AuthFocus` in `haper-android/.../theme/Color.kt` and `authFocus` in
`haper-ios/.../HaperColors.swift`, both `#E58124` — already used for the auth focus ring
and the "add to cart" button gradient's mid stop. **Use this existing token, do not add a
new color.**

Two follow-up changes to this already-implemented spec, both amended in place below:
1. **Pin fill and recenter-button fill both change from green to the existing `AuthFocus`
   / `authFocus` token, #E58124`** (a single hex used for both elements — replaces
   `GreenDeep` #20654E on the pin and `GreenAction` #257056 on the button). Reference the
   existing color constant/token in code — do not hardcode a new hex or add a new token
   name. Everything else about the pin and button — size, ring/dot treatment, shadows,
   states, animation — is unchanged; this is a color swap only. The ground-contact shadow
   ellipse under the pin **stays neutral black**, unchanged. White icon/ring on `#E58124`
   is ≈3.3:1 contrast — still clears the WCAG 3:1 minimum for UI components/icons, just
   with less margin than the earlier (wrong) #D84315 pick; no action needed, just noting
   it for the record.
2. **Recenter button moves higher**: its gap above the bottom confirm sheet increases from
   16dp/16pt to **72dp/72pt** (all other margins/placement unchanged — still bottom-right,
   still 16dp/16pt from the trailing edge).

## Current state (baseline, confirmed by reading the code)
- **Pin**: a single-color filled system glyph — Android `Icons.Default.LocationOn` tinted
  `GreenPrice` (#2F8163), 48dp, no stroke, no shadow, no ground contact point. iOS uses SF
  Symbol `"mappin"` at 38pt, `greenAction` (#257056), `shadow(radius: 2)`, and — notably —
  already has a **continuous idle float animation** (bobs up/down forever, 1.6s ease-in-out,
  independent of drag state). This constant motion is not a settle cue, it's just motion;
  it also isn't on Android, so the two platforms don't match today.
- **Recenter button**: Android is a 44dp white square-ish tile (`mapControlShadow`, corner
  radius 15dp) positioned `Alignment.CenterEnd` (vertically centered, right edge) — not
  bottom-right as described. iOS is a 36pt white circle (10pt padding + 16pt icon), positioned
  **top-right next to the back button** — also not bottom-right. Both use plain white fill,
  `GreenPrice`/`greenAction` icon tint, and a soft `shadow(radius: 2)`/`mapControlShadow`.
- Neither platform has a loading state on the recenter button — `useCurrentLocation()` /
  `locationManager.requestLocation()` fire-and-forget with no visual feedback until the
  camera jumps.

## 1. Center pin — redesign

**Keep using the platform's built-in teardrop glyph** (Android `Icons.Filled.LocationOn`,
iOS SF Symbol `"mappin"`) as the base silhouette — both already render a proper teardrop,
so this is a re-treatment, not a new vector asset. Layer on:

| Layer | Spec |
|---|---|
| Fill color | **`AuthFocus`/`authFocus` #E58124** (existing theme token — replaces `GreenDeep` #20654E — see "Color update" note above; do not introduce a new color constant) |
| Ring | 1.5dp/1.5pt solid white stroke around the teardrop outline — gives it a "badge" quality and keeps it legible over both light-green and busy map areas |
| Inner dot | A small white filled circle, 12dp/12pt diameter, centered in the head of the teardrop (~1/3 down from the top) — this is the "eye" that makes the pin read as precise/branded rather than a stock marker, and doubles as a focal point for the user's real target |
| Size | 44dp/44pt height, tip-anchored to the exact screen center (same anchoring math as today: full glyph height offset upward by half its height so the *tip*, not the glyph's visual center, sits on the true coordinate) |
| Pin elevation shadow | Soft drop shadow under the whole glyph, 4dp blur / 25% black opacity, y-offset 2dp — separate from the ground shadow below |

**Ground contact shadow (new element)** — a small ellipse fixed to the map surface directly
below the pin tip, at the *exact* map-center coordinate (it does not move when the pin lifts):
- Size: 16dp/16pt wide × 6dp/6pt tall, soft-edged (radial blur), color black at 18% opacity.
- Purpose: this is what sells "the pin is hovering above one exact point" — Uber/Swiggy/Google
  Maps all use this pattern. Without it a lifted pin just looks like a bigger pin.
- **Stays neutral black, unchanged by the orange swap.** This is a physical ground shadow, not
  a brand-colored element — every reference pattern (Uber/Swiggy/Google Maps) keeps it neutral
  regardless of pin color, and a tinted shadow would read as a glow/halo instead of a shadow.
  Do not recolor it.

### States

| State | Trigger | Behavior |
|---|---|---|
| **Settled** (default) | Map idle | Pin sits at rest, scale 1.0, tip flush with the ground ellipse. Ground ellipse full size/opacity. |
| **Dragging** | Map camera is actively moving (continuous camera-change callback firing) | Pin **lifts** 8dp/8pt further up (added to its resting offset) and scales to 1.06; elevation shadow softens/grows slightly. Ground ellipse shrinks to 70% width and fades to 12% opacity — reads as "the pin has risen away from the ground." No color change. |
| **Settle** | Map camera stops moving; debounce ~150ms of no movement | Pin drops back to resting position with a small spring **overshoot bounce** — this is the "map has settled, this is your point" confirmation cue. Duration/curve: Android `spring(dampingRatio = 0.55f, stiffness = 380f)` (Compose `Spring.StiffnessMedium`-ish, tuned for a visible but quick bounce); iOS `.spring(response: 0.32, dampingFraction: 0.55)`. Ground ellipse returns to full size/opacity in sync (same duration). |
| **Reduce Motion** | OS accessibility setting on | Skip the bounce and the lift/shrink entirely — snap directly between settled/dragging states, only cross-fade the ground ellipse opacity over 120ms linear. |

Remove iOS's current perpetual idle-float animation — replace it with the drag/settle-driven
behavior above so both platforms match and the motion always *means* something (idle vs.
moving vs. just-landed) instead of looping forever regardless of user action.

## 2. Recenter ("use current location") button — redesign

| Property | Current | New |
|---|---|---|
| Size | Android 44dp / iOS ~36pt | **52dp (Android) / 48pt (iOS)** — circle |
| Fill | Plain white | **Solid `AuthFocus`/`authFocus` #E58124** (existing theme token — replaces `GreenAction` #257056 — same hex as the pin fill above, see "Color update" note above; do not use the primary-button gradient here, that gradient is reserved for the main CTA and would compete with "Confirm location" at the bottom of this same screen; do not introduce a new color constant) |
| Icon | `MyLocation` / `location.fill`, tinted green, ~24dp/16pt | Same icon, **white**, 22dp/20pt, centered |
| Elevation | `mapControlShadow` / `shadow(radius: 2)` (light) | Stronger: Android `elevation = 6.dp` equivalent shadow; iOS `shadow(color: .black.opacity(0.2), radius: 6, y: 3)` — enough to visibly pop off the map, matching the weight of a FAB |
| Placement | Android: `Alignment.CenterEnd` (mid-right) · iOS: top-right next to back button | **Both platforms: bottom-right**, standard Google Maps/Uber/Swiggy convention and thumb-reachable. Margin: 16dp/16pt from the trailing edge, **72dp/72pt** above the top edge of the bottom confirm sheet (raised from the original 16dp/16pt gap per user request for clearer separation from the sheet — not overlapping it — respect `navigationBarsPadding()`/safe area the sheet already uses, then stack the button above that). |
| Touch target | 44dp / 36pt (iOS under its own 44pt HIG minimum today) | 52dp and 48pt — both comfortably clear their platform minimum (Android 48dp, iOS 44pt) |

### States

| State | Visual |
|---|---|
| **Default** | Filled `GreenAction`, white icon, elevated shadow as above |
| **Pressed** | Android: standard ripple (white, 24% overlay) + scale to 0.96 over 100ms ease-out. iOS: opacity 0.85 + scale 0.96 over 100ms ease-out. |
| **Loading** (GPS fix in flight) | Icon swaps to a small white circular spinner, 16dp/16pt, 2dp stroke, indefinite rotation. Button stays green/filled (it's working, not broken) and ignores repeat taps while loading. Clear on success (camera animates to the fix) or on failure (revert to default icon; if you want a failure signal, a single quick shake/haptic is enough — no error toast on this screen, it's low-stakes and retappable). |
| **No visual "disabled" state** | If location permission isn't granted yet, tapping should keep triggering the existing OS permission-request flow (already implemented in both `MapPickerScreen`'s `locationPermissionLauncher` and iOS's `LocationManager`) — the button always renders as tappable default/pressed/loading, never greyed out, so it never looks broken. |

## Accessibility
- Both platforms: recenter button keeps its existing `contentDescription`/accessibility label
  "Use current location" — unchanged.
- Touch targets: 52dp (Android) and 48pt (iOS) both exceed platform minimums (48dp / 44pt).
- Contrast: white icon on `AuthFocus`/`authFocus` #E58124 background is ≈3.3:1 (calculated) — meets the
  WCAG 3:1 minimum required for icon/graphical UI components with comfortable margin, and sits
  close to the ~4.5:1+ bar the previous green gave. This is a deliberately darker/richer
  "burnt orange" rather than a bright tangerine specifically to hold that contrast — do not
  substitute a lighter/more saturated orange without re-checking contrast.
- Reduce Motion: covered above under pin states — settle bounce and lift/shrink are skipped,
  loading spinner keeps rotating (spinners are exempt from reduce-motion opt-out).

## Platform notes for implementers
- **Android** (`MapPickerScreen.kt`): drive dragging/settled state off
  `cameraPositionState.isMoving` (Maps Compose exposes this) with the ~150ms debounce before
  flipping to "settled" to avoid flicker on tiny camera jitters. Reuse `HaperBrand.cornerMedium`
  shadow infra pattern from `mapControlShadow` for the recenter button's new elevation, but
  note it needs a *filled* colored background now, not just a white fill — extend
  `Modifier.mapControlShadow(color: Color)` usage or apply `Modifier.shadow(...).background(GreenAction, CircleShape)` directly.
- **iOS** (`MapPickerView.swift`): drive dragging/settled off `onMapCameraChange(frequency: .continuous)` already wired up — set `isDragging = true` on each callback and debounce a `settled` flip via `.task`/`Task.sleep(150ms)` cancelled on every new camera event. Move the recenter button out of the top `HStack` (next to back button) into a new bottom-trailing overlay, respecting `.safeAreaInset` above the existing bottom `VStack`/`.ultraThinMaterial` sheet.
- No difference in the pin/button *values* between platforms beyond dp↔pt unit conversion — colors, states, and behavior are identical by design so the two clients feel like one product.

## Out of scope (noted, not part of this pass)
- The hint banner treatment differs today (Android: light glass chip; iOS: black capsule) —
  a real inconsistency, but the user didn't ask for it and it's a separate, smaller fix.
- Back button, bottom confirm sheet, and lat/lng debug text are unchanged.

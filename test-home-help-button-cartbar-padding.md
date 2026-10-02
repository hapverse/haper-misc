# Home screen — Help button + cart-bar bottom padding — Test Guide

Covers two Android-only Home screen changes: (1) a new Help/support icon-button in the header,
and (2) extra scroll bottom-padding so grid content clears the floating cart bar. Against **dev**.
Each step says **what to do** and **what to expect** (✅ good / ❌ should be blocked).

---

## 1. Help button
1. Open Home screen (logged in, any store).
   ✅ A 42dp glass icon-button (help/question icon) shows in the header, styled like the
   alerts bell (same gradient + white border), next to the existing header icons.
2. Tap it.
   ✅ `onHelpClick` fires (navigates to help/support).
3. Enable TalkBack and focus the button.
   ✅ Announces "Help and support, button" (not just "Help and support").

## 2. Cart-bar bottom padding
1. Add an item to cart so the floating cart bar appears at the bottom of Home.
2. Scroll the product grid all the way to the bottom, at **default (1.0x) system font size**.
   ✅ Last row of items is fully visible above the cart bar, with a visible gap — no overlap.
3. Repeat with system font size set to a larger scale (e.g. ~2.0x, Settings → Display → Font size).
   ✅ Still no overlap — the reserved padding (`HaperSpacing.scrollBottomPaddingWithCartBar`,
   208dp) covers the cart bar's larger footprint at bigger font scales, at the cost of extra
   empty space at default font size (accepted tradeoff).

## Notes
- Fix lives in `Theme.kt` (`HaperSpacing.scrollBottomPaddingWithCartBar`) and `HomeScreen.kt`
  (Help button). No backend/API changes.
- Reviewed by Mayank (code-reviewer): approved with nits — comment corrected to describe the
  cart bar's real height mechanism (≈92dp at 1.0x font scale, grows with font scale), value
  unchanged (208dp, already safely covers larger scales).
